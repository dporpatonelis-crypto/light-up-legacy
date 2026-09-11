import { meshesOf } from './sculpture-model.js';

const REGION_KEYS = ['base', 'trunk', 'arms', 'head', 'periphery', 'core'];
const VOWEL_VISEMES = ['viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U'];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeReward(value) {
  if (typeof value === 'string' && value.trim()) return { url: value.trim() };
  if (!value || typeof value !== 'object' || typeof value.url !== 'string' || !value.url.trim()) return null;
  return {
    url: value.url.trim(),
    label: typeof value.label === 'string' ? value.label : '',
    volume: Number.isFinite(value.volume) ? clamp(value.volume, 0, 1) : null,
  };
}

function normalizeConfig(value) {
  if (!value || typeof value !== 'object' || value.enabled === false) return null;
  const rewards = {};
  for (const key of REGION_KEYS) {
    const source = value.rewards?.[key];
    const list = Array.isArray(source) ? source : [source];
    const normalized = list.map(normalizeReward).filter(Boolean);
    if (normalized.length) rewards[key] = normalized;
  }
  return {
    enabled: true,
    oncePerRegion: value.oncePerRegion !== false,
    volume: Number.isFinite(value.volume) ? clamp(value.volume, 0, 1) : 1,
    rewards,
  };
}

/**
 * Audio reward and lightweight Oculus-viseme lip-sync controller.
 *
 * It deliberately uses a Web Audio analyser rather than pretending to infer
 * phonemes from a WAV. This gives reliable mouth timing in a browser and
 * leaves room for a future precomputed viseme track when exact phonemes are
 * needed.
 */
