// ---------- Names ----------
const NAMES = { alejo: 'Alejo', najwa: 'Najwa', ambos: 'Ensemble' };

// ---------- Quick templates ----------
const TEMPLATES = [
  { title: 'Sortir les poubelles', category: 'Ménage' },
  { title: 'Faire la vaisselle', category: 'Cuisine' },
  { title: "Passer l'aspirateur", category: 'Ménage' },
  { title: 'Arroser les plantes', category: 'Maison' },
  { title: 'Nettoyer la salle de bain', category: 'Ménage' },
  { title: 'Faire les courses', category: 'Achats' }
];

// ---------- Local storage ----------
const TASKS_KEY = 'quehaceres-tasks-v2';
const SHOPPING_KEY = 'quehaceres-shopping-v2';

function loadLocal(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch (e) { return []; }
}
function saveLocal(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

let tasks = loadLocal(TASKS_KEY);
let shopping = loadLocal(SHOPPING_KEY);
let filter = 'todos';
let todayOnly = false;
let currentView = 'tasks';
let pendingPhotoTaskId = null;
let overdueNotified = new Set();
let reminderNotified = new Set();

let configured = typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL && !SUPABASE_URL.includes('PEGAR_ACA');

const todayLabel = document.getElementById('todayLabel');
todayLabel.textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

if (!configured) setSyncStatus('noconfig');

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function dateToStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayStr() { return dateToStr(new Date()); }

// ---------- Supabase sync ----------
async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res;
}

async function pullRow(id) {
  if (!configured) return null;
  try {
    const res = await sbFetch(`tasks_store?id=eq.${id}&select=data`);
    const rows = await res.json();
    return rows.length ? rows[0].data : null;
  } catch (e) { return null; }
}

async function pushRow(id, data) {
  if (!configured || !navigator.onLine) return false;
  try {
    await sbFetch('tasks_store', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ id, data, updated_at: new Date().toISOString() })
    });
    return true;
  } catch (e) { return false; }
}

// ---------- Merge logic ----------
// Merges two arrays of items by ID. For items present in both, keeps the one
// with the most recent modifiedAt (or completedAt/createdAt as fallback).
// Items only in one side are always kept.
function mergeById(localArr, cloudArr) {
  const map = new Map();

  // Start with everything from the cloud
  (cloudArr || []).forEach(item => {
    if (item && item.id) map.set(item.id, item);
  });

  // Overlay local items — keep local version if it's newer or equal
  (localArr || []).forEach(item => {
    if (!item || !item.id) return;
    const existing = map.get(item.id);
    if (!existing) {
      // New local item not in cloud → keep it
      map.set(item.id, item);
    } else {
      // Both exist → keep the one modified most recently
      const localTime = item.modifiedAt || item.completedAt || item.createdAt || 0;
      const cloudTime = existing.modifiedAt || existing.completedAt || existing.createdAt || 0;
      if (localTime >= cloudTime) {
        map.set(item.id, item);
      }
      // else keep the cloud version already in the map
    }
  });

  return Array.from(map.values());
}

// Deleted item IDs are tracked so that a delete on one device isn't "resurrected"
// by the other device still having the item locally.
const DELETED_TASKS_KEY = 'quehaceres-deleted-tasks';
const DELETED_SHOPPING_KEY = 'quehaceres-deleted-shopping';

function getDeletedIds(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key)) || []); }
  catch (e) { return new Set(); }
}
function addDeletedId(key, id) {
  const set = getDeletedIds(key);
  set.add(id);
  // Keep only last 500 to avoid unbounded growth
  const arr = [...set].slice(-500);
  localStorage.setItem(key, JSON.stringify(arr));
}
function filterDeleted(items, key) {
  const deleted = getDeletedIds(key);
  return items.filter(i => !deleted.has(i.id));
}

