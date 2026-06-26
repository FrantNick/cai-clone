# Character.AI clone

A Character.AI-style mobile chat UI built on top of [SillyTavern](https://github.com/SillyTavern/SillyTavern)'s prompt engine, plus a custom 3-tier persistent memory system so characters remember you across conversations.

The original SillyTavern UI is still available at `/admin.html` for power-user tasks (settings, API key, character creation, lorebooks, extensions).

---

## What's here

```
public/
├── index.html              # CAI shell (Home / Chats / Chat views)
├── admin.html              # SillyTavern's original UI (untouched, served at /admin)
├── css/cai-theme.css       # Dark theme — Character.AI design tokens
└── scripts/cai/            # Vanilla-ES-module frontend
    ├── main.js             # bootstrap
    ├── router.js           # 3-view router + bottom nav
    ├── home.js             # discover grid
    ├── chats.js            # conversation list
    ├── chat.js             # chat view, streaming completions, memory injection
    ├── memory.js           # memory bottom sheet
    └── api.js              # CSRF + ST/memory endpoint helpers

src/
├── constants.js            # +memory directory entry
├── server-startup.js       # +/api/memory router registration
├── server-main.js          # +/admin route → admin.html
└── endpoints/memory.js     # NEW — memory CRUD + prompt builders

data/default-user/memory/   # auto-created at first boot
└── <character>/
    ├── config.json         # { mode, enabled, extractionInterval, … }
    ├── persistent.json     # Tier 2 — shared across all chats with this char
    └── <chat-file>.json    # Tier 3 — per-chat isolated store
```

---

## Setup

```bash
npm install
node server.js
# open http://localhost:8000
```

First-time config (do this once, at <http://localhost:8000/admin.html>):

1. **API → Chat Completion → OpenRouter** (or your preferred provider).
2. Paste your API key, pick a model (e.g. `anthropic/claude-sonnet-4-5` or `meta-llama/llama-3.1-70b-instruct`).
3. Set context size to whatever your model supports.
4. (Recommended) Enable the **Summarize** extension — Update every 10 messages, target 200 words, depth 2.

Once that's done, navigate back to `/` and you'll see the CAI shell. The default Seraphina character ships with SillyTavern and will appear in the Home grid on first boot.

To add more characters, drop V2 character cards (PNG with embedded JSON or `.json` files) into `data/default-user/characters/`, or use the admin panel.

---

## The memory system

There are three independently-toggleable tiers. They stack — a chat can use Tier 1 alone, or Tier 1 + Tier 2, etc.

| Tier | Scope                     | Storage                                         | Toggle               |
| ---- | ------------------------- | ----------------------------------------------- | -------------------- |
| 1    | In-session chat history   | ST's existing chat log + Summarize extension    | Always on            |
| 2    | Across ALL chats per char | `data/default-user/memory/<char>/persistent.json` | Memory sheet → Shared |
| 3    | Just this chat (isolated) | `data/default-user/memory/<char>/<chat>.json`     | Memory sheet → Isolated |
| Off  | None — no persistence     | n/a                                             | Memory sheet → Off   |

Tap the brain icon in the chat top bar to open the memory sheet. You can change the mode, edit the summary directly, delete individual facts, or clear everything.

### How extraction runs

Every `extractionInterval` user messages (default 10), the chat view:

1. Fetches the active memory store for the character.
2. POSTs to `/api/memory/extraction-prompt` with the recent conversation slice + the list of existing facts. The endpoint returns a ready-to-send extraction prompt.
3. Sends that prompt to the same chat-completion backend (using the user's existing API key and model). Forces JSON-array output.
4. POSTs the parsed facts back to `/api/memory/<char>/facts` — the server dedupes against existing facts by normalised content.
5. Calls `/api/memory/summary-prompt`, runs it through the LLM, and writes the resulting 2–4 sentence narrative summary to the store.
6. Updates `lastExtractionMessageCount` in config so we don't re-extract until N more messages.

### How the memory shows up in prompts

Before every send, the chat view calls `GET /api/memory/<char>/preamble` and inserts the returned block (if non-empty) as a system message right after the persona definition:

```
[Character Memory — What {{char}} remembers about {{user}} from previous conversations:]
<summary or bullet-listed facts>
```

That happens **before** the recent chat history, exactly as in the spec.

### REST endpoints

All endpoints live under `/api/memory/` and require the same CSRF token + login session as the rest of ST's API.

```
GET    /api/memory/:char/config            → current config
POST   /api/memory/:char/config            → patch { mode | enabled | extractionInterval }
GET    /api/memory/:char[?chat=...]        → { config, store }
GET    /api/memory/:char/preamble[?chat=…] → { preamble, mode, enabled }
POST   /api/memory/:char/facts             → { facts: [{content, importance}], chat? }
DELETE /api/memory/:char/facts/:id         → drop a single fact
PUT    /api/memory/:char/summary           → replace the rolling summary
POST   /api/memory/:char/clear             → wipe the active store (Tier 2 or Tier 3)
POST   /api/memory/extraction-prompt       → returns a ready-to-send prompt
POST   /api/memory/summary-prompt          → returns a ready-to-send prompt
```

`?chat=<filename>` is honoured only when `config.mode === "isolated"`; otherwise the Tier-2 `persistent.json` is the active store.

---

## Frontend notes

* Plain vanilla ES modules, no build step.
* The 3 views are sibling `<section>` elements in `public/index.html`; the router toggles `cai-view-active` and hides the bottom nav while the Chat view is up.
* Streaming uses ST's `/api/backends/chat-completions/generate` with `stream: true` and parses SSE deltas in `chat.js`.
* CSRF: `api.js` warms `/csrf-token` once, then sets `x-csrf-token` on every non-GET.
* The Create / Library / Profile nav buttons are present but inert, matching the screenshot.

## Admin (the original ST UI)

`<http://localhost:8000/admin.html>` (or `/admin`) gives you the full SillyTavern interface: settings, persona editor, lorebooks, extensions, character creation forms, prompt inspector, the works. Use it whenever you need something the CAI shell doesn't expose.

---

## Optional / not yet wired

These are scaffolded but not active by default:

* **TTS** — the speaker icon in the Chat view is decorative. Wire it to ST's TTS extension via the admin panel.
* **Character creation from the `+` button** — currently inert. Use `/admin.html` to create.
* **Group chats / Scenes tab** — placeholder; falls back to "For You" content.
* **Expression sprites** — ST supports them, but the avatar in the chat top bar is static for now.

## License & attribution

Forked from [SillyTavern](https://github.com/SillyTavern/SillyTavern) — see `ST-README.md` and `LICENSE` for upstream attribution. All custom CAI code in `public/scripts/cai/`, `public/css/cai-theme.css`, `public/index.html`, and `src/endpoints/memory.js` is part of this fork and inherits ST's AGPL-3.0.
