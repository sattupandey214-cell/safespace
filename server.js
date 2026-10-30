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
const { promisify } = require('util');

const { PORT = 3000, JWT_SECRET, ADMIN_KEY, DB_PATH = './app.db' } = process.env;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('JWT_SECRET missing ya chhota hai. backend/.env mein 32+ characters ka secret daalo.');
  process.exit(1);
}

const ROLES = { person: 'Person', therapist: 'Therapist', psychiatrist: 'Psychiatrist', gynecologist: 'Gynecologist', psychologist: 'Psychologist' };
const PROFESSIONAL_ROLES = new Set(['therapist', 'psychiatrist', 'gynecologist', 'psychologist']);
const CODE_WORDS = [
  ['Amber', 'Brisk', 'Calm', 'Clever', 'Cozy', 'Daring', 'Dawn', 'Gentle', 'Golden', 'Happy', 'Jolly', 'Kind', 'Lucky', 'Mellow', 'Misty', 'Noble', 'Quiet', 'Rapid', 'Ready', 'Royal', 'Shiny', 'Silver', 'Soft', 'Sunny', 'Swift', 'Tender', 'Vivid', 'Warm', 'Witty', 'Bold', 'Fresh', 'Bright'],
  ['Brook', 'Cedar', 'Cloud', 'Comet', 'Coral', 'Daisy', 'Delta', 'Ember', 'Forest', 'Harbor', 'Haven', 'Jasmine', 'Lagoon', 'Maple', 'Meadow', 'Moon', 'Ocean', 'Olive', 'Pebble', 'Pine', 'River', 'Robin', 'Sage', 'Sky', 'Stone', 'Summit', 'Willow', 'Breeze', 'Clover', 'Dune', 'Fern', 'Grove']
];
// Crisis words (English + Hinglish). Match hone par user ko helpline dikhayi jati hai.
const CRISIS = /suicide|kill myself|end my life|want to die|self[- ]?harm|marna chah|jeena nahi|khud ko khatam|aatmahatya|mar jaana chah/i;

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const db = new Database(DB_PATH);

