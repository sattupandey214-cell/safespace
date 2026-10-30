# SafeSpace

A peer-support website. Person accounts stay anonymous. Professional accounts give consent to show their name, email, phone, qualification, and institution on a public profile; only a secure hash of the password is stored. Contact ownership is not verified by this site, and professional qualifications are self-reported until an admin separately verifies them.

> SafeSpace is peer support, not a replacement for therapy or medical treatment.

## Features

| Feature | Detail |
|---|---|
| Person signup | You only choose a role. You get a random alias (like `Person-48213`) |
| Person login | Choose your own sign-in code or generate a readable word-and-number code; only a hash is stored in the DB |
| Professional signup/login | Name, phone, email, qualification, institution, and password; profile details are public after explicit consent, and passwords are stored as scrypt hashes |
| Posts feed | Posts with a role badge |
| Random log | Anyone can message anyone 1-to-1 (Socket.IO, real-time) |
| Peer-support reviews | People can anonymously rate and leave remarks for professionals after messaging them; levels are based on received ratings |
| Verified badge | The admin checks licenses and verifies professional roles |
| Block / Report | Available from every chat; reports are shown to the admin |
| Crisis detection | A helpline is shown on words like "I want to die" or "suicide" |
| Safety basics | Rate limit, Helmet headers, XSS-safe rendering, 1000-character limit |

## Folder structure

```
safespace/
├── backend/
│   ├── server.js        # Express + Socket.IO + SQLite
│   ├── package.json
│   ├── .env             # Your secrets (not committed to git)
│   └── .env.example     # Template
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── .gitignore
└── README.md
```

The backend serves the frontend itself, so you only need to run one server.

## Setup (step by step)

1. Install **Node.js 18+** (check with `node -v`).
2. Open the `backend` folder in a terminal:
   ```bash
   cd safespace/backend
   npm install
   ```
3. The `.env` file is already provided. If you need to create a new one:
   ```bash
   cp .env.example .env
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Paste the output after `JWT_SECRET=`. Do the same for `ADMIN_KEY`.
4. Run the server:
   ```bash
   npm start          # normal
   npm run dev        # auto-restart on code changes
   ```
5. Open `http://localhost:3000` in your browser. For testing, create two accounts in two different browsers (or incognito windows).

During person signup, choose your own sign-in code, or leave the field empty so a readable word-and-number code is generated. New custom codes can be up to 15 characters. Avoid short or easily guessable codes; if the code is lost, the account cannot be recovered. Professional signup requires an email/phone and a password of at least 12 characters. Professional contact details become public after consent.

People can review a Therapist, Psychiatrist, Gynecologist, or Psychologist after exchanging messages. Each person has one editable 1-to-5 rating per professional and may add a remark. Peer levels are calculated from rating count and average; they are not medical credentials or a measure of clinical outcomes. Professional credentials are self-reported unless an admin verifies them.

## Environment variables (`backend/.env`)

| Variable | Required? | Meaning |
|---|---|---|
| `PORT` | No | Server port (default 3000) |
| `JWT_SECRET` | **Yes** | Secret used to sign login tokens, 32+ characters. The server will not start without it |
| `ADMIN_KEY` | Yes (for admin use) | Password-like key for the admin API |
| `DB_PATH` | No | Path of the SQLite file (default `./app.db`) |

## Admin tasks (verify therapists, reports, ban)

Admin routes require the header `x-admin-key: <your ADMIN_KEY>`.

```bash
# View reports
curl localhost:3000/api/admin/reports -H "x-admin-key: YOUR_KEY"

# Verify a therapist (check their license yourself first)
curl -X POST localhost:3000/api/admin/verify \
  -H "x-admin-key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"alias":"Therapist-41182"}'

# Ban/delete a user
curl -X POST localhost:3000/api/admin/ban \
  -H "x-admin-key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"alias":"Person-1234"}'
```

How to verify: separately ask the therapist (by email) for proof of their license, check it, and then call `verify`. Do not store the proof on the site.

## API (short)

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/register` | `{role}` -> alias + secret code + token |
| POST | `/api/login` | `{code}` -> token |
| GET | `/api/people` | 12 random users (not blocked) |
| GET / POST | `/api/posts` | View feed / create a post |
| GET | `/api/messages/:alias` | Chat history |
| POST | `/api/block`, `/api/report` | Safety |
| Socket | `dm` event `{to, body}` | Real-time message |

## Before going live (deploying)

- [ ] Set up HTTPS (Render, Railway, or Nginx + Let's Encrypt). Without HTTPS, login codes are not safe.
- [ ] Generate new random `JWT_SECRET` and `ADMIN_KEY` values, and never push `.env` to GitHub.
- [ ] Take regular backups of the SQLite file (`app.db`), and attach a persistent disk on the hosting platform.
- [ ] Write a Privacy Policy and Terms: what is stored, what is not, and that this is not therapy.
- [ ] Have a moderation plan: someone who reviews reports every day.
- [ ] Expand the crisis words list (`CRISIS` in `server.js`) to suit your language.
- [ ] Think about children: a plan for separate rules/parental consent for users under 18.

## Known limitations

- If the secret code is lost, the account cannot be recovered (this is the price of anonymity).
- Message content is stored in plain text on the server (not end-to-end encrypted). Tell users about this in the privacy policy.
- The role "Person" or "Therapist" is self-selected. Do not trust anyone without a verified badge.
- Crisis detection is only keyword matching; it cannot replace a human.

## Helplines (India)

- Tele-MANAS: **14416** (free, 24x7)
- Emergency: **112**