export function createVoiceReward({ onStatus } = {}) {
  let config = null;
  let context = null;
  let analyser = null;
  let waveform = null;
  let spectrum = null;
  let audio = null;
  let source = null;
  let token = 0;
  let smoothEnergy = 0;
  let morphMeshes = [];
  let morphBase = new WeakMap();
  const playedRegions = new Set();
  const nextRewardIndex = new Map();

  function status(message) {
    if (typeof onStatus === 'function') onStatus(message);
  }

  function ensureContext() {
    if (context) return context;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio API δεν υποστηρίζεται σε αυτόν τον browser.');
    context = new AudioContextClass();
    analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.65;
    analyser.connect(context.destination);
    waveform = new Uint8Array(analyser.fftSize);
    spectrum = new Uint8Array(analyser.frequencyBinCount);
    return context;
  }

  async function unlock() {
    const ctx = ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
  }

  function captureMorphs(value) {
    morphMeshes = meshesOf(value).filter(mesh =>
      mesh.morphTargetDictionary && Array.isArray(mesh.morphTargetInfluences)
    );
    morphBase = new WeakMap();
    for (const mesh of morphMeshes) {
      morphBase.set(mesh, Float32Array.from(mesh.morphTargetInfluences));
    }
    resetMouth();
  }

  function resetMouth() {
    for (const mesh of morphMeshes) {
      const base = morphBase.get(mesh);
      if (!base || !mesh.morphTargetInfluences) continue;
      for (let i = 0; i < base.length; i++) mesh.morphTargetInfluences[i] = base[i];
    }
    smoothEnergy = 0;
  }

  function setMorph(names, value) {
    const requested = Array.isArray(names) ? names : [names];
    for (const mesh of morphMeshes) {
      const dictionary = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dictionary || !influences) continue;
      for (const name of requested) {
        const index = dictionary[name];
        if (index !== undefined) influences[index] = clamp(value, 0, 1);
      }
    }
  }

  function finish(currentToken, message = '') {
    if (currentToken !== token) return;
    if (source) {
      try { source.disconnect(); } catch (_) {}
    }
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    source = null;
    audio = null;
    resetMouth();
    if (message) status(message);
  }

  function stop() {
    token++;
    finish(token, '');
  }

  function selectReward(region) {
    const list = config?.rewards?.[region];
    if (!list?.length) return null;
    if (config.oncePerRegion && playedRegions.has(region)) return null;
    const index = nextRewardIndex.get(region) || 0;
    nextRewardIndex.set(region, index + 1);
    return list[index % list.length];
  }

  async function play(region, { force = false } = {}) {
    if (!config?.enabled || (!force && !config.rewards[region])) return false;
    const entry = force ? (config.rewards[region]?.[0] || null) : selectReward(region);
    if (!entry) return false;
    const nextToken = token + 1;
    stop();
    try {
      await unlock();
      if (nextToken !== token) return false;
      const element = new Audio();
      element.preload = 'auto';
      element.crossOrigin = 'anonymous';
      element.volume = entry.volume ?? config.volume;
      element.src = new URL(entry.url, window.location.href).href;
      const mediaSource = context.createMediaElementSource(element);
      mediaSource.connect(analyser);
      audio = element;
      source = mediaSource;
      const currentToken = token;
      element.addEventListener('ended', () => finish(currentToken, ''));
      element.addEventListener('error', () => finish(currentToken, 'Το reward WAV δεν ήταν διαθέσιμο.'));
      const result = element.play();
      if (result && typeof result.then === 'function') await result;
      if (config.oncePerRegion) playedRegions.add(region);
      const mode = morphMeshes.length ? 'lipsync ενεργό' : 'audio-only';
      status((entry.label ? `🔊 ${entry.label}` : `🔊 Επιβράβευση: ${region}`) + ` · ${mode}`);
      return true;
    } catch (error) {
      // A blocked autoplay or a missing file must not break lighting or the lesson.
      if (config.oncePerRegion) playedRegions.delete(region);
      finish(token, 'Ο ήχος χρειάζεται ενεργοποίηση από τον browser.');
      console.warn('Reward audio unavailable:', error);
      return false;
    }
  }

  function update() {
    if (!audio || audio.paused || audio.ended || !analyser) {
      if (smoothEnergy > 0.001) {
        smoothEnergy *= 0.82;
        setMouth(smoothEnergy, 0.25);
      }
      return;
    }
    analyser.getByteTimeDomainData(waveform);
    let sum = 0;
    for (const value of waveform) {
      const sample = (value - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / waveform.length);
    const targetEnergy = clamp((rms - 0.012) * 8.5, 0, 1);
    smoothEnergy += (targetEnergy - smoothEnergy) * 0.3;

    analyser.getByteFrequencyData(spectrum);
    let weighted = 0;
    let total = 0;
    for (let i = 1; i < spectrum.length; i++) {
      const magnitude = spectrum[i];
      weighted += i * magnitude;
      total += magnitude;
    }
    const centroid = total ? weighted / total / spectrum.length : 0.35;
    setMouth(smoothEnergy, centroid);
  }

  function setMouth(energy, centroid) {
    const open = clamp(energy * 1.15, 0, 1);
    setMorph('mouthOpen', open);
    setMorph('jawOpen', open * 0.7);
    setMorph('viseme_sil', 1 - open);
    const activeVowel = Math.min(VOWEL_VISEMES.length - 1, Math.floor(clamp(centroid * 1.8, 0, 0.999) * VOWEL_VISEMES.length));
    VOWEL_VISEMES.forEach((name, index) => setMorph(name, index === activeVowel ? open * 0.65 : 0));
  }

  function configure(value) {
    stop();
    config = normalizeConfig(value);
    playedRegions.clear();
    nextRewardIndex.clear();
    return config ? structuredClone(config) : null;
  }

  return {
    configure,
    attach: captureMorphs,
    unlock,
    play,
    stop,
    update,
    resetRewards: () => { playedRegions.clear(); nextRewardIndex.clear(); },
    get enabled() { return !!config?.enabled; },
    get lipSyncSupported() { return morphMeshes.length > 0; },
    get currentUrl() { return audio?.src || null; },
  };
}