// Professional profile contact details are public only with explicit registration consent.
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, alias TEXT UNIQUE, role TEXT, code_hash TEXT UNIQUE, verified INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, user_id INT, body TEXT, ts INT, reply_to INT REFERENCES posts(id));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, from_id INT, to_id INT, body TEXT, ts INT);
CREATE TABLE IF NOT EXISTS blocks(blocker INT, blocked INT, PRIMARY KEY(blocker, blocked));
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, reporter INT, reported INT, reason TEXT, ts INT);
CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY, reviewer_id INT NOT NULL, target_id INT NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), remark TEXT NOT NULL DEFAULT '', ts INT NOT NULL, UNIQUE(reviewer_id, target_id));
`);
try { db.exec('ALTER TABLE users ADD COLUMN verified INTEGER DEFAULT 0'); } catch { /* already exists */ }
for (const column of ['full_name TEXT', 'email TEXT', 'phone TEXT', 'qualification TEXT', 'institution TEXT', 'password_hash TEXT', 'password_salt TEXT']) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${column}`); } catch { /* already exists */ }
}
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL AND email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL AND phone <> '';
`);
try { db.exec('ALTER TABLE posts ADD COLUMN reply_to INTEGER REFERENCES posts(id)'); } catch { /* already exists */ }

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Too many attempts. Please try again later.' } });
const scrypt = promisify(crypto.scrypt);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const codeHash = (s) => crypto.createHmac('sha256', JWT_SECRET).update(s).digest('hex');
const clean = (s) => String(s || '').trim().slice(0, 1000);
const normalizeCode = (value) => typeof value === 'string' ? value.trim() : '';
const normalizePhone = (value) => String(value || '').trim().replace(/[\s().-]/g, '');
const hashPassword = async (password, salt) => (await scrypt(password, salt, 64)).toString('hex');
const peerLevel = (count, average) => {
  if (count >= 10 && average >= 4.5) return { rank: 3, label: 'Level 3 · Highly rated' };
  if (count >= 5 && average >= 4) return { rank: 2, label: 'Level 2 · Well regarded' };
  if (count > 0) return { rank: 1, label: 'Level 1 · Getting started' };
  return { rank: 0, label: 'New · No reviews' };
};
const generateCode = () => {
  const words = CODE_WORDS.flat();
  return `${words[crypto.randomInt(words.length)]}${crypto.randomInt(10000000, 100000000)}`;
};
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
app.post('/api/register', authLimiter, async (req, res) => {
  const role = req.body.role;
  if (!ROLES[role]) return res.status(400).json({ error: 'Invalid role.' });
  if (PROFESSIONAL_ROLES.has(role)) {
    const fullName = String(req.body.fullName || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = normalizePhone(req.body.phone);
    const qualification = String(req.body.qualification || '').trim();
    const institution = String(req.body.institution || '').trim();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!fullName || fullName.length > 80) return res.status(400).json({ error: 'Enter your name (up to 80 characters).' });
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!/^\+?[1-9]\d{7,14}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid phone number with country code if needed.' });
    if (!qualification || qualification.length > 120) return res.status(400).json({ error: 'Enter your qualification or program of study (up to 120 characters).' });
    if (!institution || institution.length > 160) return res.status(400).json({ error: 'Enter your college or institution (up to 160 characters).' });
    if (password.length < 12 || password.length > 128) return res.status(400).json({ error: 'Password must be 12 to 128 characters.' });
    if (req.body.publicContactConsent !== true) return res.status(400).json({ error: 'Confirm that your name, email, phone, and education details will be public.' });
    if (db.prepare('SELECT 1 FROM users WHERE lower(email)=? OR phone=?').get(email, phone)) {
      return res.status(409).json({ error: 'That email or phone number is already registered.' });
    }
    let alias;
    do { alias = `${ROLES[role]}-${crypto.randomInt(1000, 100000)}`; } while (byAlias(alias));
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(password, passwordSalt);
    try {
      const result = db.prepare(`
        INSERT INTO users(alias, role, full_name, email, phone, qualification, institution, password_hash, password_salt)
        VALUES(?,?,?,?,?,?,?,?,?)
      `).run(alias, role, fullName, email, phone, qualification, institution, passwordHash, passwordSalt);
      return res.status(201).json({ alias, role, verified: 0, token: sign(result.lastInsertRowid) });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That email, phone, or alias is already registered.' });
      throw error;
    }
  }
  const chosenCode = normalizeCode(req.body.code);
  if (chosenCode.length > 15) return res.status(400).json({ error: 'New sign-in codes must be 15 characters or fewer.' });
  const code = chosenCode || generateCode();
  if (db.prepare('SELECT 1 FROM users WHERE code_hash IN (?, ?)').get(codeHash(code), sha(code))) {
    return res.status(409).json({ error: 'That sign-in code is already in use. Please choose another.' });
  }
  let alias;
  do { alias = `${ROLES[role]}-${crypto.randomInt(1000, 100000)}`; } while (byAlias(alias));
  const r = db.prepare('INSERT INTO users(alias, role, code_hash) VALUES(?,?,?)').run(alias, role, codeHash(code));
  res.json({ alias, role, verified: 0, code, token: sign(r.lastInsertRowid) });
});

app.post('/api/professional-login', authLimiter, async (req, res) => {
  const identifier = String(req.body.identifier || '').trim();
  const email = identifier.toLowerCase();
  const phone = normalizePhone(identifier);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = db.prepare(`
    SELECT * FROM users
    WHERE (lower(email)=? OR phone=?) AND password_hash IS NOT NULL AND password_salt IS NOT NULL
  `).get(email, phone);
  if (!user || password.length > 128) return res.status(401).json({ error: 'Invalid email/phone or password.' });
  const supplied = Buffer.from(await hashPassword(password, user.password_salt), 'hex');
  const expected = Buffer.from(user.password_hash, 'hex');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Invalid email/phone or password.' });
  }
  res.json({ alias: user.alias, role: user.role, verified: user.verified, token: sign(user.id) });
});

app.post('/api/login', authLimiter, (req, res) => {
  const code = normalizeCode(req.body.code);
  const u = code.length <= 64
    ? db.prepare('SELECT * FROM users WHERE code_hash=?').get(codeHash(code)) || db.prepare('SELECT * FROM users WHERE code_hash=?').get(sha(code))
    : null;
  if (!u) return res.status(401).json({ error: 'Wrong secret code.' });
  res.json({ alias: u.alias, role: u.role, verified: u.verified, token: sign(u.id) });
});

// ---------- People, posts, chat ----------
app.get('/api/people', auth, (req, res) => {
  const people = db.prepare(`
        SELECT u.id, u.alias, u.role, u.verified,
          CASE WHEN u.role IN ('therapist','psychiatrist','gynecologist','psychologist') THEN u.full_name END AS full_name,
          CASE WHEN u.role IN ('therapist','psychiatrist','gynecologist','psychologist') THEN u.email END AS email,
          CASE WHEN u.role IN ('therapist','psychiatrist','gynecologist','psychologist') THEN u.phone END AS phone,
          CASE WHEN u.role IN ('therapist','psychiatrist','gynecologist','psychologist') THEN u.qualification END AS qualification,
          CASE WHEN u.role IN ('therapist','psychiatrist','gynecologist','psychologist') THEN u.institution END AS institution,
          COUNT(r.id) AS review_count, COALESCE(AVG(r.rating), 0) AS review_average
    FROM users u
    LEFT JOIN reviews r ON r.target_id = u.id
    WHERE u.id != ?
      AND u.id NOT IN (SELECT blocked FROM blocks WHERE blocker = ?)
      AND u.id NOT IN (SELECT blocker FROM blocks WHERE blocked = ?)
    GROUP BY u.id
    ORDER BY RANDOM() LIMIT 12`).all(req.user.id, req.user.id, req.user.id);
  res.json(people.map(({ id, ...person }) => ({
    ...person,
    review_average: Number(person.review_average.toFixed(1)),
    review_level: peerLevel(person.review_count, person.review_average).label
  })));
});

app.get('/api/reviews/:alias', auth, (req, res) => {
  const target = byAlias(req.params.alias);
  if (!target || !PROFESSIONAL_ROLES.has(target.role)) return res.status(404).json({ error: 'Professional member not found.' });
  const summary = db.prepare('SELECT AVG(rating) AS average, COUNT(*) AS count FROM reviews WHERE target_id=?').get(target.id);
  const average = Number(summary.average || 0);
  const canReview = req.user.role === 'person' && !!db.prepare(`
    SELECT 1 FROM messages
    WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) LIMIT 1
  `).get(req.user.id, target.id, target.id, req.user.id);
  const myReview = db.prepare('SELECT rating, remark FROM reviews WHERE reviewer_id=? AND target_id=?').get(req.user.id, target.id) || null;
  const reviews = db.prepare('SELECT rating, remark, ts FROM reviews WHERE target_id=? ORDER BY ts DESC LIMIT 20').all(target.id);
  res.json({
    alias: target.alias,
    role: target.role,
    average: Number(average.toFixed(1)),
    count: summary.count,
    level: peerLevel(summary.count, average),
    canReview,
    myReview,
    reviews
  });
});

app.post('/api/reviews', auth, (req, res) => {
  if (req.user.role !== 'person') return res.status(403).json({ error: 'Only Person accounts can leave peer reviews.' });
  const target = byAlias(req.body.alias);
  if (!target || !PROFESSIONAL_ROLES.has(target.role)) return res.status(404).json({ error: 'Professional member not found.' });
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Choose a rating from 1 to 5.' });
  const hasConversation = db.prepare(`
    SELECT 1 FROM messages
    WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) LIMIT 1
  `).get(req.user.id, target.id, target.id, req.user.id);
  if (!hasConversation) return res.status(403).json({ error: 'Exchange messages with this member before reviewing their peer support.' });
  const remark = String(req.body.remark || '').trim().slice(0, 500);
  db.prepare(`
    INSERT INTO reviews(reviewer_id, target_id, rating, remark, ts) VALUES(?,?,?,?,?)
    ON CONFLICT(reviewer_id, target_id) DO UPDATE SET rating=excluded.rating, remark=excluded.remark, ts=excluded.ts
  `).run(req.user.id, target.id, rating, remark, Date.now());
  res.json({ ok: true });
});

app.get('/api/posts', auth, (req, res) => {
  // Fetch posts with optional parent (reply_to) context
  const rows = db.prepare(`
    SELECT p.id, u.alias, u.role, u.verified, p.body, p.ts, p.reply_to,
           parent_u.alias AS parent_alias, parent_p.body AS parent_body
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN posts parent_p ON parent_p.id = p.reply_to
    LEFT JOIN users parent_u ON parent_u.id = parent_p.user_id
    WHERE u.id NOT IN (SELECT blocked FROM blocks WHERE blocker = ?)
    ORDER BY p.id DESC LIMIT 50`).all(req.user.id);
  res.json(rows);
});

app.post('/api/posts', auth, (req, res) => {
  const body = clean(req.body.body);
  if (!body) return res.status(400).json({ error: 'Write something first.' });
  const replyTo = req.body.replyTo ? parseInt(req.body.replyTo, 10) : null;
  // Validate replyTo post exists (if provided)
  if (replyTo) {
    const parent = db.prepare('SELECT id FROM posts WHERE id=?').get(replyTo);
    if (!parent) return res.status(400).json({ error: 'Post not found.' });
  }
  db.prepare('INSERT INTO posts(user_id, body, ts, reply_to) VALUES(?,?,?,?)').run(req.user.id, body, Date.now(), replyTo || null);
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

app.get('/api/stats', auth, (req, res) => {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const postsPerDay = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * oneDay);
    const dateStr = d.toISOString().split('T')[0];
    const startTs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const endTs = startTs + oneDay;
    const row = db.prepare('SELECT COUNT(*) AS count FROM posts WHERE ts >= ? AND ts < ?').get(startTs, endTs);
    postsPerDay.push({ date: dateStr, count: row ? row.count : 0 });
  }
  const roleRows = db.prepare('SELECT role, COUNT(*) AS count FROM users GROUP BY role').all();
  const roles = { person: 0, therapist: 0, psychiatrist: 0, gynecologist: 0, psychologist: 0 };
  roleRows.forEach(r => {
    if (roles[r.role] !== undefined) roles[r.role] = r.count;
  });
  res.json({ postsPerDay, roles });
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
  const r = db.prepare("UPDATE users SET verified=1 WHERE alias=? AND role IN ('therapist','psychiatrist','gynecologist','psychologist')").run(req.body.alias);
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
