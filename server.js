require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const { PORT = 3000, JWT_SECRET, ADMIN_KEY, DB_PATH = './app.db' } = process.env;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('JWT_SECRET missing ya chhota hai. backend/.env mein 32+ characters ka secret daalo.');
  process.exit(1);
}

const ROLES = { person: 'Person', therapist: 'Therapist', psychiatrist: 'Psychiatrist' };
// Crisis words (English + Hinglish). Match hone par user ko helpline dikhayi jati hai.
const CRISIS = /suicide|kill myself|end my life|want to die|self[- ]?harm|marna chah|jeena nahi|khud ko khatam|aatmahatya|mar jaana chah/i;

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const db = new Database(DB_PATH);

// Koi naam, email, phone, college store nahi hota. Sirf alias + role + secret code ka hash.
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, alias TEXT UNIQUE, role TEXT, code_hash TEXT UNIQUE, verified INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, user_id INT, body TEXT, ts INT);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, from_id INT, to_id INT, body TEXT, ts INT);
CREATE TABLE IF NOT EXISTS blocks(blocker INT, blocked INT, PRIMARY KEY(blocker, blocked));
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, reporter INT, reported INT, reason TEXT, ts INT);
`);
try { db.exec('ALTER TABLE users ADD COLUMN verified INTEGER DEFAULT 0'); } catch { /* column pehle se hai */ }

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Too many attempts. Please try again later.' } });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clean = (s) => String(s || '').trim().slice(0, 1000);
const sign = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });
const byAlias = (a) => db.prepare('SELECT * FROM users WHERE alias=?').get(a);
const isBlocked = (a, b) =>
  !!db.prepare('SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)').get(a, b, b, a);

function auth(req, res, next) {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    req.user = db.prepare('SELECT * FROM users WHERE id=?').get(jwt.verify(t, JWT_SECRET).id);
    if (!req.user) throw new Error('no user');
    next();
  } catch {
    res.status(401).json({ error: 'Please log in again.' });
  }
}

function admin(req, res, next) {
  if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// ---------- Auth ----------
app.post('/api/register', authLimiter, (req, res) => {
  const role = req.body.role;
  if (!ROLES[role]) return res.status(400).json({ error: 'Invalid role.' });
  let alias;
  do { alias = `${ROLES[role]}-${crypto.randomInt(1000, 100000)}`; } while (byAlias(alias));
  const code = crypto.randomBytes(16).toString('hex');
  const r = db.prepare('INSERT INTO users(alias, role, code_hash) VALUES(?,?,?)').run(alias, role, sha(code));
  res.json({ alias, role, verified: 0, code, token: sign(r.lastInsertRowid) });
});

app.post('/api/login', authLimiter, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE code_hash=?').get(sha(clean(req.body.code)));
  if (!u) return res.status(401).json({ error: 'Wrong secret code.' });
  res.json({ alias: u.alias, role: u.role, verified: u.verified, token: sign(u.id) });
});

// ---------- People, posts, chat ----------
app.get('/api/people', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT alias, role, verified FROM users
    WHERE id != ?
      AND id NOT IN (SELECT blocked FROM blocks WHERE blocker = ?)
      AND id NOT IN (SELECT blocker FROM blocks WHERE blocked = ?)
    ORDER BY RANDOM() LIMIT 12`).all(req.user.id, req.user.id, req.user.id));
});

