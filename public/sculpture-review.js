import * as THREE from 'three';
import { meshesOf } from './sculpture-model.js';

// Explicit opt-in QA controls, absent from the normal lesson experience.
export function installReview(api) {
  const panel = document.createElement('section');
  panel.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:1000;background:#141b29ee;color:white;padding:12px;border:1px solid #657286;border-radius:12px;max-width:90vw;font:14px system-ui;pointer-events:auto';
  const title = document.createElement('div'); title.textContent = 'Bishop • εγκεκριμένες περιοχές'; panel.append(title);
  const status = document.createElement('div'); status.style.cssText = 'margin-top:8px;max-width:700px';
  const run = (name, action) => {
    const button = document.createElement('button'); button.textContent = name;
    button.style.cssText='margin:8px 6px 0 0;padding:7px 10px;border-radius:6px;cursor:pointer';
    button.onclick = async event => {
      event.stopPropagation(); button.disabled = true;
      try { await action(); } catch (error) { status.textContent = 'FAIL: ' + error.stack; }
      finally { button.disabled = false; }
    };
    panel.append(button);
  };
  run('Σβηστό', () => { api.reset(); api.refresh(); status.textContent = 'Αρχικά υλικά • χωρίς συνεισφορές'; });
  for (const [key, name] of [['head','Κεφαλή'],['trunk','Κορμός'],['arms','Χέρια']]) {
    run(name, () => {
      api.reset(); api.replay({region:key,text:'Έλεγχος '+name,source:'Προεπισκόπηση περιοχής',category:'theological',docScore:5});
      api.refresh(); status.textContent = 'Φωτίζεται μόνο: ' + name;
    });
  }
  run('Συνεισφορές μαθήματος', async () => { await api.load(await (await fetch(new URL('./bishop-pilot.json', import.meta.url))).json()); status.textContent='Επαναφορά αρχικών συνεισφορών'; });
  run('Έλεγχοι', async () => {
    const checks = [];
    function check(ok, label) { if (!ok) throw new Error(label); checks.push(label); }
    api.reset();
    const snapshot = () => Object.fromEntries(['head','trunk','arms'].map(key => [key, meshesOf(api.regions[key]).flatMap(mesh => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(m => ({id:m.uuid,color:m.color.getHex(),emissive:m.emissive.getHex(),intensity:m.emissiveIntensity,map:m.map?.uuid,normal:m.normalMap?.uuid,roughness:m.roughness,metalness:m.metalness})))]));
    const original = snapshot();
    check(!!api.model.config, 'GLB loaded');
    for (const key of ['head','trunk','arms']) {
      api.replay({region:key,text:'QA',source:'QA source',category:'theological',docScore:5});
      const lit = snapshot();
      check(lit[key].some(m => m.intensity > 0), key+' lights');
      for (const other of ['head','trunk','arms'].filter(k => k !== key)) check(JSON.stringify(lit[other]) === JSON.stringify(original[other]), other+' isolated');
      check(lit[key].every((m,i) => m.color === original[key][i].color && m.map === original[key][i].map && m.normal === original[key][i].normal && m.id === original[key][i].id), key+' textures/material stable');
      api.reset(); check(JSON.stringify(snapshot()) === JSON.stringify(original), key+' reset');
      check(api.inscriptions.length === 0, 'no old inscriptions');
    }
    // Exercise the same raycaster inputs used by desktop and XR clicks.
    api.parent.updateMatrixWorld(true);
    for (const key of ['head','trunk','arms']) {
      let found = false;
      const bounds = new THREE.Box3(); meshesOf(api.regions[key]).forEach(m => bounds.expandByObject(m));
      const ray = new THREE.Raycaster();
      for (let iy=1;iy<12 && !found;iy++) for (let ix=1;ix<12 && !found;ix++) {
        ray.set(new THREE.Vector3(THREE.MathUtils.lerp(bounds.min.x,bounds.max.x,ix/12),THREE.MathUtils.lerp(bounds.min.y,bounds.max.y,iy/12),bounds.max.z+5),new THREE.Vector3(0,0,-1));
        const hit=ray.intersectObjects(api.clickables(),false)[0];
        if (hit?.object.userData.region === key) found=true;
      }
      check(found,key+' selectable');
    }
    const pilot = await (await fetch(new URL('./bishop-pilot.json', import.meta.url))).json();
    const invalid = structuredClone(pilot); invalid.sculpture.regions.head=['missing'];
    let rejected=false; try { await api.load(invalid); } catch { rejected=true; }
    check(rejected && JSON.stringify(snapshot()) === JSON.stringify(original), 'invalid mapping preserves model');
    await api.load({instance:{title:'QA legacy'},contributions:[]});
    check(api.model.config === null && api.inscriptions.length === 0,'legacy lesson switch');
    await api.load(pilot);
    check(api.model.config?.url === pilot.sculpture.url,'GLB lesson restored');
    check(api.build().sculpture.regions.head[0] === 'Bishop_head','JSON mapping round trip');
    status.textContent = 'PASS • ' + checks.length + ' έλεγχοι: ανεξάρτητος φωτισμός, υφές, reset, επιλογή, αλλαγή μαθήματος, JSON.';
    status.dataset.result = JSON.stringify(checks);
  });
  panel.append(status); document.body.append(panel);
}
