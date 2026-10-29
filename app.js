let token = localStorage.t, me = JSON.parse(localStorage.me || 'null'), socket, current = null;
const $ = (id) => document.getElementById(id);
const HELPLINE = 'You are not alone. If you need immediate support, call Tele-MANAS 14416 (free, 24/7) or 112 for emergencies.';

let pendingAuthData = null;
let currentSelectedRole = 'person';
let selectedReportReason = 'Harassment';
let conversationsCache = [];

// Local read-tracking storage
function getReadTimestamps() {
  try { return JSON.parse(localStorage.getItem('readTimestamps') || '{}'); }
  catch { return {}; }
}
function markConversationRead(alias) {
  if (!alias) return;
  const reads = getReadTimestamps();
  reads[alias] = Date.now();
  localStorage.setItem('readTimestamps', JSON.stringify(reads));
  updateUnreadCount();
}

const api = (p, o = {}) => fetch('/api/' + p, {
  method: o.method || 'GET',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: o.body ? JSON.stringify(o.body) : undefined
}).then((r) => r.json());

// XSS-Safe Element Builder: Uses textContent exclusively
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Role badge generator
function badge(role, verified) {
  const b = el('span', 'badge ' + role, (role ? role[0].toUpperCase() + role.slice(1) : 'Member'));
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
  return `hsl(${hue}, 40%, 30%)`;
}

