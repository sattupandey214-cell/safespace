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
}

// Auto-start if session exists
if (token && me) start({ token, ...me });