async function pullFromCloud() {
  if (!configured) return;
  setSyncStatus('loading');
  try {
    const [cloudTasks, cloudShopping] = await Promise.all([pullRow('main'), pullRow('shopping')]);

    if (cloudTasks) {
      tasks = mergeById(tasks, cloudTasks);
      tasks = filterDeleted(tasks, DELETED_TASKS_KEY);
      saveLocal(TASKS_KEY, tasks);
    }
    if (cloudShopping) {
      shopping = mergeById(shopping, cloudShopping);
      shopping = filterDeleted(shopping, DELETED_SHOPPING_KEY);
      saveLocal(SHOPPING_KEY, shopping);
    }
    setSyncStatus('ok');
  } catch (e) {
    setSyncStatus('error');
  }
  render();
}

// Sync cycle: pull → merge → push the merged result back
async function syncTasks() {
  saveLocal(TASKS_KEY, tasks);
  if (!configured) { setSyncStatus('noconfig'); return; }
  if (!navigator.onLine) { setSyncStatus('error'); return; }
  setSyncStatus('saving');
  try {
    // Pull latest from cloud
    const cloudTasks = await pullRow('main');
    if (cloudTasks) {
      tasks = mergeById(tasks, cloudTasks);
      tasks = filterDeleted(tasks, DELETED_TASKS_KEY);
    }
    // Push merged result
    const ok = await pushRow('main', tasks);
    saveLocal(TASKS_KEY, tasks);
    setSyncStatus(ok ? 'ok' : 'error');
    render();
  } catch (e) {
    setSyncStatus('error');
  }
}

async function syncShopping() {
  saveLocal(SHOPPING_KEY, shopping);
  if (!configured) { setSyncStatus('noconfig'); return; }
  if (!navigator.onLine) { setSyncStatus('error'); return; }
  setSyncStatus('saving');
  try {
    const cloudShopping = await pullRow('shopping');
    if (cloudShopping) {
      shopping = mergeById(shopping, cloudShopping);
      shopping = filterDeleted(shopping, DELETED_SHOPPING_KEY);
    }
    const ok = await pushRow('shopping', shopping);
    saveLocal(SHOPPING_KEY, shopping);
    setSyncStatus(ok ? 'ok' : 'error');
    renderShopping();
  } catch (e) {
    setSyncStatus('error');
  }
}

function setSyncStatus(state) {
  const dot = document.getElementById('syncDot');
  const text = document.getElementById('syncText');
  if (state === 'noconfig') { dot.className = 'dot off'; text.textContent = 'Supabase non configuré dans config.js'; return; }
  if (state === 'loading') { dot.className = 'dot'; text.textContent = 'Synchronisation…'; return; }
  if (state === 'saving') { dot.className = 'dot'; text.textContent = 'Enregistrement…'; return; }
  if (state === 'ok') { dot.className = 'dot'; text.textContent = 'Synchronisé · visible pour tous les deux'; return; }
  dot.className = 'dot off';
  text.textContent = navigator.onLine ? 'Synchronisation impossible' : 'Hors ligne — enregistré localement';
}

// ---------- View / filter ----------
function setView(view) {
  currentView = view;
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  document.getElementById('tasksView').style.display = view === 'tasks' ? '' : 'none';
  document.getElementById('shoppingView').style.display = view === 'shopping' ? '' : 'none';
}

function setFilter(who) {
  filter = who;
  document.querySelectorAll('.who-tab').forEach(t => t.classList.toggle('active', t.dataset.who === who));
  render();
}

function setTodayOnly(val) { todayOnly = val; render(); }

function toggleMore() { document.getElementById('moreFields').classList.toggle('show'); }

function normalizeAssignee(raw) {
  const v = (raw || '').toString().trim().toLowerCase();
  return (v === 'alejo' || v === 'najwa') ? v : 'ambos';
}
function normalizePriority(raw) {
  const v = (raw || '').toString().trim().toLowerCase();
  return (v === 'high' || v === 'low') ? v : 'medium';
}

// ---------- Templates ----------
function renderTemplates() {
  const wrap = document.getElementById('templateChips');
  wrap.innerHTML = TEMPLATES.map((t, i) =>
    `<button class="template-chip" onclick="addFromTemplate(${i})">+ ${escapeHtml(t.title)}</button>`
  ).join('');
}

