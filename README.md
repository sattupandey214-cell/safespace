# SafeSpace

Ek anonymous peer-support website. Jo log stress, depression ya kisi problem se guzar rahe hain, wo apni baat share kar sakte hain, aur Therapist/Psychiatrist bhi jud sakte hain. **Kisi ka naam, email, phone ya college kahin store ya show nahi hota.** Sirf role (Person / Therapist / Psychiatrist) aur ek random alias dikhta hai.

> SafeSpace peer support hai, therapy ya medical treatment ka replacement nahi.

## Features

| Feature | Detail |
|---|---|
| Anonymous signup | Sirf role chunna hota hai. Random alias milta hai (jaise `Person-48213`) |
| Secret-code login | Email/password nahi. 32-character code, DB mein sirf SHA-256 hash |
| Posts feed | Role badge ke saath posts |
| Random log | Koi bhi kisi ko 1-to-1 message kar sakta hai (Socket.IO, real-time) |
| Verified badge | Admin license check karke Therapist/Psychiatrist ko verify karta hai |
| Block / Report | Har chat se, report admin ko dikhti hai |
| Crisis detection | "marna chahta", "suicide" jaise words par helpline dikhti hai |
| Safety basics | Rate limit, Helmet headers, XSS-safe rendering, 1000-char limit |

## Folder structure

```
safespace/
├── backend/
│   ├── server.js        # Express + Socket.IO + SQLite
│   ├── package.json
│   ├── .env             # Tumhari secrets (git mein nahi jaati)
│   └── .env.example     # Template
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── .gitignore
└── README.md
```

Backend hi frontend ko serve karta hai, to ek hi server chalana hai.

## Setup (step by step)

1. **Node.js 18+** install karo (`node -v` se check karo).
2. Terminal mein `backend` folder kholo:
   ```bash
   cd safespace/backend
   npm install
   ```
3. `.env` file already di hui hai. Agar nayi banani ho:
   ```bash
   cp .env.example .env
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Output ko `JWT_SECRET=` ke aage paste karo. `ADMIN_KEY` ke liye bhi yahi karo.
4. Server chalao:
   ```bash
   npm start          # normal
   npm run dev        # code badalne par auto-restart
   ```
5. Browser mein `http://localhost:3000` kholo. Testing ke liye do alag browsers (ya incognito) mein do accounts banao.

## Environment variables (`backend/.env`)

| Variable | Zaroori? | Matlab |
|---|---|---|
| `PORT` | Nahi | Server port (default 3000) |
| `JWT_SECRET` | **Haan** | Login tokens sign karne ka secret, 32+ characters. Na ho to server start nahi hoga |
| `ADMIN_KEY` | Haan (admin use ke liye) | Admin API ki password-jaisi key |
| `DB_PATH` | Nahi | SQLite file ka path (default `./app.db`) |

## Admin kaam (Therapist verify, reports, ban)

Admin routes ke liye header `x-admin-key: <tumhari ADMIN_KEY>` bhejna hota hai.

```bash
# Reports dekho
curl localhost:3000/api/admin/reports -H "x-admin-key: YOUR_KEY"

# Therapist ko verify karo (pehle uska license khud check karo)
curl -X POST localhost:3000/api/admin/verify \
  -H "x-admin-key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"alias":"Therapist-41182"}'

# Kisi user ko ban/delete karo
curl -X POST localhost:3000/api/admin/ban \
  -H "x-admin-key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"alias":"Person-1234"}'
```

Verify karne ka tareeka: therapist se alag se (email par) license ka proof maango, check karo, phir `verify` call karo. Proof ko site par store mat karo.

## API (short)

| Method | Route | Kaam |
|---|---|---|
| POST | `/api/register` | `{role}` -> alias + secret code + token |
| POST | `/api/login` | `{code}` -> token |
| GET | `/api/people` | 12 random users (blocked nahi) |
| GET / POST | `/api/posts` | Feed dekho / post karo |
| GET | `/api/messages/:alias` | Chat history |
| POST | `/api/block`, `/api/report` | Safety |
| Socket | `dm` event `{to, body}` | Real-time message |

## Live (deploy) karne se pehle

- [ ] HTTPS lagao (Render, Railway, ya Nginx + Let's Encrypt). Bina HTTPS ke login code safe nahi.
- [ ] `JWT_SECRET` aur `ADMIN_KEY` naye random banao, `.env` kabhi GitHub par push mat karo.
- [ ] SQLite file (`app.db`) ka regular backup lo, aur hosting par persistent disk lagao.
- [ ] Privacy Policy aur Terms likho: kya store hota hai, kya nahi, aur ye therapy nahi hai.
- [ ] Moderation ka plan rakho: reports roz dekhne wala koi ho.
- [ ] Crisis words ki list (`CRISIS` in `server.js`) apni bhasha ke hisaab se badhao.
- [ ] Bachon ke liye sochna: 18 se kam umar ke users ke liye alag rules/parental consent ka plan.

## Known limitations

- Secret code kho gaya to account recover nahi hota (yahi anonymity ki keemat hai).
- Message content server par plain text mein hai (end-to-end encrypted nahi). Is baare mein users ko privacy policy mein batao.
- Role "Person" ya "Therapist" khud chuna jata hai. Verified badge ke bina kisi par bharosa mat karo.
- Crisis detection sirf keyword matching hai, ye insaan ki jagah nahi le sakta.

## Helplines (India)

- Tele-MANAS: **14416** (free, 24x7)
- Emergency: **112**