app.get('/api/posts', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT u.alias, u.role, u.verified, p.body, p.ts FROM posts p JOIN users u ON u.id = p.user_id
    WHERE u.id NOT IN (SELECT blocked FROM blocks WHERE blocker = ?)
    ORDER BY p.id DESC LIMIT 50`).all(req.user.id));
});

app.post('/api/posts', auth, (req, res) => {
  const body = clean(req.body.body);
  if (!body) return res.status(400).json({ error: 'Write something first.' });
  db.prepare('INSERT INTO posts(user_id, body, ts) VALUES(?,?,?)').run(req.user.id, body, Date.now());
  res.json({ ok: true, crisis: CRISIS.test(body) });
});

app.get('/api/conversations', auth, (req, res) => {
  const convos = db.prepare(`
    SELECT 
      u.alias,
      u.role,
      u.verified,
      m.body AS lastMessage,
      m.ts AS lastTs
    FROM (
      SELECT 
        CASE WHEN from_id = ? THEN to_id ELSE from_id END AS partner_id,
        MAX(id) AS max_msg_id
      FROM messages
      WHERE from_id = ? OR to_id = ?
      GROUP BY partner_id
    ) latest
    JOIN messages m ON m.id = latest.max_msg_id
    JOIN users u ON u.id = latest.partner_id
    WHERE u.id NOT IN (SELECT blocked FROM blocks WHERE blocker = ?)
      AND u.id NOT IN (SELECT blocker FROM blocks WHERE blocked = ?)
    ORDER BY m.ts DESC
  `).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
  res.json(convos);
});

app.get('/api/messages/:alias', auth, (req, res) => {
  const o = byAlias(req.params.alias);
  if (!o) return res.json([]);
  res.json(db.prepare(`
    SELECT (from_id = ?) AS mine, body, ts FROM messages
    WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY id`)
    .all(req.user.id, req.user.id, o.id, o.id, req.user.id));
});

// ---------- Safety ----------
app.post('/api/block', auth, (req, res) => {
  const o = byAlias(req.body.alias);
  if (o) db.prepare('INSERT OR IGNORE INTO blocks VALUES(?,?)').run(req.user.id, o.id);
  res.json({ ok: true });
});

app.post('/api/report', auth, (req, res) => {
  const o = byAlias(req.body.alias);
  if (!o) return res.status(404).json({ error: 'User not found.' });
  db.prepare('INSERT INTO reports(reporter, reported, reason, ts) VALUES(?,?,?,?)')
    .run(req.user.id, o.id, clean(req.body.reason) || 'No reason given', Date.now());
  res.json({ ok: true });
});

// ---------- Admin (header: x-admin-key) ----------
app.get('/api/admin/reports', admin, (req, res) => {
  res.json(db.prepare(`
    SELECT r.id, u.alias AS reported, r.reason, r.ts FROM reports r JOIN users u ON u.id = r.reported
    ORDER BY r.id DESC LIMIT 100`).all());
});

// License check karne ke baad hi verify karein
app.post('/api/admin/verify', admin, (req, res) => {
  const r = db.prepare("UPDATE users SET verified=1 WHERE alias=? AND role IN ('therapist','psychiatrist')").run(req.body.alias);
  res.json({ ok: r.changes === 1 });
});

app.post('/api/admin/ban', admin, (req, res) => {
  const o = byAlias(req.body.alias);
  if (!o) return res.status(404).json({ error: 'User not found.' });
  db.prepare('DELETE FROM users WHERE id=?').run(o.id);
  db.prepare('DELETE FROM posts WHERE user_id=?').run(o.id);
  db.prepare('DELETE FROM messages WHERE from_id=? OR to_id=?').run(o.id, o.id);
  res.json({ ok: true });
});

// ---------- Real-time chat ----------
io.use((s, next) => {
  try { s.userId = jwt.verify(s.handshake.auth.token, JWT_SECRET).id; next(); }
  catch { next(new Error('auth')); }
});

io.on('connection', (s) => {
  s.join('u' + s.userId);
  s.on('dm', ({ to, body } = {}, ack) => {
    const me = db.prepare('SELECT * FROM users WHERE id=?').get(s.userId);
    const o = byAlias(to);
    body = clean(body);
    if (!me || !o || !body || isBlocked(me.id, o.id)) return ack && ack({ ok: false });
    db.prepare('INSERT INTO messages(from_id, to_id, body, ts) VALUES(?,?,?,?)').run(me.id, o.id, body, Date.now());
    io.to('u' + o.id).emit('dm', { from: me.alias, role: me.role, verified: me.verified, body });
    if (ack) ack({ ok: true, crisis: CRISIS.test(body) });
  });
});

server.listen(PORT, () => console.log(`SafeSpace running on http://localhost:${PORT}`));
