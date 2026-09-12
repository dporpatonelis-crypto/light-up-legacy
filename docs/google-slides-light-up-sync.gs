/**
 * δόγμα και βίωμα → Light Up Legacy
 *
 * Εγκατάσταση:
 * 1. Άνοιξε το Google Slides και επίλεξε Extensions → Apps Script.
 * 2. Βάλε τον GitHub token μόνο στα Script Properties ως GITHUB_TOKEN.
 * 3. Κάνε reload το Slides και χρησιμοποίησε το μενού
 *    📋 Πίνακας Έρευνας → 🔄 Ενημέρωση Light Up Legacy.
 *
 * Το script διαβάζει μόνο την πρώτη διαφάνεια. Τα πέντε γνωστά πεδία
 * αντιστοιχούν στις περιοχές του Light Up Legacy. Για την Περιφέρεια ή
 * για επιπλέον πεδία χρησιμοποίησε prefix [light-up:periphery] σε textbox.
 */

const SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();
const CONFIG = Object.freeze({
  owner: 'dporpatonelis-crypto',
  repo: 'light-up-legacy',
  filePath: 'public/contributions.json',
  branch: SCRIPT_PROPERTIES.getProperty('BRANCH') || 'main',
  token: SCRIPT_PROPERTIES.getProperty('GITHUB_TOKEN'),
  // Default: η πρώτη διαφάνεια είναι η μοναδική πηγή για το managed snapshot.
  // Βάλε PRESERVE_UNMANAGED=true μόνο αν θέλεις να κρατήσεις παλιές
  // χειροκίνητες εγγραφές που δεν έχουν syncSource.
  preserveUnmanaged: SCRIPT_PROPERTIES.getProperty('PRESERVE_UNMANAGED') === 'true',
  presentationId: SCRIPT_PROPERTIES.getProperty('PRESENTATION_ID') || ''
});

const SYNC_SOURCE = 'google-slides:dogma-vioma';
const FIRST_SLIDE_OBJECT_ID = 'christ_events_response_board_v1';

const REGION_FIELDS = {
  christ_event_birth_significance: {
    region: 'head',
    label: 'Κεφαλή'
  },
  christ_event_teaching_significance: {
    region: 'arms',
    label: 'Χέρια'
  },
  christ_event_miracles_significance: {
    region: 'trunk',
    label: 'Κορμός'
  },
  christ_event_passion_significance: {
    region: 'base',
    label: 'Βάση'
  },
  christ_event_resurrection_significance: {
    region: 'core',
    label: 'Εσωτερικός Πυρήνας'
  }
};

const CATEGORY_BY_REGION = {
  base: 'theological',
  trunk: 'philosophical',
  arms: 'ethical',
  head: 'theological',
  periphery: 'historical',
  core: 'theological'
};

function updateLightUpFromSlides() {
  const presentation = getPresentation_();
  const now = new Date().toISOString();
  const contributions = parseFirstSlide_(presentation, now);
  const target = readTargetFile_();
  const previous = target.data && Array.isArray(target.data.contributions)
    ? target.data.contributions
    : [];

  const preserved = CONFIG.preserveUnmanaged
    ? previous.filter(item => item && item.syncSource !== SYNC_SOURCE)
    : [];

  const payload = {
    _comment: 'Ενημερώνεται από Google Slides → Extensions → Apps Script.',
    version: 2,
    topic: presentation.getName() || 'δόγμα και βίωμα',
    source: {
      type: 'google-slides',
      presentationId: presentation.getId(),
      slideObjectId: getObjectId_(getFirstSlide_(presentation), FIRST_SLIDE_OBJECT_ID),
      syncedAt: now
    },
    contributions: preserved.concat(contributions)
  };

  pushToGitHub_(JSON.stringify(payload, null, 2), target.sha);
  Logger.log('✅ Light Up Legacy ενημερώθηκε: ' + contributions.length + ' πεδία.');
  return payload;
}

// Συμβατό alias για το παλιό trigger/μενού του Idea Weaver.
function updateCluesFromSlides() {
  return updateLightUpFromSlides();
}

function previewLightUpPayload() {
  const presentation = getPresentation_();
  const payload = {
    topic: presentation.getName() || 'δόγμα και βίωμα',
    source: {
      type: 'google-slides',
      presentationId: presentation.getId(),
      slideObjectId: getObjectId_(getFirstSlide_(presentation), FIRST_SLIDE_OBJECT_ID)
    },
    contributions: parseFirstSlide_(presentation, new Date().toISOString())
  };
  Logger.log(JSON.stringify(payload, null, 2));
  return payload;
}

function getPresentation_() {
  try {
    const active = SlidesApp.getActivePresentation();
    if (active) return active;
  } catch (_) {
    // Όταν τρέχει από το editor, χρησιμοποιούμε το optional property.
  }
  if (CONFIG.presentationId) return SlidesApp.openById(CONFIG.presentationId);
  throw new Error('Δεν βρέθηκε η παρουσίαση. Βάλε PRESENTATION_ID στα Script Properties.');
}

function getFirstSlide_(presentation) {
  const slides = presentation.getSlides();
  if (!slides || !slides.length) throw new Error('Η παρουσίαση δεν έχει διαφάνειες.');
  return slides[0];
}

function getObjectId_(element, fallback) {
  return element && typeof element.getObjectId === 'function'
    ? element.getObjectId()
    : fallback;
}