async function addFromTemplate(i) {
  const t = TEMPLATES[i];
  tasks.push({
    id: uid(), title: t.title, category: t.category, assignee: 'ambos', priority: 'medium',
    date: null, time: null, recurring: 'none', rotate: false, reminderOffset: 0,
    subtasks: [], photo: null, done: false, completedAt: null, createdAt: Date.now(), modifiedAt: Date.now()
  });
  render();
  await syncTasks();
}

// ---------- Task actions ----------
async function addTask() {
  const titleEl = document.getElementById('newTitle');
  const title = titleEl.value.trim();
  if (!title) return;
  tasks.push({
    id: uid(),
    title,
    category: document.getElementById('newCategory').value,
    priority: normalizePriority(document.getElementById('newPriority').value),
    assignee: normalizeAssignee(document.getElementById('newAssignee').value),
    date: document.getElementById('newDate').value || null,
    time: document.getElementById('newTime').value || null,
    recurring: document.getElementById('newRecurring').value,
    rotate: document.getElementById('newRotate').checked,
    reminderOffset: parseInt(document.getElementById('newReminder').value, 10) || 0,
    subtasks: [],
    photo: null,
    done: false,
    completedAt: null,
    createdAt: Date.now(),
    modifiedAt: Date.now()
  });
  titleEl.value = '';
  document.getElementById('newDate').value = '';
  document.getElementById('newTime').value = '';
  document.getElementById('newRecurring').value = 'none';
  document.getElementById('newReminder').value = '0';
  document.getElementById('newPriority').value = 'medium';
  document.getElementById('newAssignee').value = 'ambos';
  document.getElementById('newRotate').checked = false;
  render();
  await syncTasks();
}

async function toggleDone(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;
  t.completedAt = t.done ? Date.now() : null;
  t.modifiedAt = Date.now();

  if (t.done && t.recurring !== 'none' && t.date) {
    const d = new Date(t.date + 'T00:00:00');
    if (t.recurring === 'daily') d.setDate(d.getDate() + 1);
    if (t.recurring === 'weekly') d.setDate(d.getDate() + 7);
    if (t.recurring === 'monthly') d.setMonth(d.getMonth() + 1);

    let nextAssignee = t.assignee;
    if (t.rotate && (t.assignee === 'alejo' || t.assignee === 'najwa')) {
      nextAssignee = t.assignee === 'alejo' ? 'najwa' : 'alejo';
    }

    tasks.push({
      ...t,
      id: uid(),
      done: false,
      completedAt: null,
      assignee: nextAssignee,
      date: dateToStr(d),
      subtasks: (t.subtasks || []).map(s => ({ ...s, done: false })),
      photo: null,
      createdAt: Date.now(),
      modifiedAt: Date.now()
    });
  }
  render();
  await syncTasks();
}

async function deleteTask(id) {
  addDeletedId(DELETED_TASKS_KEY, id);
  tasks = tasks.filter(x => x.id !== id);
  render();
  await syncTasks();
}

async function clearHistory() {
  if (!confirm("Supprimer définitivement tout l'historique des tâches terminées ?")) return;
  tasks.filter(t => t.done).forEach(t => addDeletedId(DELETED_TASKS_KEY, t.id));
  tasks = tasks.filter(t => !t.done);
  render();
  await syncTasks();
}

// ---------- Subtasks ----------
async function addSubtask(taskId) {
  const t = tasks.find(x => x.id === taskId);
  if (!t) return;
  const text = prompt('Nouvelle sous-tâche :');
  if (!text || !text.trim()) return;
  t.subtasks = t.subtasks || [];
  t.subtasks.push({ id: uid(), text: text.trim(), done: false });
  t.modifiedAt = Date.now();
  render();
  await syncTasks();
}

async function toggleSubtask(taskId, subId) {
  const t = tasks.find(x => x.id === taskId);
  if (!t) return;
  const s = (t.subtasks || []).find(x => x.id === subId);
  if (!s) return;
  s.done = !s.done;
  t.modifiedAt = Date.now();
  render();
  await syncTasks();
}

