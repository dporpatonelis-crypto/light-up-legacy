import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function meshesOf(value) {
  const meshes = [];
  for (const root of Array.isArray(value) ? value : [value]) {
    root?.traverse(node => { if (node.isMesh) meshes.push(node); });
  }
  return meshes;
}

const originals = new WeakMap();
export function rememberMaterials(mesh) {
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    if (material && !originals.has(material)) originals.set(material, {
      color: material.color?.clone(), emissive: material.emissive?.clone(),
      intensity: material.emissiveIntensity, roughness: material.roughness, metalness: material.metalness,
    });
  }
}

export function lightRegion(value, color, strength, active) {
  for (const mesh of meshesOf(value)) {
    rememberMaterials(mesh);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const original = originals.get(material);
      if (!original) continue;
      if (original.color) material.color.copy(original.color);
      material.roughness = original.roughness; material.metalness = original.metalness;
      if (!material.emissive) continue;
      material.emissive.copy(original.emissive);
      material.emissiveIntensity = original.intensity;
      if (active) {
        material.emissive.setHex(color);
        material.emissiveIntensity = Math.max(original.intensity || 0, Math.min(strength / 20, 3));
      }
    }
  }
}

export function disposeModel(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root?.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!mat) continue;
      materials.add(mat);
      Object.values(mat).forEach(value => { if (value?.isTexture) textures.add(value); });
    }
  });
  geometries.forEach(item => item.dispose());
  materials.forEach(item => item.dispose());
  const images = new Set();
  textures.forEach(item => { images.add(item.source?.data); item.dispose(); });
  images.forEach(item => item?.close?.());
}

// Load and validate before committing: a failed or superseded request never replaces the sculpture.
export function createSculptureModel({ parent, regions, fallback, halo, onChange }) {
  const loader = new GLTFLoader();
  let generation = 0, current = null, config = null;
  async function prepare(request) {
    const ticket = ++generation;
    let root = null;
    const mapped = {};
    let normalized = null;
    if (request != null) {
      if (typeof request.url !== 'string' || !request.url.trim()) throw new Error('sculpture.url is required');
      const height = request.height ?? 4.4;
      if (!Number.isFinite(height) || height < 0.5 || height > 8) throw new Error('sculpture.height must be 0.5–8');
      normalized = { url: request.url, height, regions: {} };
      const names = new Set();
      for (const key of ['head', 'trunk', 'arms']) {
        const list = request.regions?.[key];
        if (!Array.isArray(list) || !list.length || list.some(n => typeof n !== 'string' || !n)) throw new Error(`Missing sculpture.regions.${key}`);
        for (const name of list) {
          if (names.has(name)) throw new Error(`Region name mapped twice: ${name}`);
          names.add(name);
        }
        normalized.regions[key] = [...list];
      }
      root = (await loader.loadAsync(request.url)).scene;
      try {
        const claimed = new Set();
        for (const key of ['head', 'trunk', 'arms']) {
          mapped[key] = [];
          for (const name of normalized.regions[key]) {
            const matches = [];
            root.traverse(node => { if (node.name === name) matches.push(node); });
            if (matches.length !== 1) throw new Error(`Expected one GLB node named ${name}`);
            const meshes = meshesOf(matches[0]);
            if (!meshes.length) throw new Error(`No surfaces in ${name}`);
            for (const mesh of meshes) {
              if (claimed.has(mesh)) throw new Error(`Overlapping regions: ${name}`);
              claimed.add(mesh); mapped[key].push(mesh);
              mesh.userData.region = key;
            }
          }
        }
        if (meshesOf(root).some(mesh => !claimed.has(mesh))) throw new Error('Every sculpture mesh must be assigned to a region');
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('Empty sculpture bounds');
        root.scale.multiplyScalar(height / size.y);
        root.updateMatrixWorld(true);
        box.setFromObject(root);
        const center = box.getCenter(new THREE.Vector3());
        root.position.add(new THREE.Vector3(-center.x, 0.7 - box.min.y, -center.z));
        const loadedMaterials = new Set();
        root.traverse(mesh => {
          if (!mesh.isMesh) return;
          mesh.castShadow = true; mesh.receiveShadow = true;
          const clone = mat => { loadedMaterials.add(mat); return mat.clone(); };
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
          rememberMaterials(mesh);
        });
        loadedMaterials.forEach(mat => mat.dispose());
      } catch (error) { disposeModel(root); throw error; }
    }
    if (ticket !== generation) { disposeModel(root); return null; }
    return () => {
      if (ticket !== generation) { disposeModel(root); return false; }
      if (current) { parent.remove(current); disposeModel(current); }
      current = root; config = normalized;
      for (const key of ['head', 'trunk', 'arms']) {
        meshesOf(fallback[key]).forEach(mesh => { mesh.visible = !root; });
        regions[key] = root ? mapped[key] : fallback[key];
      }
      halo.visible = !root;
      if (root) parent.add(root);
      parent.updateMatrixWorld(true);
      onChange?.(root);
      return true;
    };
  }
  return { prepare, get config() { return config ? structuredClone(config) : null; } };
}
