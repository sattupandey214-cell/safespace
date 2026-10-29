let token = localStorage.t, me = JSON.parse(localStorage.me || 'null'), socket, current = null;
const $ = (id) => document.getElementById(id);
const HELPLINE = 'Aap akele nahi hain. Abhi baat karni ho to Tele-MANAS 14416 (free, 24x7) par call karein. Emergency mein 112.';

let pendingAuthData = null;
let currentSelectedRole = 'person';
let selectedReportReason = 'Harassment';

const api = (p, o = {}) => fetch('/api/' + p, {
  method: o.method || 'GET',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: o.body ? JSON.stringify(o.body) : undefined
}).then((r) => r.json());

// XSS-Safe Element Builder: Uses textContent exclusively, NEVER innerHTML
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Role badge generator
function badge(role, verified) {
  const b = el('span', 'badge ' + role, role[0].toUpperCase() + role.slice(1));
  if (!verified || role === 'person') return b;
  const w = el('span', 'row');
  w.append(b, el('span', 'ver', 'Verified'));
  return w;
}

// Deterministic Soft Pastel Avatar Colors from alias hash
function getAvatarBg(alias) {
  let hash = 0;
  for (let i = 0; i < (alias || '').length; i++) hash = (hash << 5) - hash + alias.charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 45%, 88%)`;
}

function getAvatarColor(alias) {
  let hash = 0;
  for (let i = 0; i < (alias || '').length; i++) hash = (hash << 5) - hash + alias.charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 26%)`;
}

function createAvatar(alias, role) {
  const av = el('div', 'avatar-circle');
  av.style.backgroundColor = getAvatarBg(alias || 'User');
  av.style.color = getAvatarColor(alias || 'User');
  av.textContent = (alias || 'U').charAt(0).toUpperCase();
  return av;
}

// Relative time formatting
function timeAgo(ts) {
  if (!ts) return '';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'Abhi';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm pehle';
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return hrs + 'h pehle';
  const days = Math.floor(hrs / 24);
  return days + 'd pehle';
}

// In-App Toast Notification (Auto dismiss ~4s)
function showToast(msg, type = 'info', onClick = null) {
  const container = $('toast-container');
  if (!container) return;
  const t = el('div', 'toast' + (type === 'error' ? ' toast-error' : ''), msg);
  if (onClick) {
    t.style.cursor = 'pointer';
    t.onclick = () => { onClick(); t.remove(); };
  }
  container.append(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateY(12px)';
    setTimeout(() => t.remove(), 250);
  }, 4000);
}

// Crisis Modal Controls
const crisisNote = () => {
  const modal = $('modal-crisis');
  if (modal) modal.classList.remove('hidden');
};

function closeCrisisModal() {
  const modal = $('modal-crisis');
  if (modal) modal.classList.add('hidden');
}

// Role Selection on Landing Screen
function selectRole(role) {
  currentSelectedRole = role;
  for (const r of ['person', 'therapist', 'psychiatrist']) {
    const card = $('role-' + r);
    if (card) {
      card.classList.toggle('active', r === role);
      card.setAttribute('aria-checked', r === role ? 'true' : 'false');
    }
  }
}

function submitRegistration() {
  register(currentSelectedRole);
}

// ---------- Auth ----------
async function register(role) {
  const d = await api('register', { method: 'POST', body: { role } });
  if (d.error) return showToast(d.error, 'error');

  pendingAuthData = d;
  const display = $('display-code');
  if (display) display.textContent = d.code;

  const cb = $('check-code-saved');
  if (cb) cb.checked = false;

  const btnConfirm = $('btn-confirm-code');
  if (btnConfirm) btnConfirm.disabled = true;

  const status = $('copy-status');
  if (status) status.textContent = 'Copy';

  const modal = $('modal-code');
  if (modal) modal.classList.remove('hidden');
}

function handleCodeCheckChange() {
  const cb = $('check-code-saved');
  const btn = $('btn-confirm-code');
  if (btn && cb) btn.disabled = !cb.checked;
}

