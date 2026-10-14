# TickTickMath

Fast mental-math practice for 2-digit arithmetic. Big type, tight layout, tricky multiple choice. Built for phones first - solo or 1v1 with a friend.

## Features

- **Four operations** - addition, subtraction, multiplication, division
- **Real-life questions** - percents (`30% dari 90`), discounts (`47.623 −10%`, rounded like a cashier), service fees, rupiah totals, change, split bills (~45% of the mix)
- **ID/EN toggle** - question language switch on home, remembered on device; locale-correct number formatting (`47.623` vs `47,623`)
- **Integer-only problems** - division always exact; subtraction may be negative
- **Tricky answer choices** - common error patterns (carry misses, sign flips, off-by-ten, digit shuffles)
- **Solo modes** - fixed question count (default 20) or infinite mode with live score
- **Multiplayer rooms** - up to 8 players, one room code, shared questions, ready + 3-2-1 countdown
- **Nicknames** - funny random default, editable, remembered on your device; clashes get an automatic suffix
- **Answer race** - first answer on a question starts a countdown for everyone still on it (host sets the seconds, default 3, 0 = off); timeout locks in as blank
- **Instant feedback** - correct/incorrect flash, then auto-advance
- **Mobile-first UI** - fits common phone viewports without scrolling mid-round
- **No account, no backend** - static build; multiplayer uses WebRTC (PeerJS)

## Requirements

- Node.js 20+
- npm

## Development

```bash
npm install
npm run dev
```

Open **http://localhost:5173**

| Command | What it does |
|---------|----------------|
| `npm run dev` | Vite dev server (hot reload) |
| `npm run dev:host` | Dev server on LAN (all network interfaces) |
| `npm test` | Generator + winner logic checks |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve the production build locally |

### Testing multiplayer on two devices

1. `npm run dev:host`
2. Note the Network URL (e.g. `http://192.168.1.5:5173`)
3. All phones open that URL **on the same Wi-Fi**
4. Host creates room, guests join with the code

**WebRTC needs a secure context.** `localhost` is always allowed. Plain `http://192.168.x.x` may block multiplayer in some browsers - if 1v1 fails on LAN, test solo on localhost, or put HTTPS in front (e.g. `npx localtunnel --port 5173`, or deploy to Vercel and test there).

## How to play (solo)

1. Set question count, or enable **Infinite mode**
2. Tap **Play**
3. Read the equation, tap an answer
4. Green = correct, red = wrong; next question loads automatically
5. Finite runs end with a score screen; infinite runs end when you tap **Stop**

## How to play (multiplayer)

1. Everyone opens **Play together** and picks a nickname (random funny one pre-filled, 🎲 rerolls, saved on device)
2. Host: set questions (default **10**, range 1–500) and hurry-up timer (default **3s**, range 0–10, **0 = off**, remembered on device) → **Create room**
3. Share the **6-character code** (Copy button on host); up to **8 players** can join before the game starts
4. Guests: enter code → **Join** (name clash? host auto-renames you with a suffix)
5. Lobby shows join count + who is ready; **all players tap Ready** → countdown **3 · 2 · 1**
6. Same questions on all devices; live bars per player
7. First answer on a question starts the host's countdown for everyone still on it - timeout locks in as **blank** (no countdown when set to 0: pure own-pace race, but a stalled player stalls the room)
8. **Standings** = most correct, then accuracy, then total answering time. Only an exact tie (same score AND same time) shares 1st. Same score with slower time is a clean loss. Every row gets a roast line for its performance (zero-club, speedrunner, bottom frag, mid NPC, slow poke, tiebreak choke, winner, perfect run), same lines on all screens
9. If a player drops mid-game they are removed and the rest continue; if the host drops, the room closes after **10s**
10. **Rematch**: BACK TO ROOM returns everyone to the same room (host can change rounds in the lobby); going Home ends the room for all

## Project structure

```
.
├── index.html          # App shell (screens injected by js/main.js)
├── screens/            # UI split per screen (keeps index.html small)
│   ├── home.html
│   ├── lobby.html
│   ├── wait.html
│   ├── play.html
│   └── results.html
├── css/style.css       # Tailwind v4 + theme keyframes
├── js/
│   ├── main.js         # Entry - injects screens then loads game cores
│   ├── generator.js    # Problem + distractor logic (pure)
│   ├── names.js        # Nickname list + dedupe + device storage (pure)
│   ├── multi.js        # PeerJS room transport + standings sort
│   ├── party.js        # Room state: roster, ready gate, answers (pure)
│   ├── game-state.js   # Shared state + settings (lang/count/grace/hard)
│   ├── game-solo.js    # Screens, solo flow, question render
│   ├── game-multi.js   # Multiplayer room + race + net events
│   ├── game-boot.js    # Event bindings + init
│   └── game.js         # Compat loader (re-exports the four cores)
├── test/
│   ├── generator.test.mjs
│   ├── winner.test.mjs
│   ├── names.test.mjs
│   ├── party.test.mjs
│   └── host-count.test.mjs   # not in npm test; needs dist/ (run: node test/host-count.test.mjs)
├── vite.config.mjs
├── package.json
├── vercel.json
└── README.md
```

## Tech stack

- Vite 7 + Tailwind CSS 4 + vanilla JavaScript
- **Multiplayer:** PeerJS (WebRTC data channels) - signaling via public PeerJS cloud; host relays every message (star topology, host is also a player)
- No database, no login

## Tests

```bash
npm test
```

## Deploy to Vercel

1. Push to GitHub
2. Vercel → **Add New → Project** → import repo
3. Framework Preset: **Vite** (auto-detected from `package.json` / `vercel.json`)
4. Build Command: `npm run build`
5. Output Directory: `dist`
6. **Deploy**

No environment variables. Works on the Vercel free tier.

After the first Vercel deploy, open the **production URL** for multiplayer (HTTPS is required there and already provided).

## Multiplayer notes

- Star topology: guests connect only to the host, the host relays everything (so the host device sees all answers)
- If the host closes the tab, the room ends
- Strict networks may block WebRTC without TURN - not included in v1
- Upgrade path: custom signaling (Cloudflare Worker) or Supabase Realtime

## License

Add a license file if you plan to publish under one (MIT is a common default).
