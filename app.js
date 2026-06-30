// ---------- Local offline storage ----------
const LOCAL_KEY = 'quehaceres-tasks-v1';
const PENDING_KEY = 'quehaceres-pending-v1'; // queue of edits made while offline

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || []; }
  catch (e) { return []; }
}
function saveLocal(tasks) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(tasks));
}

let tasks = loadLocal();
let filter = 'todos';
let notifiedIds = new Set();
let configured = SUPABASE_URL && !SUPABASE_URL.includes('PEGAR_ACA');

const todayLabel = document.getElementById('todayLabel');
todayLabel.textContent = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

if (!configured) {
  setSyncStatus('noconfig');
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

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

async function pullFromCloud() {
  if (!configured) return;
  setSyncStatus('loading');
  try {
    const res = await sbFetch('tasks_store?id=eq.main&select=data,updated_at');
    const rows = await res.json();
    if (rows.length > 0 && rows[0].data) {
      tasks = rows[0].data;
      saveLocal(tasks);
    }
    setSyncStatus('ok');
  } catch (e) {
    setSyncStatus('error');
  }
  render();
}

async function pushToCloud() {
  saveLocal(tasks);
  if (!configured) { setSyncStatus('noconfig'); return; }
  if (!navigator.onLine) { setSyncStatus('error'); return; }
  setSyncStatus('saving');
  try {
    await sbFetch('tasks_store', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ id: 'main', data: tasks, updated_at: new Date().toISOString() })
    });
    setSyncStatus('ok');
  } catch (e) {
    setSyncStatus('error');
  }
}

function setSyncStatus(state) {
  const dot = document.getElementById('syncDot');
  const text = document.getElementById('syncText');
  if (state === 'noconfig') { dot.className = 'dot off'; text.textContent = 'Falta configurar Supabase en config.js'; return; }
  if (state === 'loading') { dot.className = 'dot'; text.textContent = 'Sincronizando…'; return; }
  if (state === 'saving') { dot.className = 'dot'; text.textContent = 'Guardando…'; return; }
  if (state === 'ok') { dot.className = 'dot'; text.textContent = 'Sincronizado · visible para ambos'; return; }
  dot.className = 'dot off';
  text.textContent = navigator.onLine ? 'No se pudo sincronizar' : 'Sin conexión — se guarda localmente';
}

// ---------- UI actions ----------
function toggleMore() { document.getElementById('moreFields').classList.toggle('show'); }

function setFilter(who) {
  filter = who;
  document.querySelectorAll('.who-tab').forEach(t => t.classList.toggle('active', t.dataset.who === who));
  render();
}

async function addTask() {
  const titleEl = document.getElementById('newTitle');
  const title = titleEl.value.trim();
  if (!title) return;
  tasks.push({
    id: uid(),
    title,
    category: document.getElementById('newCategory').value,
    assignee: document.getElementById('newAssignee').value,
    date: document.getElementById('newDate').value || null,
    time: document.getElementById('newTime').value || null,
    recurring: document.getElementById('newRecurring').value,
    done: false,
    createdAt: Date.now()
  });
  titleEl.value = '';
  document.getElementById('newDate').value = '';
  document.getElementById('newTime').value = '';
  document.getElementById('newRecurring').value = 'none';
  render();
  await pushToCloud();
}

async function toggleDone(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;
  if (t.done && t.recurring !== 'none' && t.date) {
    const d = new Date(t.date + 'T00:00:00');
    if (t.recurring === 'daily') d.setDate(d.getDate() + 1);
    if (t.recurring === 'weekly') d.setDate(d.getDate() + 7);
    if (t.recurring === 'monthly') d.setMonth(d.getMonth() + 1);
    tasks.push({ ...t, id: uid(), done: false, date: d.toISOString().slice(0, 10), createdAt: Date.now() });
  }
  render();
  await pushToCloud();
}

async function deleteTask(id) {
  tasks = tasks.filter(x => x.id !== id);
  render();
  await pushToCloud();
}

function isOverdue(t) {
  if (t.done || !t.date) return false;
  return new Date(t.date + 'T' + (t.time || '23:59')).getTime() < Date.now();
}
function dueLabel(t) {
  if (!t.date) return null;
  const d = new Date(t.date + 'T00:00:00');
  const label = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  return t.time ? `${label}, ${t.time}` : label;
}
function whoLabel(w) { return w === 'alejito' ? 'Alejo' : w === 'najwa' ? 'Najwa' : 'Ambos'; }
function recurringLabel(r) { return r === 'daily' ? 'Diario' : r === 'weekly' ? 'Semanal' : r === 'monthly' ? 'Mensual' : null; }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function render() {
  const list = document.getElementById('taskList');
  let visible = tasks.filter(t => filter === 'todos' || t.assignee === filter || t.assignee === 'ambos');
  visible.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ad = a.date ? new Date(a.date + 'T' + (a.time || '23:59')).getTime() : Infinity;
    const bd = b.date ? new Date(b.date + 'T' + (b.time || '23:59')).getTime() : Infinity;
    return ad - bd;
  });

  if (visible.length === 0) {
    list.innerHTML = `<div class="empty"><div class="big">Nada por acá</div>Agregá la primera tarea arriba.</div>`;
    return;
  }

  const groups = {};
  visible.forEach(t => { (groups[t.category] = groups[t.category] || []).push(t); });

  list.innerHTML = Object.entries(groups).map(([cat, items]) => {
    const cards = items.map(t => {
      const overdue = isOverdue(t);
      const due = dueLabel(t);
      const rec = recurringLabel(t.recurring);
      return `
        <div class="task tag-${t.assignee} ${t.done ? 'done' : ''}">
          <div class="check ${t.done ? 'checked' : ''}" onclick="toggleDone('${t.id}')">${t.done ? '✓' : ''}</div>
          <div class="task-body">
            <div class="task-title">${escapeHtml(t.title)}</div>
            <div class="task-meta">
              <span class="chip who tag-${t.assignee}">${whoLabel(t.assignee)}</span>
              ${due ? `<span class="chip due ${overdue ? 'overdue' : ''}">${overdue ? 'Vencida · ' : ''}${due}</span>` : ''}
              ${rec ? `<span class="chip recurring">${rec}</span>` : ''}
            </div>
          </div>
          <button class="del" onclick="deleteTask('${t.id}')">×</button>
        </div>`;
    }).join('');
    return `<div class="group"><div class="group-title">${cat}</div>${cards}</div>`;
  }).join('');
}

// ---------- Notifications ----------
function requestNotif() {
  if (!('Notification' in window)) { alert('Este navegador no soporta notificaciones.'); return; }
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
function checkAlerts() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  tasks.forEach(t => {
    if (t.done || !t.date) return;
    if (isOverdue(t) && !notifiedIds.has(t.id)) {
      notifiedIds.add(t.id);
      try { new Notification('Tarea vencida: ' + t.title, { body: `${whoLabel(t.assignee)} · ${t.category}` }); } catch (e) {}
    }
  });
}

// ---------- Init ----------
render();
pullFromCloud();
setInterval(() => { pullFromCloud(); checkAlerts(); }, 30000);
window.addEventListener('online', () => { pushToCloud(); pullFromCloud(); });
window.addEventListener('offline', () => setSyncStatus('error'));

document.getElementById('newTitle').addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