async function deleteSubtask(taskId, subId) {
  const t = tasks.find(x => x.id === taskId);
  if (!t) return;
  t.subtasks = (t.subtasks || []).filter(x => x.id !== subId);
  t.modifiedAt = Date.now();
  render();
  await syncTasks();
}

// ---------- Photos ----------
function openPhotoPicker(taskId) {
  pendingPhotoTaskId = taskId;
  document.getElementById('photoInput').click();
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 480;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.55));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function onPhotoSelected(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || !pendingPhotoTaskId) return;
  const t = tasks.find(x => x.id === pendingPhotoTaskId);
  pendingPhotoTaskId = null;
  if (!t) return;
  try {
    const dataUrl = await compressImage(file);
    t.photo = dataUrl;
    t.modifiedAt = Date.now();
    render();
    await syncTasks();
  } catch (e) {
    alert("Impossible de traiter cette photo.");
  }
}

async function removePhoto(taskId) {
  const t = tasks.find(x => x.id === taskId);
  if (!t) return;
  t.photo = null;
  t.modifiedAt = Date.now();
  render();
  await syncTasks();
}

function showLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.add('show');
}
function hideLightbox() {
  document.getElementById('lightbox').classList.remove('show');
}

// ---------- Shopping list ----------
async function addShoppingItem() {
  const el = document.getElementById('newShoppingItem');
  const text = el.value.trim();
  if (!text) return;
  shopping.push({ id: uid(), text, done: false, createdAt: Date.now(), modifiedAt: Date.now() });
  el.value = '';
  renderShopping();
  await syncShopping();
}

async function toggleShoppingItem(id) {
  const item = shopping.find(x => x.id === id);
  if (!item) return;
  item.done = !item.done;
  item.modifiedAt = Date.now();
  renderShopping();
  await syncShopping();
}

async function deleteShoppingItem(id) {
  addDeletedId(DELETED_SHOPPING_KEY, id);
  shopping = shopping.filter(x => x.id !== id);
  renderShopping();
  await syncShopping();
}

function renderShopping() {
  const list = document.getElementById('shoppingList');
  if (shopping.length === 0) {
    list.innerHTML = `<div class="empty"><div class="big">Liste vide</div>Ajoutez un article ci-dessus.</div>`;
    return;
  }
  const sorted = [...shopping].sort((a, b) => (a.done - b.done) || (a.createdAt - b.createdAt));
  list.innerHTML = sorted.map(item => `
    <div class="shopping-item">
      <div class="check ${item.done ? 'checked' : ''}" onclick="toggleShoppingItem('${item.id}')">${item.done ? '✓' : ''}</div>
      <div class="shopping-text ${item.done ? 'done' : ''}">${escapeHtml(item.text)}</div>
      <button class="del-btn" onclick="deleteShoppingItem('${item.id}')">×</button>
    </div>
  `).join('');
}