async function copySecretCode() {
  const codeEl = $('display-code');
  if (!codeEl) return;
  const code = codeEl.textContent;
  try {
    await navigator.clipboard.writeText(code);
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const status = $('copy-status');
  if (status) {
    status.textContent = 'Copied ✓';
    setTimeout(() => { status.textContent = 'Copy'; }, 2500);
  }
  showToast('Secret code copy ho gaya! ✓');
}

function proceedAfterCodeSave() {
  const modal = $('modal-code');
  if (modal) modal.classList.add('hidden');
  if (pendingAuthData) {
    start(pendingAuthData);
    pendingAuthData = null;
  }
}

async function login() {
  const codeInput = $('code');
  const code = codeInput ? codeInput.value.trim() : '';
  if (!code) return showToast('Kripya apna secret code dalein.', 'error');

  const d = await api('login', { method: 'POST', body: { code } });
  if (d.error) return showToast(d.error, 'error');
  start(d);
}

function start(d) {
  token = d.token;
  me = { alias: d.alias, role: d.role, verified: d.verified };
  localStorage.t = token;
  localStorage.me = JSON.stringify(me);

  socket = io({ auth: { token } });
  socket.on('connect_error', logout);
  socket.on('dm', (m) => {
    if (m.from === current && !$('chat').classList.contains('hidden')) {
      addMsg(m.body, false);
    } else {
      showToast('Naya message aaya: ' + m.from + ' (' + m.role + ')', 'info', () => {
        openChat(m.from, m.role);
      });
    }
  });

  $('auth').classList.add('hidden');
  $('app').classList.remove('hidden');

  const userAvatar = createAvatar(me.alias, me.role);
  userAvatar.style.width = '28px';
  userAvatar.style.height = '28px';
  userAvatar.style.fontSize = '12px';

  $('me').replaceChildren(userAvatar, el('span', null, 'Aap: ' + me.alias + ' '), badge(me.role, me.verified));
  tab('feed');
}

function logout() {
  localStorage.clear();
  location.reload();
}

// ---------- Tabs ----------
function tab(name) {
  for (const t of ['feed', 'people', 'chat']) {
    $(t).classList.toggle('hidden', t !== name);
    const tabBtn = $('t-' + t);
    if (tabBtn) {
      tabBtn.classList.toggle('on', t === name);
      tabBtn.setAttribute('aria-selected', t === name ? 'true' : 'false');
    }
  }
  if (name === 'feed') loadPosts();
  if (name === 'people') loadPeople();
  if (name === 'chat' && !current) renderEmptyChatPrompt();
}

// ---------- Posts ----------
function updatePostCounter() {
  const val = $('post') ? $('post').value : '';
  const counter = $('post-counter');
  if (counter) counter.textContent = val.length + ' / 1000';
  const postBtn = $('btn-post');
  if (postBtn) postBtn.disabled = !val.trim();
}

async function loadPosts() {
  const list = await api('posts');
  const box = $('posts');
  box.replaceChildren();
  if (list.error) return logout();

  if (!list.length) {
    const empty = el('div', 'empty-state');
    const icon = el('div', 'empty-state-icon', '📝');
    const title = el('div', 'empty-state-title', 'Abhi koi post nahi hai');
    const desc = el('p', 'empty-state-desc mute', 'Pehli post aap karein aur apni baat share karein.');
    empty.append(icon, title, desc);
    box.append(empty);
    return;
  }

  for (const p of list) {
    const card = el('div', 'post-card');
    const header = el('div', 'post-header');
    const avatar = createAvatar(p.alias, p.role);
    const meta = el('div', 'post-meta');
    const metaTop = el('div', 'post-meta-top');
    const aliasEl = el('span', 'post-alias', p.alias);
    const roleBadge = badge(p.role, p.verified);
    metaTop.append(aliasEl, roleBadge);

    const timeEl = el('span', 'post-time', timeAgo(p.ts));
    meta.append(metaTop, timeEl);
    header.append(avatar, meta);

    const bodyEl = el('div', 'post-body', p.body);
    card.append(header, bodyEl);
    box.append(card);
  }
}

async function sendPost() {
  const body = $('post').value;
  if (!body.trim()) return;

  const d = await api('posts', { method: 'POST', body: { body } });
  if (d.error) return showToast(d.error, 'error');

  $('post').value = '';
  updatePostCounter();
  loadPosts();
  if (d.crisis) crisisNote();
}

// ---------- Random people + chat ----------
async function loadPeople() {
  const refreshBtn = $('btn-load-people');
  const icon = refreshBtn ? refreshBtn.querySelector('.btn-icon') : null;
  if (icon) icon.classList.add('refresh-icon-spin');

  const list = await api('people');
  if (icon) setTimeout(() => icon.classList.remove('refresh-icon-spin'), 600);

  const box = $('plist');
  box.replaceChildren();

  if (!list || !list.length) {
    const empty = el('div', 'empty-state');
    const iconEl = el('div', 'empty-state-icon', '🌱');
    const title = el('div', 'empty-state-title', 'Abhi aur log online nahi hain');
    const desc = el('p', 'empty-state-desc mute', 'Thodi der baad dobara check karein.');
    empty.append(iconEl, title, desc);
    box.append(empty);
    return;
  }

  for (const u of list) {
    const card = el('div', 'person-card');
    const avatar = createAvatar(u.alias, u.role);
    const info = el('div', 'person-info');
    const aliasEl = el('span', 'person-alias', u.alias);
    const roleBadge = badge(u.role, u.verified);
    info.append(aliasEl, roleBadge);

    const msgBtn = el('button', 'btn btn-secondary btn-sm', 'Message');
    msgBtn.onclick = () => openChat(u.alias, u.role);

    card.append(avatar, info, msgBtn);
    box.append(card);
  }
}

function renderEmptyChatPrompt() {
  if (current) return;
  $('with').textContent = 'Kisi ko chunein (Random log tab se)';
  const chatAvatar = $('chat-avatar');
  if (chatAvatar) {
    chatAvatar.style.backgroundColor = '';
    chatAvatar.style.color = '';
    chatAvatar.textContent = '💬';
  }
  $('msgs').replaceChildren();
  const empty = el('div', 'empty-state');
  const icon = el('div', 'empty-state-icon', '💬');
  const title = el('div', 'empty-state-title', 'Koi chat chuni nahi gayi');
  const desc = el('p', 'empty-state-desc mute', 'Random log tab se kisi ko message karein aur baat cheet karein.');
  empty.append(icon, title, desc);
  $('msgs').append(empty);
}

async function openChat(alias, role) {
  current = alias;
  tab('chat');
  $('with').textContent = alias + ' (' + role + ')';

  const chatAvatar = $('chat-avatar');
  if (chatAvatar) {
    chatAvatar.style.backgroundColor = getAvatarBg(alias);
    chatAvatar.style.color = getAvatarColor(alias);
    chatAvatar.textContent = alias.charAt(0).toUpperCase();
  }

  const list = await api('messages/' + encodeURIComponent(alias));
  $('msgs').replaceChildren();

  if (!list || !list.length) {
    const empty = el('div', 'empty-state');
    const title = el('div', 'empty-state-title', 'Baat cheet shuru karein');
    const desc = el('p', 'empty-state-desc mute', 'Pehla message bhej kar safe conversation shuru karein.');
    empty.append(title, desc);
    $('msgs').append(empty);
  } else {
    list.forEach((m) => addMsg(m.body, !!m.mine));
  }
}

function addMsg(body, mine) {
  const empty = $('msgs').querySelector('.empty-state');
  if (empty) empty.remove();

  const d = el('div', 'm' + (mine ? ' mine' : ''), body);
  $('msgs').append(d);
  d.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function sendDM() {
  const body = $('txt').value.trim();
  if (!body || !current) return;

  socket.emit('dm', { to: current, body }, (r) => {
    if (!r || !r.ok) return showToast('Message nahi gaya (shayad user ne block kiya hai).', 'error');
    addMsg(body, true);
    $('txt').value = '';
    if (r.crisis) crisisNote();
  });
}

// ---------- Safety: Block & Report ----------
function blockCur() {
  if (!current) return;
  const modal = $('modal-block');
  const text = $('block-confirm-text');
  if (text) {
    text.textContent = 'Kya aap ' + current + ' ko block karna chahte hain? Iske baad aap dono ek doosre ko message nahi kar payenge.';
  }
  if (modal) modal.classList.remove('hidden');
}

function closeBlockModal() {
  const modal = $('modal-block');
  if (modal) modal.classList.add('hidden');
}

async function confirmBlock() {
  if (!current) return;
  const blockedAlias = current;
  closeBlockModal();

  await api('block', { method: 'POST', body: { alias: blockedAlias } });
  current = null;
  $('msgs').replaceChildren();
  $('with').textContent = 'Blocked.';

  const chatAvatar = $('chat-avatar');
  if (chatAvatar) {
    chatAvatar.style.backgroundColor = '';
    chatAvatar.style.color = '';
    chatAvatar.textContent = '🚫';
  }

  showToast(blockedAlias + ' ko block kar diya gaya hai.');
}

function reportCur() {
  if (!current) return;
  selectedReportReason = 'Harassment';
  document.querySelectorAll('.reason-chip').forEach((c, idx) => c.classList.toggle('active', idx === 0));

  const note = $('report-note');
  if (note) note.value = '';

  const modal = $('modal-report');
  if (modal) modal.classList.remove('hidden');
}

function selectReportReason(btn, reason) {
  selectedReportReason = reason;
  document.querySelectorAll('.reason-chip').forEach((c) => c.classList.remove('active'));
  btn.classList.add('active');
}

function closeReportModal() {
  const modal = $('modal-report');
  if (modal) modal.classList.add('hidden');
}

async function submitReport() {
  if (!current) return;
  const reportedAlias = current;
  const note = $('report-note') ? $('report-note').value.trim() : '';
  const reason = note ? selectedReportReason + ': ' + note : selectedReportReason;

  closeReportModal();
  await api('report', { method: 'POST', body: { alias: reportedAlias, reason } });
  showToast('Report bhej di gayi. Dhanyavaad.');
}

// Auto-start if session exists
if (token && me) start({ token, ...me });
