# FutureFit

FutureFit is a hiring-assessment demo for understanding the work behind a submission: a practical task, a consent-based process replay, an AI viva, a timed debugging check, and a human-readable evidence report. AI activity is context only and is never a standalone rejection signal.

## Requirements

- Node.js 22+ (Node 22.9+ required for optional `.env` loading)
- npm

## Run locally

```powershell
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The Vite client and Express API start together. SQLite is initialized automatically at `data/skillproof.db`, with three demo candidates seeded on the first run. The `.env` file is optional; without an LLM key the viva questions and answer rubric use a local demo fallback.

Open **Dashboard** to browse the seeded candidates, or choose **Try the demo** to complete the candidate flow. After the viva, candidates complete a four-minute debugging check; an optional accessibility setting adds two minutes. The demo check uses a constrained fix selector and does not execute candidate-provided code.

To enable an OpenAI-compatible chat-completions API, add these values to `.env`:

```dotenv
LLM_API_KEY=your_key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

The server reads `.env` at startup. Never commit your `.env` file. An API error is shown to the user rather than silently changing the result. Optionally set `DATA_RETENTION_DAYS` to a positive number to remove expired assessment records daily; `0` (the default) disables cleanup. The three built-in demo profiles are preserved.

To configure optional LLM or retention settings, create `.env` from the example only if you do not already have one, then edit it:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

## Scripts

- `npm run dev` — start Vite (`5173`) and Express (`3001`)
- `npm run build` — type-check and create the production client in `dist/`
- `npm run preview` — preview the production client

## Project structure

```text
src/
  App.tsx          Landing, assessment, viva, dashboard, detail, credential
  index.css        Tailwind and editor styles
  lib/api.ts       Typed client for the Express API
  main.tsx         React entry point
  types.ts         Shared evidence and candidate types
server/
  index.js         Express routes, SQLite schema, seed data, optional LLM calls
data/
  skillproof.db    Created automatically at runtime (ignored by git)
```

## Candidate flow

1. Select **Try the demo** and review the consent notice. Recording starts only after the candidate opts in. The editor records keypress counts, edits, paste line counts, elapsed time, tab visibility changes, and prompts sent to the optional assistant. It does not record camera, microphone, screen, or browsing activity.
2. Submit the code to create a persisted assessment and generate three viva questions.
3. Answer each viva question. The configured LLM scores each answer for understanding; without a key, a local demo rubric is used.
4. Complete the timed debugging check. Test outcomes, time, and focus changes are added to the report; no submitted code is executed by the demo.
5. Review the score and supporting evidence in the HR dashboard. Verified candidates receive a shareable credential page; credentials can also be checked at `/verify`.

## Scoring rubric

The single scoring configuration is defined in `server/index.js` and exposed at `GET /api/scoring-config`:

| Signal | Weight |
| --- | ---: |
| Viva understanding | 30% |
| Process pattern | 20% |
| AI usage quality | 20% |
| Live skill check | 20% |
| Time and paste behavior | 10% |
| AI-text style observation | 0% |

These are illustrative demo heuristics, not an authorship detector. **Verified skill** requires a score of 80+ and a passing live check. **Needs review** covers scores from 55–79 and conflicting evidence. **Low confidence** requires a score below 55 and at least three independent weak signals. Text-style observations describe answer length only, are labelled weak, and add zero points. The report shows the component evidence; a human reviewer makes the final decision.

## API overview

All routes are served by Express on port `3001` (the Vite development server proxies `/api`):

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/scoring-config` | Weights and verdict thresholds |
| `GET` | `/api/candidates` | List candidate evidence |
| `GET` | `/api/candidates/:id` | Read one candidate report |
| `POST` | `/api/assessment` | Persist a consented assessment |
| `POST` | `/api/candidates/:id/questions` | Generate viva questions |
| `POST` | `/api/candidates/:id/answer` | Save and score one viva answer |
| `POST` | `/api/candidates/:id/live-check` | Save live-check test and timing evidence |
| `POST` | `/api/candidates/:id/complete` | Calculate the final score and verdict |
| `POST` | `/api/assistant` | Get a hint or explanation |
| `GET` | `/api/verify/:credentialId` | Verify a public credential ID |

Candidate records are persisted in the local SQLite database. With the default `DATA_RETENTION_DAYS=0`, records remain until manually cleared. A positive retention setting deletes expired assessment records daily, preserving the three built-in demo profiles. Do not use real candidate data without establishing an appropriate retention and access policy.

## Three-minute demo script

1. **0:00–0:25 — Landing:** introduce the problem and show the evidence layers.
2. **0:25–1:05 — Candidate task:** click **Try the demo**, review the consent details, enter a name, consent, and edit the starter code. Optionally ask the assistant for a hint and mark it checked.
3. **1:05–1:35 — Viva:** submit and answer the three short questions. The demo fallback scores answers without requiring an API key.
4. **1:35–2:05 — Live check:** opt in to the timed check, choose a fix, run tests, and observe the mid-task requirement update.
5. **2:05–2:40 — Evidence:** review the process replay, AI-use context, viva, live-check outcomes, and weighted scoring.
6. **2:40–3:00 — HR and credential:** open **Dashboard**, compare the seeded candidates, and verify Maya Chen’s credential with `sp-8f31c4`.

The seeded candidate records provide a verified, needs-review, and low-confidence example immediately; completing the live flow adds a fourth record.