// ---------- Helpers ----------
function isOverdue(t) {
  if (t.done || !t.date) return false;
  return new Date(t.date + 'T' + (t.time || '23:59')).getTime() < Date.now();
}
function isDueToday(t) { return t.date === todayStr(); }
function dueLabel(t) {
  if (!t.date) return null;
  const d = new Date(t.date + 'T00:00:00');
  const label = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return t.time ? `${label}, ${t.time}` : label;
}
function whoLabel(w) { return NAMES[normalizeAssignee(w)]; }
function priorityLabel(p) { return p === 'high' ? 'Haute' : p === 'low' ? 'Basse' : 'Moyenne'; }
function recurringLabel(r) { return r === 'daily' ? 'Quotidien' : r === 'weekly' ? 'Hebdo' : r === 'monthly' ? 'Mensuel' : null; }
function reminderLabel(offset) {
  if (!offset) return null;
  return offset === 7 ? 'Rappel 1 sem. avant' : `Rappel ${offset}j avant`;
}
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ---------- Render ----------
function render() {
  renderTemplates();
  const list = document.getElementById('taskList');
  let visible = tasks.filter(t => !t.done);
  visible = visible.filter(t => filter === 'todos' || normalizeAssignee(t.assignee) === filter || normalizeAssignee(t.assignee) === 'ambos');
  if (todayOnly) visible = visible.filter(t => isDueToday(t) || isOverdue(t));

  visible.sort((a, b) => {
    const ad = a.date ? new Date(a.date + 'T' + (a.time || '23:59')).getTime() : Infinity;
    const bd = b.date ? new Date(b.date + 'T' + (b.time || '23:59')).getTime() : Infinity;
    return ad - bd;
  });

  if (visible.length === 0) {
    list.innerHTML = `<div class="empty"><div class="big">Rien par ici</div>Ajoutez votre première tâche ci-dessus.</div>`;
  } else {
    const groups = {};
    visible.forEach(t => { (groups[t.category] = groups[t.category] || []).push(t); });

    list.innerHTML = Object.entries(groups).map(([cat, items]) => {
      const cards = items.map(t => renderTaskCard(t)).join('');
      return `<div class="group"><div class="group-title">${escapeHtml(cat)}</div>${cards}</div>`;
    }).join('');
  }

  renderHistory();
  renderShopping();
}

function renderTaskCard(t) {
  const who = normalizeAssignee(t.assignee);
  const priority = normalizePriority(t.priority);
  const overdue = isOverdue(t);
  const due = dueLabel(t);
  const rec = recurringLabel(t.recurring);
  const rem = reminderLabel(t.reminderOffset);
  const subtasks = t.subtasks || [];

  const subtaskHtml = subtasks.length ? `
    <div class="subtask-list">
      ${subtasks.map(s => `
        <div class="subtask-row">
          <div class="subtask-check ${s.done ? 'checked' : ''}" onclick="toggleSubtask('${t.id}','${s.id}')">${s.done ? '✓' : ''}</div>
          <div class="subtask-text ${s.done ? 'done' : ''}">${escapeHtml(s.text)}</div>
          <button class="subtask-del" onclick="deleteSubtask('${t.id}','${s.id}')">×</button>
        </div>
      `).join('')}
    </div>` : '';

  const photoHtml = t.photo ? `
    <div class="photo-thumb-wrap">
      <img class="photo-thumb" src="${t.photo}" onclick="showLightbox('${t.photo}')">
      <button class="photo-remove" onclick="removePhoto('${t.id}')">×</button>
    </div>` : '';

  return `
    <div class="task tag-${who}">
      <div class="check" onclick="toggleDone('${t.id}')"></div>
      <div class="task-body">
        <div class="task-title-row">
          <span class="priority-dot ${priority}" title="Priorité ${priorityLabel(priority).toLowerCase()}"></span>
          <span class="task-title">${escapeHtml(t.title)}</span>
        </div>
        <div class="task-meta">
          <span class="chip who tag-${who}">${NAMES[who]}</span>
          ${due ? `<span class="chip due ${overdue ? 'overdue' : ''}">${overdue ? 'En retard · ' : ''}${due}</span>` : ''}
          ${rec ? `<span class="chip recurring">${rec}${t.rotate ? ' · alterne' : ''}</span>` : ''}
          ${rem ? `<span class="chip reminder">${rem}</span>` : ''}
          ${subtasks.length ? `<span class="chip">${subtasks.filter(s => s.done).length}/${subtasks.length}</span>` : ''}
        </div>
        ${subtaskHtml}
        ${photoHtml}
        <div class="task-actions">
          <button onclick="addSubtask('${t.id}')">➕ Sous-tâche</button>
          <button onclick="openPhotoPicker('${t.id}')">📷 Photo</button>
        </div>
      </div>
      <button class="del-btn" onclick="deleteTask('${t.id}')">×</button>
    </div>`;
}

