# TalentBridge AI

AI-assisted campus placement and recruitment platform for engineering colleges.
Students, placement cells and (via the placement cell) companies share one system:

`Profile upload → AI resume analysis → Readiness score → Placement review → Hiring analytics`

* **Explainable scoring**: every score shows its components, weights, evidence and reason; missing data is excluded and weights re-normalised.
* **Rules decide eligibility**; AI never overrides it, never changes an application status and never rejects anyone.
* **Real data only**: no fabricated statistics. Charts and insights say so when there is not enough data.

| Layer | Tech |
|---|---|
| Client | React 19 + Vite, MUI (components/theme) + Bootstrap grid/utilities, React Router, React Query, react-hook-form + zod, Recharts |
| API | Node.js 20+ + Express 5, zod validation, helmet, express-rate-limit, pg |
| Data | Supabase Postgres (+ RLS), Supabase Auth, private Supabase Storage |
| AI | Gemini (server-side only, structured JSON validated with zod) |
| Ops | Nginx + PM2 + Let's Encrypt (prepared, not yet deployed) |

## Repository layout

```
client/      React SPA (src/theme, components, layouts, routes, pages/{student,placement,admin})
server/      Express API (src/routes → controllers → services → repositories, domain/, ai/, adapters/, middleware/)
supabase/    migrations (schema + RLS)
deploy/      nginx, pm2, logrotate, deploy / build / inspect scripts (no secrets)
docs/        ARCHITECTURE, ASSUMPTIONS, DATABASE, API, TESTING, DEPLOYMENT
scripts/     secret scan + git hook installer
```

## Quick start (local, with your own Supabase project)

Prerequisites: Node.js ≥ 20, a Supabase project, (optional) a Gemini API key.

```bash
# 1. dependencies
npm run install:all

# 2. configuration
cp server/.env.example server/.env      # fill SUPABASE_*, DATABASE_URL, (GEMINI_API_KEY)
cp client/.env.example client/.env      # leave VITE_API_URL empty in development

# 3. database (applies supabase/migrations once each)
npm run db:migrate

# 4. first admin (never created via public registration)
ADMIN_EMAIL=you@college.edu npm run seed:admin     # prints a generated password once

# 5. run
npm run dev:server        # http://localhost:4000   (health: /health)
npm run dev:client        # http://localhost:5173   (proxies /api to :4000)
```

Then, as admin: add your college (**Colleges**), invite placement staff (**Approvals & invites**), and students register themselves.

In Supabase → Authentication, decide whether email confirmation is required; the app respects whichever you choose.
Set the Auth "Site URL" / redirect to your `CLIENT_URL` so password-reset links land on `/reset-password`.

### Try it without Supabase (local preview)

```bash
npm --prefix server run preview            # in-memory Postgres + fake auth; AI shows "not configured"
PREVIEW_FAKE_AI=1 npm --prefix server run preview   # canned AI answers, marked "[preview AI]"
npm run dev:client
```

The preview prints sample logins. It refuses to run with `NODE_ENV=production`, stores nothing, and is not for real users.
Optional labelled sample data for a real dev database: `SEED_DEMO=true npm run seed:demo` (refuses in production).

## Environment variables

See [`server/.env.example`](server/.env.example) (every variable, no values). Secrets (`SUPABASE_SERVICE_ROLE_KEY`,
`GEMINI_API_KEY`, `DATABASE_URL`, SMTP) exist **only** on the server. The browser bundle contains no keys and no Supabase SDK.

## Quality gates

```bash
npm test               # 141 server + 26 client tests
npm run lint
npm run check:secrets  # also installable as a pre-commit hook: npm run hooks:install
npm run build          # client production build → client/dist
```

## Documents

[ARCHITECTURE](docs/ARCHITECTURE.md) · [ASSUMPTIONS](docs/ASSUMPTIONS.md) · [DATABASE](docs/DATABASE.md) ·
[API](docs/API.md) · [TESTING](docs/TESTING.md) (what is and is not verified) · [DEPLOYMENT](docs/DEPLOYMENT.md)

## Data protection (India)

Designed with the principles of the Digital Personal Data Protection Act, 2023 in mind: notice and consent at registration
(`/privacy`), purpose limitation, data minimisation, college-level isolation, private resume storage with short-lived links,
audit trail, and student-initiated erasure (`Privacy & account → Delete my account`). AI prompts have names, contact
details, links and college name removed. This is a design aim, not legal advice; have your institution's counsel review it.

## Out of scope (by design)

AI mock/video interviews, GitHub/LinkedIn verification, internship recommendations, AI career-coach chat, workforce
analytics/IoT, a trained placement-probability model (no dataset), and a company self-login role. The data model leaves room
for the last one (`company_contacts`).
