# SafeSpace

A peer-support website. Person accounts stay anonymous. Professional accounts consent to show their name, email, phone, qualification, and institution on a public profile; only a secure hash of the password is stored. Contact ownership is not verified by this site, and professional qualifications are self-reported until an admin separately verifies them.

> SafeSpace is peer support, not a replacement for therapy or medical treatment.

## Features

| Feature | Detail |
|---|---|
| Person signup | You only choose a role. You get a random alias (like `Person-48213`) |
| Person login | Choose your own sign-in code or generate a readable word-and-number code; only a hash is stored in the DB |
| Professional signup/login | Name, phone, email, qualification, institution, and password; profile details are public after explicit consent, and passwords are stored as scrypt hashes |
| Posts feed | Posts with a role badge, with replies |
| Random log | Anyone can message anyone 1-to-1 (Socket.IO, real-time) |
| Conversations | List of your chats with the latest message |
| Peer-support reviews | People can anonymously rate and leave remarks for professionals after messaging them; levels are based on received ratings |
| Verified badge | The admin checks licenses and verifies professional roles |
| Block / Report | Available from every chat; reports are shown to the admin |
| Crisis detection | A helpline is shown on words like "I want to die" or "suicide" |
| Community stats | Posts per day and member counts by role |
| Safety basics | Rate limit, Helmet headers, XSS-safe rendering, 1000-character limit |

## Folder structure

```
safespace/
├── server.js          # Backend: Express + Socket.IO + SQLite (API, auth, chat, admin)
├── index.html         # Frontend: page layout and screens
├── app.js             # Frontend: logic (login, feed, chat, reviews, crisis alerts)
├── style.css          # Frontend: styling
├── package.json       # Dependencies and npm scripts
├── package-lock.json  # Locked dependency versions
├── .env.example       # Template for environment variables (committed)
├── .env               # Your real secrets (NOT committed, create it yourself)
├── app.db             # SQLite database (created automatically on first run, NOT committed)
├── .gitignore
└── README.md
```

`server.js` also serves `index.html`, `style.css` and `app.js`, so you only need to run one server.

## Setup (step by step)

1. Install **Node.js 18+** (check with `node -v`).
2. In the project folder, install dependencies and create your `.env` file:
   ```bash
   npm install
   cp .env.example .env
   ```
3. Generate two random secrets and paste them into `.env` as `JWT_SECRET=` and `ADMIN_KEY=`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Run it twice, once for each value.
4. Start the server:
   ```bash
   npm start          # normal
   npm run dev        # auto-restart on code changes
   ```
5. Open `http://localhost:3000` in your browser. For testing, create two accounts in two different browsers (or incognito windows).

> `.env` is not included in the repository. The server will not start without `JWT_SECRET` (32+ characters).

### Accounts

During person signup, choose your own sign-in code, or leave the field empty so a readable word-and-number code is generated. New custom codes can be up to 15 characters. Avoid short or easily guessable codes; if the code is lost, the account cannot be recovered.

Professional signup requires an email, phone number, and a password of at least 12 characters. Professional contact details become public after consent.

### Reviews

People can review a Therapist, Psychiatrist, Gynecologist, or Psychologist after exchanging messages. Each person has one editable 1-to-5 rating per professional and may add a remark. Peer levels are calculated from rating count and average; they are not medical credentials or a measure of clinical outcomes. Professional credentials are self-reported unless an admin verifies them.

## Environment variables (`.env`)

| Variable | Required? | Meaning |
|---|---|---|
| `PORT` | No | Server port (default 3000) |
| `JWT_SECRET` | **Yes** | Secret used to sign login tokens, 32+ characters. The server will not start without it |
| `ADMIN_KEY` | Yes (for admin use) | Password-like key for the admin API |
| `DB_PATH` | No | Path of the SQLite file (default `./app.db`) |

## Admin tasks (verify professionals, reports, ban)

Admin routes require the header `x-admin-key: <your ADMIN_KEY>`.

```bash
# View reports
curl localhost:3000/api/admin/reports -H "x-admin-key: YOUR_KEY"

# Verify a professional (check their license yourself first)
curl -X POST localhost:3000/api/admin/verify \
  -H "x-admin-key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"alias":"Therapist-41182"}'

# Ban/delete a user
curl -X POST localhost:3000/api/admin/ban \
  -H "x-admin-key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"alias":"Person-1234"}'
```

How to verify: separately ask the professional (by email) for proof of their license, check it, and then call `verify`. Do not store the proof on the site.

## API (short)

Routes marked "Auth" need the header `Authorization: Bearer <token>`.

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/api/register` | No | Person: `{role, code?}` -> alias + sign-in code + token. Professional: full profile + password + `publicContactConsent` |
| POST | `/api/login` | No | `{code}` -> token (person accounts) |
| POST | `/api/professional-login` | No | `{identifier, password}` -> token (email or phone) |
| GET | `/api/people` | Yes | 12 random members (blocked users excluded) |
| GET / POST | `/api/posts` | Yes | View feed / create a post (optional `replyTo`) |
| GET | `/api/conversations` | Yes | Your chats with the latest message |
| GET | `/api/messages/:alias` | Yes | Chat history with one member |
| GET | `/api/reviews/:alias` | Yes | Reviews and rating summary for a professional |
| POST | `/api/reviews` | Yes | `{alias, rating, remark}` (people only, after messaging) |
| GET | `/api/stats` | Yes | Posts per day and members by role |
| POST | `/api/block`, `/api/report` | Yes | Safety |
| GET | `/api/admin/reports` | Admin | View reports |
| POST | `/api/admin/verify`, `/api/admin/ban` | Admin | Verify or remove a member |
| Socket | `dm` event `{to, body}` | Token | Real-time message |

## Before going live (deploying)

- [ ] Set up HTTPS (Render, Railway, Azure App Service, or Nginx + Let's Encrypt). Without HTTPS, login codes are not safe.
- [ ] Generate new random `JWT_SECRET` and `ADMIN_KEY` values, and never push `.env` to GitHub.
- [ ] Take regular backups of the SQLite file (`app.db`), and attach a persistent disk on the hosting platform. On free hosts the disk is often wiped on restart.
- [ ] Write a Privacy Policy and Terms: what is stored, what is not, and that this is not therapy.
- [ ] Have a moderation plan: someone who reviews reports every day.
- [ ] Expand the crisis words list (`CRISIS` in `server.js`) to suit your language.
- [ ] Think about children: a plan for separate rules/parental consent for users under 18.

## Known limitations

- If the sign-in code is lost, a person account cannot be recovered (this is the price of anonymity).
- Message content is stored in plain text on the server (not end-to-end encrypted). Tell users about this in the privacy policy.
- The role "Person" or "Therapist" is self-selected. Do not trust anyone without a verified badge.
- Professional contact details are public once consent is given, and ownership of the email or phone is not verified.
- Crisis detection is only keyword matching; it cannot replace a human.
- Anyone can message anyone, so moderation (block, report, admin review) is essential.
- The Content Security Policy header is currently disabled in Helmet.

## Future ideas

- AI-assisted moderation and smarter crisis detection (for example, a content-safety service).
- Email or phone verification for professionals.
- Moderator dashboard instead of curl-based admin tasks.

## Helplines (India)

- Tele-MANAS: **14416** (free, 24x7)
- Emergency: **112**