function renderHistory() {
  const done = tasks.filter(t => t.done).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  document.getElementById('historySummary').textContent = `Historique (${done.length})`;
  const list = document.getElementById('historyList');
  if (done.length === 0) {
    list.innerHTML = `<div class="empty" style="padding:16px 0;">Aucune tâche terminée pour l'instant.</div>`;
    return;
  }
  list.innerHTML = done.map(t => {
    const dateStr = t.completedAt ? new Date(t.completedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    return `
      <div class="history-item">
        <div class="check checked" onclick="toggleDone('${t.id}')">✓</div>
        <div class="h-title">${escapeHtml(t.title)}</div>
        <div class="h-date">${dateStr}</div>
        <button class="del-btn" onclick="deleteTask('${t.id}')">×</button>
      </div>`;
  }).join('');
}

// ---------- Notifications ----------
function requestNotif() {
  if (!('Notification' in window)) { alert('Ce navigateur ne prend pas en charge les notifications.'); return; }
  Notification.requestPermission().then(p => {
    if (p === 'granted') {
      document.getElementById('notifBanner').style.display = 'none';
      localStorage.setItem('notif-dismissed', '1');
    }
  });
}
if ('Notification' in window && Notification.permission === 'default' && !localStorage.getItem('notif-dismissed')) {
  document.getElementById('notifBanner').style.display = 'flex';
}

function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body }); } catch (e) {}
}

function checkAlerts() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = Date.now();

  tasks.forEach(t => {
    if (t.done || !t.date) return;
    const due = new Date(t.date + 'T' + (t.time || '23:59')).getTime();

    if (due < now && !overdueNotified.has(t.id)) {
      overdueNotified.add(t.id);
      notify('Tâche en retard : ' + t.title, `${whoLabel(t.assignee)} · ${t.category}`);
    }

    const offsetDays = t.reminderOffset || 0;
    if (offsetDays > 0) {
      const reminderTime = due - offsetDays * 24 * 60 * 60 * 1000;
      if (now >= reminderTime && now < due && !reminderNotified.has(t.id)) {
        reminderNotified.add(t.id);
        notify('Rappel : ' + t.title, `Échéance dans ${offsetDays} jour(s) · ${whoLabel(t.assignee)}`);
      }
    }
  });

  checkDailySummary();
  checkWeeklySummary();
}

function checkDailySummary() {
  const now = new Date();
  if (now.getHours() < 8) return;
  const stored = localStorage.getItem('last-daily-summary');
  const today = todayStr();
  if (stored === today) return;
  localStorage.setItem('last-daily-summary', today);

  const dueToday = tasks.filter(t => !t.done && (isDueToday(t) || isOverdue(t)));
  if (dueToday.length === 0) return;
  notify('Résumé du jour', `${dueToday.length} tâche(s) à faire aujourd'hui ou en retard.`);
}

function checkWeeklySummary() {
  const now = new Date();
  if (now.getDay() !== 1 || now.getHours() < 8) return; // Monday only
  const stored = localStorage.getItem('last-weekly-summary');
  const today = todayStr();
  if (stored === today) return;
  localStorage.setItem('last-weekly-summary', today);

  const in7days = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const upcoming = tasks.filter(t => !t.done && t.date && new Date(t.date).getTime() <= in7days);
  if (upcoming.length === 0) return;
  const countAlejo = upcoming.filter(t => normalizeAssignee(t.assignee) === 'alejo').length;
  const countNajwa = upcoming.filter(t => normalizeAssignee(t.assignee) === 'najwa').length;
  notify('Résumé de la semaine', `${upcoming.length} tâche(s) prévues. Alejo: ${countAlejo} · Najwa: ${countNajwa}`);
}

// ---------- Init ----------
render();
pullFromCloud();
setInterval(() => { pullFromCloud(); checkAlerts(); }, 30000);
window.addEventListener('online', () => { syncTasks(); syncShopping(); pullFromCloud(); });
window.addEventListener('offline', () => setSyncStatus('error'));

document.getElementById('newTitle').addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
document.getElementById('newShoppingItem').addEventListener('keydown', e => { if (e.key === 'Enter') addShoppingItem(); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