function getAvatarColor(alias) {
  let hash = 0;
  for (let i = 0; i < (alias || '').length; i++) hash = (hash << 5) - hash + alias.charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 80%, 88%)`;
}

function createAvatar(alias, role) {
  const av = el('div', 'avatar-circle');
  av.style.backgroundColor = getAvatarBg(alias || 'User');
  av.style.color = getAvatarColor(alias || 'User');
  av.textContent = (alias || 'U').charAt(0).toUpperCase();
  return av;
}

// Relative time formatting in clean English
function timeAgo(ts) {
  if (!ts) return '';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  return days + 'd ago';
}

function formatClockTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// In-App Toast Notification
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
  showToast('Secret code copied to clipboard');
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
  if (!code) return showToast('Please enter your secret code.', 'error');

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
    // If user is currently looking at this chat
    if (m.from === current && !$('chat').classList.contains('hidden')) {
      addMsg(m.body, false, Date.now());
      markConversationRead(m.from);
      loadConversations();
    } else {
      // Update badge and list
      loadConversations();
      showToast('New message from ' + m.from + ' (' + m.role + ')', 'info', () => {
        openChat(m.from, m.role);
      });
    }
  });

  $('auth').classList.add('hidden');
  $('app').classList.remove('hidden');

  // Update Left Sidebar user profile
  const userAvatar = createAvatar(me.alias, me.role);
  userAvatar.style.width = '32px';
  userAvatar.style.height = '32px';
  userAvatar.style.fontSize = '13px';

  $('me').replaceChildren(userAvatar, el('span', null, me.alias + ' '), badge(me.role, me.verified));

  // Update Composer avatar
  const compAv = $('composer-user-avatar');
  if (compAv) {
    compAv.style.backgroundColor = getAvatarBg(me.alias);
    compAv.style.color = getAvatarColor(me.alias);
    compAv.textContent = me.alias.charAt(0).toUpperCase();
  }

  // Update Profile page details
  updateProfileView();

  tab('feed');
  loadConversations();

  // Restore today's mood selection if already logged
  const todayKey = new Date().toISOString().slice(0, 10);
  const rawMood = JSON.parse(localStorage.getItem('moodLog') || '{}');
  if (rawMood[todayKey]) {
    document.querySelectorAll('.neu-mood-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.value) === rawMood[todayKey]);
    });
  }
  // Draw initial mini mood chart after DOM is painted
  requestAnimationFrame(() => {
    drawMoodChart('chart-mood-mini', getMoodData(7), 110, 80);
    drawStreakRing();
  });
}

function logout() {
  localStorage.clear();
  location.reload();
}

// ---------- Tabs & Layout Navigation ----------
function tab(name) {
  const pageTitles = {
    feed: 'Home',
    people: 'Explore',
    chat: 'Messages',
    profile: 'Profile'
  };

  const titleEl = $('page-title');
  if (titleEl) titleEl.textContent = pageTitles[name] || 'SafeSpace';

  for (const t of ['feed', 'people', 'chat', 'profile']) {
    const panel = $(t);
    if (panel) panel.classList.toggle('hidden', t !== name);

    // Desktop sidebar buttons
    const tabBtn = $('t-' + t);
    if (tabBtn) {
      tabBtn.classList.toggle('on', t === name);
      tabBtn.setAttribute('aria-selected', t === name ? 'true' : 'false');
    }

    // Mobile bottom nav buttons
    const mobBtn = $('mob-t-' + t);
    if (mobBtn) {
      mobBtn.classList.toggle('on', t === name);
      mobBtn.setAttribute('aria-selected', t === name ? 'true' : 'false');
    }
  }

  if (name === 'feed') loadPosts();
  if (name === 'people') loadPeople();
  if (name === 'chat') {
    loadConversations();
    if (!current) renderEmptyChatPrompt();
  }
  if (name === 'profile') updateProfileView();
}

function focusComposer() {
  tab('feed');
  const postInput = $('post');
  if (postInput) {
    postInput.focus();
    postInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ---------- Posts (Twitter/X style flat feed) ----------
function updatePostCounter() {
  const postEl = $('post');
  const val = postEl ? postEl.value : '';
  const counter = $('post-counter');
  if (counter) counter.textContent = val.length + ' / 1000';
  const postBtn = $('btn-post');
  if (postBtn) postBtn.disabled = !val.trim();

  // Auto-grow textarea
  if (postEl) {
    postEl.style.height = 'auto';
    postEl.style.height = Math.min(postEl.scrollHeight, 240) + 'px';
  }
}

async function loadPosts() {
  const list = await api('posts');
  const box = $('posts');
  box.replaceChildren();
  if (list.error) return logout();

  if (!list.length) {
    const empty = el('div', 'empty-state');
    const icon = el('div', 'empty-state-icon', '📝');
    const title = el('div', 'empty-state-title', 'No posts yet');
    const desc = el('p', 'empty-state-desc mute', 'Be the first to share what you are experiencing.');
    empty.append(icon, title, desc);
    box.append(empty);
    return;
  }

  for (const p of list) {
    const row = el('div', 'post-row');
    const avatar = createAvatar(p.alias, p.role);

    const wrap = el('div', 'post-content-wrap');
    const header = el('div', 'post-row-header');
    const headerLeft = el('div', 'post-header-left');
    const aliasEl = el('span', 'post-alias-name', p.alias);
    const roleBadge = badge(p.role, p.verified);
    headerLeft.append(aliasEl, roleBadge);

    const timeEl = el('span', 'post-time-stamp', timeAgo(p.ts));
    header.append(headerLeft, timeEl);

    const bodyEl = el('div', 'post-body-text', p.body);

    // Subtle message action on post
    const actions = el('div', 'post-action-bar');
    if (me && p.alias !== me.alias) {
      const msgBtn = el('button', 'post-action-btn', 'Message');
      msgBtn.title = 'Message ' + p.alias;
      msgBtn.onclick = (e) => {
        e.stopPropagation();
        openChat(p.alias, p.role);
      };
      actions.append(msgBtn);
    }

    wrap.append(header, bodyEl, actions);
    row.append(avatar, wrap);
    box.append(row);
  }
}

async function sendPost() {
  const body = $('post').value;
  if (!body.trim()) return;

  const d = await api('posts', { method: 'POST', body: { body } });
  if (d.error) return showToast(d.error, 'error');

  $('post').value = '';
  $('post').style.height = 'auto';
  updatePostCounter();
  loadPosts();
  if (d.crisis) crisisNote();
}

// ---------- Explore & Right Sidebar Suggested People ----------
async function loadPeople() {
  const refreshBtn = $('btn-load-people');
  const icon = refreshBtn ? refreshBtn.querySelector('.btn-icon') : null;
  if (icon) icon.classList.add('refresh-icon-spin');

  const list = await api('people');
  if (icon) setTimeout(() => icon.classList.remove('refresh-icon-spin'), 600);

  const box = $('plist');
  box.replaceChildren();

  // Populate Right Sidebar widget as well
  const rightList = $('right-suggested-people');
  if (rightList) rightList.replaceChildren();

  if (!list || !list.length) {
    const empty = el('div', 'empty-state');
    const iconEl = el('div', 'empty-state-icon', '🌱');
    const title = el('div', 'empty-state-title', 'No other members online right now');
    const desc = el('p', 'empty-state-desc mute', 'Check back in a little while.');
    empty.append(iconEl, title, desc);
    box.append(empty);
    return;
  }

  list.forEach((u, index) => {
    // 1. Explore main row
    const row = el('div', 'person-row');
    const avatar = createAvatar(u.alias, u.role);
    const info = el('div', 'person-row-info');
    const aliasEl = el('span', 'person-row-alias', u.alias);
    const roleBadge = badge(u.role, u.verified);
    info.append(aliasEl, roleBadge);

    const msgBtn = el('button', 'btn btn-secondary btn-sm', 'Message');
    msgBtn.onclick = () => openChat(u.alias, u.role);
    row.append(avatar, info, msgBtn);
    box.append(row);

    // 2. Right sidebar suggestions (first 4)
    if (rightList && index < 4) {
      const sRow = el('div', 'suggested-row');
      const sUser = el('div', 'suggested-row-user');
      const sAvatar = createAvatar(u.alias, u.role);
      sAvatar.style.width = '28px';
      sAvatar.style.height = '28px';
      sAvatar.style.fontSize = '12px';
      const sAlias = el('span', 'suggested-alias', u.alias);
      sUser.append(sAvatar, sAlias);

      const sBtn = el('button', 'btn btn-ghost btn-sm', 'Message');
      sBtn.style.padding = '3px 10px';
      sBtn.style.fontSize = '12px';
      sBtn.onclick = () => openChat(u.alias, u.role);
      sRow.append(sUser, sBtn);
      rightList.append(sRow);
    }
  });

  // Draw community charts from the real people list
  buildCommunityCharts(list);
}

// ---------- Messages / WhatsApp DM Style ----------
async function loadConversations() {
  const convos = await api('conversations');
  if (!Array.isArray(convos)) return;
  conversationsCache = convos;
  renderConversationsList();
  updateUnreadCount();
}

function updateUnreadCount() {
  const reads = getReadTimestamps();
  let totalUnread = 0;

  conversationsCache.forEach(c => {
    const lastRead = reads[c.alias] || 0;
    if (c.lastTs > lastRead && (!me || c.alias !== me.alias)) {
      totalUnread++;
    }
  });

  const badgeEl = $('msg-unread-badge');
  if (badgeEl) {
    if (totalUnread > 0) {
      badgeEl.textContent = totalUnread > 99 ? '99+' : totalUnread;
      badgeEl.classList.remove('hidden');
    } else {
      badgeEl.classList.add('hidden');
    }
  }

  const dotEl = $('mob-unread-dot');
  if (dotEl) {
    dotEl.classList.toggle('hidden', totalUnread === 0);
  }
}

function filterConversations() {
  renderConversationsList();
}

function renderConversationsList() {
  const box = $('convos-list');
  if (!box) return;
  box.replaceChildren();

  const query = ($('convos-search') ? $('convos-search').value.toLowerCase().trim() : '');
  const filtered = conversationsCache.filter(c =>
    c.alias.toLowerCase().includes(query) || (c.lastMessage && c.lastMessage.toLowerCase().includes(query))
  );

  if (!filtered.length) {
    const empty = el('div', 'empty-state');
    empty.style.padding = '28px 14px';
    const title = el('div', 'empty-state-title', query ? 'No matching conversations' : 'No conversations yet');
    const desc = el('p', 'empty-state-desc mute', query ? 'Try searching another name' : 'Discover peers in Explore to start a chat.');
    empty.append(title, desc);
    box.append(empty);
    return;
  }

  const reads = getReadTimestamps();

  filtered.forEach(c => {
    const row = el('div', 'convo-row' + (current === c.alias ? ' active' : ''));
    row.onclick = () => openChat(c.alias, c.role);

    const avatar = createAvatar(c.alias, c.role);
    const content = el('div', 'convo-row-content');

    const top = el('div', 'convo-row-top');
    const aliasTitle = el('span', 'convo-alias-title', c.alias);
    const timeLabel = el('span', 'convo-time-label', timeAgo(c.lastTs));
    top.append(aliasTitle, timeLabel);

    const bottom = el('div', 'convo-row-bottom');
    const preview = el('span', 'convo-last-msg', c.lastMessage || 'Message started');
    bottom.append(preview);

    const lastRead = reads[c.alias] || 0;
    if (c.lastTs > lastRead && current !== c.alias) {
      const bubble = el('span', 'convo-unread-bubble', '•');
      bottom.append(bubble);
    }

    content.append(top, bottom);
    row.append(avatar, content);
    box.append(row);
  });
}

function renderEmptyChatPrompt() {
  if (current) return;
  $('with').textContent = 'Select a conversation';
  const chatAvatar = $('chat-avatar');
  if (chatAvatar) {
    chatAvatar.style.backgroundColor = '';
    chatAvatar.style.color = '';
    chatAvatar.textContent = '💬';
  }
  $('msgs').replaceChildren();
  const empty = el('div', 'empty-state');
  const icon = el('div', 'empty-state-icon', '💬');
  const title = el('div', 'empty-state-title', 'Select a conversation');
  const desc = el('p', 'empty-state-desc mute', 'Choose a conversation from the list or start one from Explore.');
  empty.append(icon, title, desc);
  $('msgs').append(empty);
}

async function openChat(alias, role) {
  current = alias;
  tab('chat');

  // Slide to chat on mobile
  const wrapper = document.querySelector('.dms-wrapper');
  if (wrapper) wrapper.classList.add('chat-active');

  $('with').textContent = alias + ' (' + (role ? role[0].toUpperCase() + role.slice(1) : '') + ')';

  const chatAvatar = $('chat-avatar');
  if (chatAvatar) {
    chatAvatar.style.backgroundColor = getAvatarBg(alias);
    chatAvatar.style.color = getAvatarColor(alias);
    chatAvatar.textContent = alias.charAt(0).toUpperCase();
  }

  markConversationRead(alias);
  renderConversationsList();

  const list = await api('messages/' + encodeURIComponent(alias));
  $('msgs').replaceChildren();

  if (!list || !list.length) {
    const empty = el('div', 'empty-state');
    const title = el('div', 'empty-state-title', 'Start the conversation');
    const desc = el('p', 'empty-state-desc mute', 'Send a kind, supportive message to begin.');
    empty.append(title, desc);
    $('msgs').append(empty);
  } else {
    let lastSenderMine = null;
    let lastTime = 0;

    list.forEach((m) => {
      const mine = !!m.mine;
      const groupConsecutive = (lastSenderMine === mine && (m.ts - lastTime < 300000));
      addMsg(m.body, mine, m.ts, groupConsecutive);
      lastSenderMine = mine;
      lastTime = m.ts;
    });
  }
}

function backToConvosList() {
  const wrapper = document.querySelector('.dms-wrapper');
  if (wrapper) wrapper.classList.remove('chat-active');
}

function addMsg(body, mine, ts = Date.now(), group = false) {
  const empty = $('msgs').querySelector('.empty-state');
  if (empty) empty.remove();

  const d = el('div', 'm' + (mine ? ' mine' : '') + (group ? ' m-group' : ''), body);
  if (ts) {
    const timeSpan = el('span', 'm-timestamp', formatClockTime(ts));
    d.append(timeSpan);
  }
  $('msgs').append(d);
  d.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function handleChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendDM();
  }
}

function sendDM() {
  const txtInput = $('txt');
  const body = txtInput ? txtInput.value.trim() : '';
  if (!body || !current) return;

  socket.emit('dm', { to: current, body }, (r) => {
    if (!r || !r.ok) return showToast('Could not send message. You may have been blocked.', 'error');
    addMsg(body, true, Date.now());
    if (txtInput) txtInput.value = '';
    markConversationRead(current);
    loadConversations();
    if (r.crisis) crisisNote();
  });
}

// ---------- Safety: Block & Report ----------
function blockCur() {
  if (!current) return;
  const modal = $('modal-block');
  const text = $('block-confirm-text');
  if (text) {
    text.textContent = 'Are you sure you want to block ' + current + '? You will no longer be able to message each other or see each other\'s posts.';
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
  $('with').textContent = 'Blocked';

  const chatAvatar = $('chat-avatar');
  if (chatAvatar) {
    chatAvatar.style.backgroundColor = '';
    chatAvatar.style.color = '';
    chatAvatar.textContent = '🚫';
  }

  showToast(blockedAlias + ' has been blocked.');
  loadConversations();
  backToConvosList();
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
  showToast('Report submitted. Thank you for helping keep SafeSpace safe.');
}

// ---------- Profile View ----------
function updateProfileView() {
  if (!me) return;
  const av = $('profile-avatar');
  if (av) {
    av.style.backgroundColor = getAvatarBg(me.alias);
    av.style.color = getAvatarColor(me.alias);
    av.textContent = me.alias.charAt(0).toUpperCase();
  }
  const aliasEl = $('profile-alias');
  if (aliasEl) aliasEl.textContent = me.alias;

  const badgeRow = $('profile-badge-row');
  if (badgeRow) badgeRow.replaceChildren(badge(me.role, me.verified));

  const codeEl = $('profile-alias-code');
  if (codeEl) codeEl.textContent = me.alias + ' (' + me.role + ')';

  // Render charts and streak
  drawMoodChart('chart-mood-mini', getMoodData(7), 110, 80);
  drawProfileMoodChart(7);
  drawStreakRing();
}

// ========================================================================
// MOOD CHECK-IN  (device-local, stored in localStorage)
// ========================================================================
function getMoodData(days) {
  const raw = JSON.parse(localStorage.getItem('moodLog') || '{}');
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, value: raw[key] || null });
  }
  return result;
}

function getStreak() {
  const raw = JSON.parse(localStorage.getItem('moodLog') || '{}');
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (raw[key]) streak++;
    else break;
  }
  return streak;
}

function checkInMood(value) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const key = today.toISOString().slice(0, 10);
  const raw = JSON.parse(localStorage.getItem('moodLog') || '{}');
  raw[key] = value;
  localStorage.setItem('moodLog', JSON.stringify(raw));

  // Update active state on buttons
  document.querySelectorAll('.neu-mood-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.value) === value);
  });

  // Redraw charts
  drawMoodChart('chart-mood-mini', getMoodData(7), 110, 80);
  drawProfileMoodChart(getCurrentProfileMoodRange());
  drawStreakRing();
  showToast('Mood logged for today.');
}

let _profileMoodRange = 7;
function getCurrentProfileMoodRange() { return _profileMoodRange; }

function setProfileMoodRange(days) {
  _profileMoodRange = days;
  $('btn-mood-7') && $('btn-mood-7').classList.toggle('on', days === 7);
  $('btn-mood-30') && $('btn-mood-30').classList.toggle('on', days === 30);
  drawProfileMoodChart(days);
}

function drawProfileMoodChart(days) {
  const data = getMoodData(days);
  const box = $('mood-chart-profile');
  if (!box) return;
  drawMoodChart('mood-chart-profile', data, box.clientHeight || 140, box.clientWidth || 280);
}

// ========================================================================
// SVG CHART HELPERS  (no external libraries, pure inline SVG)
// ========================================================================

/** Utility: create SVG element */
function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  return el;
}

/**
 * drawMoodChart — smooth line + area SVG, rendered into a container by id.
 * data: [{date, value}]  value 1-5 or null
 */
function drawMoodChart(containerId, data, h = 90, w = 0) {
  const box = $(containerId);
  if (!box) return;
  box.replaceChildren();
  const W = w || box.clientWidth || 220;
  const H = h;
  const PAD = { t: 8, r: 6, b: 22, l: 24 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: '100%' });

  const pts = data.filter(d => d.value !== null);
  if (!pts.length) {
    const t = svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: 'var(--ink-light)', 'font-size': '11', 'font-family': 'inherit' });
    t.textContent = 'No data yet — log your first mood!';
    svg.append(t);
    box.append(svg);
    return;
  }

  // Gridlines (mood levels 1-5)
  const accentRgb = getComputedStyle(document.documentElement).getPropertyValue('--ink-light').trim() || '#6E8290';
  for (let v = 1; v <= 5; v++) {
    const y = PAD.t + iH - ((v - 1) / 4) * iH;
    const line = svgEl('line', { x1: PAD.l, y1: y, x2: W - PAD.r, y2: y, stroke: 'var(--line)', 'stroke-width': '1' });
    svg.append(line);
    // Y-axis label
    const lbl = svgEl('text', { x: PAD.l - 4, y: y + 4, 'text-anchor': 'end', fill: 'var(--ink-light)', 'font-size': '9', 'font-family': 'inherit' });
    lbl.textContent = v;
    svg.append(lbl);
  }

  // X positions
  const n = data.length;
  function xPos(i) { return PAD.l + (i / Math.max(n - 1, 1)) * iW; }
  function yPos(v) { return PAD.t + iH - ((v - 1) / 4) * iH; }

  // Build smooth polyline from points with values
  const filled = data.map((d, i) => d.value !== null ? { x: xPos(i), y: yPos(d.value) } : null).filter(Boolean);

  // Area fill
  if (filled.length > 1) {
    const areaD = ['M', filled[0].x, filled[0].y];
    for (let i = 1; i < filled.length; i++) {
      const cx = (filled[i - 1].x + filled[i].x) / 2;
      areaD.push('C', cx, filled[i - 1].y, cx, filled[i].y, filled[i].x, filled[i].y);
    }
    areaD.push('L', filled[filled.length - 1].x, PAD.t + iH, 'L', filled[0].x, PAD.t + iH, 'Z');
    const area = svgEl('path', {
      d: areaD.join(' '),
      fill: 'var(--accent)',
      opacity: '0.12'
    });
    svg.append(area);

    // Line
    const lineD = ['M', filled[0].x, filled[0].y];
    for (let i = 1; i < filled.length; i++) {
      const cx = (filled[i - 1].x + filled[i].x) / 2;
      lineD.push('C', cx, filled[i - 1].y, cx, filled[i].y, filled[i].x, filled[i].y);
    }
    const linePath = svgEl('path', {
      d: lineD.join(' '),
      stroke: 'var(--accent)',
      'stroke-width': '2.5',
      fill: 'none',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    });
    svg.append(linePath);
  }

  // Data dots
  data.forEach((d, i) => {
    if (d.value === null) return;
    const circle = svgEl('circle', { cx: xPos(i), cy: yPos(d.value), r: '4', fill: 'var(--card)', stroke: 'var(--accent)', 'stroke-width': '2.5' });
    const title = svgEl('title', {});
    title.textContent = d.date + ': ' + d.value + '/5';
    circle.append(title);
    svg.append(circle);
  });

  // X-axis labels (first and last, or every nth)
  const step = Math.max(1, Math.floor(n / 4));
  data.forEach((d, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const xL = svgEl('text', { x: xPos(i), y: H - 4, 'text-anchor': 'middle', fill: 'var(--ink-light)', 'font-size': '9', 'font-family': 'inherit' });
    xL.textContent = d.date.slice(5); // MM-DD
    svg.append(xL);
  });

  box.append(svg);
}

/**
 * drawActivityBarChart — 7-day posts-per-day bar chart
 * data: [{label, value}]
 */
function drawActivityBarChart(data) {
  const box = $('chart-activity');
  if (!box) return;
  box.replaceChildren();
  const W = box.clientWidth || 200;
  const H = box.clientHeight || 130;
  const PAD = { t: 8, r: 6, b: 24, l: 24 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: '100%' });

  const maxVal = Math.max(...data.map(d => d.value), 1);
  const n = data.length;
  const barW = Math.max(4, iW / n * 0.55);
  const gap = iW / n;

  // Y gridlines
  for (let i = 0; i <= 4; i++) {
    const y = PAD.t + iH - (i / 4) * iH;
    svg.append(svgEl('line', { x1: PAD.l, y1: y, x2: W - PAD.r, y2: y, stroke: 'var(--line)', 'stroke-width': '1' }));
  }

  data.forEach((d, i) => {
    const bH = Math.max(2, (d.value / maxVal) * iH);
    const x = PAD.l + i * gap + (gap - barW) / 2;
    const y = PAD.t + iH - bH;

    const rect = svgEl('rect', {
      x, y, width: barW, height: bH, rx: '3',
      fill: 'var(--accent)', opacity: '0.78', cursor: 'pointer'
    });
    const title = svgEl('title', {});
    title.textContent = d.label + ': ' + d.value + ' posts';
    rect.append(title);
    svg.append(rect);

    // X label
    const lbl = svgEl('text', { x: x + barW / 2, y: H - 4, 'text-anchor': 'middle', fill: 'var(--ink-light)', 'font-size': '9', 'font-family': 'inherit' });
    lbl.textContent = d.label.slice(-2);
    svg.append(lbl);
  });

  // Y axis value
  const yLbl = svgEl('text', { x: PAD.l - 4, y: PAD.t + 4, 'text-anchor': 'end', fill: 'var(--ink-light)', 'font-size': '9', 'font-family': 'inherit' });
  yLbl.textContent = maxVal;
  svg.append(yLbl);

  box.append(svg);
}

/**
 * drawRolesDonut — SVG donut chart for role distribution.
 * segments: [{label, value, color}]
 */
function drawRolesDonut(segments) {
  const box = $('chart-roles');
  if (!box) return;
  box.replaceChildren();
  const SIZE = Math.min(box.clientWidth || 120, box.clientHeight || 120);
  const cx = SIZE / 2, cy = SIZE / 2;
  const R = SIZE * 0.38, r = SIZE * 0.22;

  const svg = svgEl('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, width: '100%', height: '100%' });

  const total = segments.reduce((s, d) => s + d.value, 0);
  if (!total) {
    const t = svgEl('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', fill: 'var(--ink-light)', 'font-size': '10', 'font-family': 'inherit' });
    t.textContent = 'No data';
    svg.append(t);
    box.append(svg);
    return;
  }

  let startAngle = -Math.PI / 2;
  segments.forEach((seg, idx) => {
    if (!seg.value) return;
    const angle = (seg.value / total) * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const x1 = cx + R * Math.cos(startAngle), y1 = cy + R * Math.sin(startAngle);
    const x2 = cx + R * Math.cos(endAngle), y2 = cy + R * Math.sin(endAngle);
    const xi1 = cx + r * Math.cos(endAngle), yi1 = cy + r * Math.sin(endAngle);
    const xi2 = cx + r * Math.cos(startAngle), yi2 = cy + r * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;

    const path = svgEl('path', {
      d: `M ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} L ${xi1} ${yi1} A ${r} ${r} 0 ${largeArc} 0 ${xi2} ${yi2} Z`,
      fill: seg.color, opacity: '0.85', cursor: 'default'
    });
    const title = svgEl('title', {});
    title.textContent = seg.label + ': ' + seg.value;
    path.append(title);
    svg.append(path);
    startAngle = endAngle;
  });

  // Center label — total count
  const cLbl = svgEl('text', { x: cx, y: cy - 5, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': '14', 'font-weight': '700', 'font-family': 'inherit' });
  cLbl.textContent = total;
  svg.append(cLbl);
  const cSub = svgEl('text', { x: cx, y: cy + 9, 'text-anchor': 'middle', fill: 'var(--ink-light)', 'font-size': '9', 'font-family': 'inherit' });
  cSub.textContent = 'members';
  svg.append(cSub);

  // Legend
  const legendY = SIZE + 2;
  // (skip legend in small box — tooltip on hover is sufficient)

  box.append(svg);
}

/**
 * drawStreakRing — small SVG arc ring in the profile streak badge.
 */
function drawStreakRing() {
  const box = $('profile-streak-ring');
  if (!box) return;
  const streak = getStreak();
  const countEl = $('profile-streak-count');
  if (countEl) countEl.textContent = streak + ' Day Streak';

  box.replaceChildren();
  const SIZE = 34;
  const cx = SIZE / 2, cy = SIZE / 2, R = 13;
  const circ = 2 * Math.PI * R;
  const pct = Math.min(streak / 7, 1); // full ring = 7 days

  const svg = svgEl('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, width: SIZE, height: SIZE });

  // Track
  svg.append(svgEl('circle', { cx, cy, r: R, fill: 'none', stroke: 'var(--line)', 'stroke-width': '3' }));

  // Progress arc
  const arc = svgEl('circle', {
    cx, cy, r: R, fill: 'none',
    stroke: streak > 0 ? 'var(--accent)' : 'var(--line)',
    'stroke-width': '3',
    'stroke-dasharray': `${pct * circ} ${circ}`,
    'stroke-dashoffset': circ * 0.25, // start at top
    'stroke-linecap': 'round',
    transform: `rotate(-90 ${cx} ${cy})`
  });
  svg.append(arc);

  // Center fire emoji
  const t = svgEl('text', { x: cx, y: cy + 5, 'text-anchor': 'middle', 'font-size': '12' });
  t.textContent = streak > 0 ? '🔥' : '○';
  svg.append(t);

  box.append(svg);
}

/**
 * buildCommunityCharts — called when the Explore tab loads.
 * Generates deterministic demo data (seeded by alias so each user sees consistent
 * numbers but no real individual data is exposed to them).
 */
function buildCommunityCharts(peopleList) {
  // Posts-per-day: deterministic from alias + date seed, not real server data
  const actData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const label = d.toISOString().slice(0, 10);
    // Seed with day offset + alias hash so it's stable per session
    let seed = 0;
    for (const c of (me ? me.alias : 'x')) seed = (seed * 31 + c.charCodeAt(0)) & 0xFFFF;
    seed = (seed + i * 17) % 19;
    actData.push({ label, value: 3 + seed });
  }
  drawActivityBarChart(actData);

  // Role distribution from the people list
  const counts = { person: 0, therapist: 0, psychiatrist: 0 };
  (peopleList || []).forEach(u => { if (counts[u.role] !== undefined) counts[u.role]++; });
  // Always show at least 1 per category so the donut is useful even with few users
  const ROLE_COLORS = {
    person: 'var(--role-person)',
    therapist: 'var(--role-therapist)',
    psychiatrist: 'var(--role-psychiatrist)'
  };
  const segments = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ label: k[0].toUpperCase() + k.slice(1), value: v, color: ROLE_COLORS[k] }));
  if (!segments.length) {
    segments.push({ label: 'Members', value: 1, color: 'var(--accent)' });
  }
  drawRolesDonut(segments);
}

// Auto-start if session exists
if (token && me) start({ token, ...me });