function parseFirstSlide_(presentation, syncedAt) {
  const firstSlide = getFirstSlide_(presentation);
  const presentationId = presentation.getId();
  const contributions = [];

  firstSlide.getShapes().forEach((shape, index) => {
    const raw = shape.getText().asString().trim();
    if (!raw) return;

    const objectId = getObjectId_(shape, 'shape-' + index);
    const mapped = REGION_FIELDS[objectId];
    if (mapped) {
      const contribution = buildContribution_(
        raw,
        mapped.region,
        mapped.label,
        objectId,
        presentationId,
        syncedAt
      );
      if (contribution) contributions.push(contribution);
      return;
    }

    // Extra textbox syntax, e.g.:
    // [light-up:periphery]
    // Μαθητής: ...
    // Πηγή: ...
    // Η ιδέα του μαθητή...
    const marker = raw.match(
      /^\s*\[light-up\s*:\s*(base|trunk|arms|head|periphery|core)\]\s*/i
    );
    if (!marker) return;

    const region = marker[1].toLowerCase();
    const contribution = buildContribution_(
      raw.substring(marker[0].length).trim(),
      region,
      region,
      objectId,
      presentationId,
      syncedAt
    );
    if (contribution) contributions.push(contribution);
  });

  if (!contributions.length) {
    throw new Error(
      'Δεν βρέθηκαν απαντήσεις στην πρώτη διαφάνεια. Ο συγχρονισμός ακυρώθηκε για ασφάλεια.'
    );
  }
  return contributions;
}

function buildContribution_(raw, region, label, objectId, presentationId, syncedAt) {
  const parsed = parseMetadata_(raw);
  if (!parsed.text) return null;

  const source = parsed.source || 'Google Slides · ' + label;
  const score = source.length > 5 ? Math.min(source.length / 10, 10) : 1;
  return {
    id: 'slides:' + presentationId + ':' + objectId,
    syncSource: SYNC_SOURCE,
    presentationId,
    slideObjectId: FIRST_SLIDE_OBJECT_ID,
    elementObjectId: objectId,
    region,
    text: parsed.text,
    source,
    student: parsed.student,
    group: parsed.group,
    category: parsed.category || CATEGORY_BY_REGION[region] || 'theological',
    docScore: score,
    timestamp: syncedAt
  };
}

function parseMetadata_(raw) {
  const lines = String(raw)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const textLines = [];
  let student = '';
  let group = '';
  let source = '';
  let category = '';

  lines.forEach(line => {
    let match = line.match(/^(?:μαθητής|μαθήτρια|student|author)\s*:\s*(.+)$/i);
    if (match) {
      student = match[1].trim();
      return;
    }

    match = line.match(/^(?:ομάδα|group)\s*:\s*(.+)$/i);
    if (match) {
      group = match[1].trim();
      return;
    }

    match = line.match(/^(?:πηγή|source|reference)\s*:\s*(.+)$/i);
    if (match) {
      source = match[1].trim();
      return;
    }

    match = line.match(/^(?:κατηγορία|category)\s*:\s*(.+)$/i);
    if (match) {
      category = match[1].trim().toLowerCase();
      return;
    }

    textLines.push(line);
  });

  return {
    text: textLines.join('\n').trim(),
    student,
    group,
    source,
    category
  };
}

function readTargetFile_() {
  assertToken_();
  const response = UrlFetchApp.fetch(apiUrl_() + '?ref=' + encodeURIComponent(CONFIG.branch), {
    method: 'get',
    headers: githubHeaders_(),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();

  if (code === 404) return { sha: null, data: {} };
  if (code !== 200) {
    throw new Error('GitHub read failed (HTTP ' + code + ').');
  }

  const body = JSON.parse(response.getContentText());
  if (!body.content) return { sha: body.sha || null, data: {} };

  const decoded = Utilities.newBlob(
    Utilities.base64Decode(String(body.content).replace(/\s/g, ''))
  ).getDataAsString('UTF-8');

  try {
    return {
      sha: body.sha || null,
      data: decoded ? JSON.parse(decoded) : {}
    };
  } catch (_) {
    throw new Error('Το public/contributions.json δεν είναι έγκυρο JSON.');
  }
}

function pushToGitHub_(content, sha) {
  assertToken_();
  const payload = {
    message: '🕯️ Συγχρονισμός δόγμα και βίωμα από Google Slides',
    content: Utilities.base64Encode(
      Utilities.newBlob(content, 'application/json', 'contributions.json').getBytes()
    ),
    branch: CONFIG.branch
  };
  if (sha) payload.sha = sha;

  const response = UrlFetchApp.fetch(apiUrl_(), {
    method: 'put',
    headers: githubHeaders_(),
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error('GitHub push failed (HTTP ' + code + ').');
  }
}

function apiUrl_() {
  const encodedPath = CONFIG.filePath
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
  return 'https://api.github.com/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/contents/' + encodedPath;
}

function githubHeaders_() {
  return {
    Authorization: 'Bearer ' + CONFIG.token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function assertToken_() {
  if (!CONFIG.token) {
    throw new Error('Λείπει το GITHUB_TOKEN από τα Script Properties.');
  }
}

// Προσθέτει το μενού μέσα στο Google Slides (Extensions → Apps Script).
function onOpen() {
  SlidesApp.getUi()
    .createMenu('📋 Πίνακας Έρευνας')
    .addItem('🔄 Ενημέρωση Light Up Legacy', 'updateLightUpFromSlides')
    .addItem('🔎 Προεπισκόπηση συγχρονισμού', 'previewLightUpPayload')
    .addToUi();
}
