export function installSculpturePicker({ getConfig, change, download }) {
  const style = document.createElement('style');
  style.textContent = `
    #sculpture-picker { margin:auto; max-height:90vh; overflow-y:auto; width:min(440px,calc(100vw - 40px)); box-sizing:border-box; color:#eef2ff; background:#111827; border:1px solid #475569; border-radius:16px; padding:24px; box-shadow:0 20px 80px #0009; font:15px/1.5 system-ui; }
    #sculpture-picker::backdrop { background:#0009; }
    #sculpture-picker h2 { font-size:21px; margin:0 0 12px; }
    #sculpture-picker p { color:#cbd5e1; }
    #sculpture-picker select { width:100%; margin:8px 0; padding:12px; color:#fff; background:#1e293b; border:1px solid #64748b; border-radius:8px; font:inherit; }
    #sculpture-picker button { padding:10px 14px; border:1px solid #64748b; border-radius:8px; background:#243249; color:white; font:inherit; cursor:pointer; }
    #sculpture-picker button:disabled { opacity:.5; cursor:wait; }
    #sculpture-picker .picker-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:18px; }
    #sculpture-picker .picker-apply { background:#4f46e5; border-color:#818cf8; }
    #sculpture-picker [role=status] { min-height:24px; color:#c4b5fd; }
    @media(max-width:760px) { #toggle-row { top:90px; flex-wrap:wrap; justify-content:flex-end; max-width:95vw; } }
  `;
  document.head.append(style);
  const dialog = document.createElement('dialog'); dialog.id = 'sculpture-picker';
  dialog.setAttribute('aria-labelledby', 'sculpture-picker-title');
  dialog.innerHTML = `
    <h2 id="sculpture-picker-title">Γλυπτό μαθήματος</h2>
    <p>Επίλεξε τη μορφή για το ανοιχτό μάθημα. Οι συνεισφορές του διατηρούνται.</p>
    <label for="sculpture-choice">Διαθέσιμες μορφές</label>
    <select id="sculpture-choice"></select>
    <p id="sculpture-description"></p>
    <div role="status" aria-live="polite"></div>
    <div class="picker-actions">
      <button class="picker-apply" type="button">Εφαρμογή</button>
      <button class="picker-save" type="button">Αποθήκευση μαθήματος JSON</button>
      <button class="picker-close" type="button">Κλείσιμο</button>
    </div>
    <p><small>Αποθήκευσε το JSON για να ανοίγει ξανά το μάθημα με αυτή τη μορφή. Νέα GLB προστίθενται μετά την προετοιμασία και την έγκριση των περιοχών τους.</small></p>`;
  document.body.append(dialog);
  const select = dialog.querySelector('select');
  const description = dialog.querySelector('#sculpture-description');
  const status = dialog.querySelector('[role=status]');
  const apply = dialog.querySelector('.picker-apply');
  const save = dialog.querySelector('.picker-save');
  const close = dialog.querySelector('.picker-close');
  let entries = [], busy = false;
  const signature = config => !config ? 'legacy' : JSON.stringify([
    new URL(config.url, location.href).href, config.height ?? 4.4,
    ...['head','trunk','arms'].map(key => [...(config.regions?.[key] || [])].sort()),
  ]);
  function populate() {
    const current = getConfig();
    const match = entries.find(entry => signature(entry.sculpture) === signature(current));
    const options = [...entries];
    if (!match) options.push({ id:'current', name:'Τρέχον γλυπτό από το μάθημα', description:'Η μορφή που περιέχεται στο εισαγόμενο JSON.', sculpture:current });
    select.replaceChildren(...options.map(entry => new Option(entry.name, entry.id)));
    select.value = match?.id || 'current';
    describe();
  }
  function describe() {
    description.textContent = entries.find(entry => entry.id === select.value)?.description || 'Η μορφή που περιέχεται στο εισαγόμενο JSON.';
  }
  select.onchange = () => { describe(); status.textContent = ''; };
  close.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  save.onclick = () => { download(); status.textContent = 'Το JSON περιλαμβάνει την εφαρμοσμένη μορφή και τις συνεισφορές.'; };
  apply.onclick = async () => {
    if (busy) return;
    const entry = entries.find(item => item.id === select.value);
    if (!entry || signature(entry.sculpture) === signature(getConfig())) { status.textContent = 'Αυτή η μορφή είναι ήδη ενεργή.'; return; }
    busy = true; select.disabled = apply.disabled = save.disabled = close.disabled = true;
    status.textContent = 'Φόρτωση και έλεγχος γλυπτού…';
    try {
      const changed = await change(structuredClone(entry.sculpture));
      status.textContent = changed ? 'Η μορφή εφαρμόστηκε. Αποθήκευσε το μάθημα JSON για επόμενη χρήση.' : 'Η φόρτωση αντικαταστάθηκε από νεότερη επιλογή μαθήματος.';
    } catch (error) {
      status.textContent = 'Δεν φορτώθηκε η μορφή. Το προηγούμενο γλυπτό διατηρήθηκε. ' + error.message;
    } finally {
      busy = false; select.disabled = apply.disabled = save.disabled = close.disabled = false;
      populate();
    }
  };
  document.querySelector('#btn-sculpture').onclick = async () => {
    dialog.showModal();
    entries = [{ id:'legacy', name:'Αρχικό αφαιρετικό γλυπτό', description:'Η αρχική γεωμετρική μορφή με τις έξι περιοχές.', sculpture:null }];
    populate(); apply.disabled = true; status.textContent = 'Φόρτωση διαθέσιμων μορφών…';
    try {
      const response = await fetch(new URL('./sculptures.json', import.meta.url));
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const catalog = await response.json();
      const ids = new Set(['legacy','current']);
      for (const entry of catalog.models || []) {
        if (typeof entry.id !== 'string' || ids.has(entry.id) || typeof entry.name !== 'string' || !entry.sculpture?.url) throw new Error('Μη έγκυρος κατάλογος μορφών');
        ids.add(entry.id); signature(entry.sculpture);
      }
      entries.push(...catalog.models); populate(); status.textContent = '';
    } catch { status.textContent = 'Ο κατάλογος δεν είναι διαθέσιμος. Μπορείς να κρατήσεις το τρέχον γλυπτό ή να επιλέξεις το αρχικό.'; }
    finally { apply.disabled = false; }
  };
}
