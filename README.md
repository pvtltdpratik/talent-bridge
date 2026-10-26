<div align="center">

<img src="docs/assets/logo.png" alt="TalentBridge AI logo" width="240" />

# TalentBridge AI

**An AI-assisted campus placement platform where rules decide and AI explains.**

Students, placement cells and admins run the whole placement cycle in one place:
drives, eligibility, applications, interviews and hiring analytics.

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](https://expressjs.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-RLS-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Gemini](https://img.shields.io/badge/Google-Gemini-8E75B2?logo=googlegemini&logoColor=white)](https://ai.google.dev)

[Live demo](https://talent-bridge-sand.vercel.app) ·
[Architecture](docs/ARCHITECTURE.md) ·
[API](docs/API.md) ·
[Deployment](docs/DEPLOYMENT.md)

</div>

---

## Overview

```
Profile upload → AI resume analysis → Readiness score → Placement review → Hiring analytics
```

TalentBridge AI is built around three principles:

| Principle | What it means in practice |
|---|---|
| **Rules decide** | Eligibility is deterministic. AI never overrides it, never changes an application status and never rejects anyone. |
| **Explainable scoring** | Every score shows its components, weights, evidence and reason. Missing data is excluded and the weights are re-normalised. |
| **Real data only** | No fabricated statistics. Charts and insights say so when there is not enough data. |

## Features

**Students**
- Profile, academics, skills and projects, with consent captured at registration
- Resume upload (PDF or DOCX) with an AI review and an AI-assisted profile fill that you approve before saving
- Browse drives with a clear eligible / not-eligible reason, apply, and track applications and interviews
- Career roadmap and notifications; delete your own account at any time

**Placement cell**
- Company and drive management, with eligibility rules (CGPA, branch, backlogs, year)
- Review applications, handle exceptions, schedule interviews, export reports
- Approve students and invite staff within their own college

**Admins**
- Bootstrap the platform, manage colleges and approvals, and read the audit log

**AI features** (Gemini, server-side only)
- Resume analysis, structured resume parsing and career-roadmap suggestions
- Output is JSON validated with zod, cached by input hash, and degrades gracefully: when AI is unavailable the rule-based parts of every page keep working

## Tech stack

| Layer | Technology |
|---|---|
| Client | React 19, Vite, MUI + Bootstrap grid, React Router, React Query, react-hook-form + zod, Recharts |
| API | Node.js 20+, Express 5, zod, helmet, express-rate-limit, pg |
| Data | PostgreSQL with row-level security (Supabase, or any standalone Postgres such as AWS RDS) |
| Auth | Supabase Auth, or built-in local auth (scrypt passwords, signed JWTs, rotating refresh tokens) |
| Storage | Private Supabase Storage, or local disk with short-lived signed links |
| AI | Google Gemini, called from the server only |
| Ops | PM2, Nginx, Let's Encrypt; deployed on AWS EC2 + RDS |
| Quality | Vitest, Supertest, Testing Library, PGlite (real SQL in tests), ESLint |

## Architecture

```
 Browser (React SPA)
        │  HTTPS, Bearer token. No keys, no Supabase SDK in the bundle.
        ▼
 Express API ── routes → controllers → services → repositories
        │            │                                  │
        │            └── domain/ (eligibility, scoring) └── PostgreSQL (RLS, audit log)
        ├── adapters/  auth · storage · mailer (swap Supabase ⇄ local)
        └── ai/        Gemini client, runner (cache, schema check, retry)
```

Provider selection is configuration only: `AUTH_PROVIDER` and `STORAGE_PROVIDER` are each `supabase` or `local`.
Details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout

```
client/      React SPA (theme, components, layouts, routes, pages/{student,placement,admin})
server/      Express API (routes, controllers, services, repositories, domain, ai, adapters, middleware)
supabase/    SQL migrations (schema + RLS) and standalone-Postgres bootstrap
deploy/      Nginx, PM2, logrotate, deploy / build / inspect scripts (no secrets)
docs/        Architecture, assumptions, database, API, testing, deployment
scripts/     Secret scan and git hook installer
```

## Getting started

**Prerequisites:** Node.js 20+, a PostgreSQL database (a Supabase project works), and optionally a Gemini API key.

```bash
# 1. Install dependencies
npm run install:all

# 2. Configure
cp server/.env.example server/.env      # fill DATABASE_URL, auth/storage provider, (GEMINI_API_KEY)
cp client/.env.example client/.env      # leave VITE_API_URL empty in development

# 3. Apply database migrations
npm run db:migrate

# 4. Create the first admin (public registration can never create admins)
ADMIN_EMAIL=you@college.edu npm run seed:admin    # prints a generated password once

# 5. Run
npm run dev:server        # http://localhost:4000   (health: /health)
npm run dev:client        # http://localhost:5173   (proxies /api to :4000)
```

Then, as admin: add your college, invite placement staff, and let students register.

<details>
<summary><b>Try it without any database (local preview)</b></summary>

```bash
npm --prefix server run preview                       # in-memory Postgres + fake auth; AI shows "not configured"
PREVIEW_FAKE_AI=1 npm --prefix server run preview     # canned AI answers, marked "[preview AI]"
npm run dev:client
```

The preview prints sample logins. It refuses to run with `NODE_ENV=production`, stores nothing and is not for real users.
Optional labelled sample data for a development database: `SEED_DEMO=true npm run seed:demo` (refuses in production).

</details>

## Configuration

Every variable is documented in [`server/.env.example`](server/.env.example) (names only, no values).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_PROVIDER` | `supabase` or `local` |
| `STORAGE_PROVIDER` | `supabase` or `local` |
| `CORS_ORIGINS` | Comma-separated list of allowed browser origins |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Enable AI features; set the model your key supports |
| `VITE_API_URL` (client) | Only needed when the API is on a different origin |

Secrets exist **only** on the server. The browser bundle contains no keys.

## Security and privacy

- Row-level security on every table; writes from browser roles are revoked
- Role checks on the server, college-level data isolation, rate limiting, CORS allow-list, helmet headers
- Private resume storage with short-lived links; audit log for sensitive actions
- AI prompts have names, contact details, links and the college name removed
- Secret scanning on every commit (`npm run check:secrets`, installable as a pre-commit hook)

Designed with the principles of the Digital Personal Data Protection Act, 2023 in mind: notice and consent at registration,
purpose limitation, data minimisation and student-initiated erasure. This is a design aim, not legal advice; have your
institution's counsel review it.

## Quality gates

```bash
npm test               # server and client test suites
npm run lint
npm run check:secrets
npm run build          # client production build → client/dist
```

What is and is not verified is written down in [docs/TESTING.md](docs/TESTING.md).

## Deployment

The API runs under PM2 on AWS EC2 with data in RDS PostgreSQL; the client is a static build served from Vercel (or Nginx).
Step-by-step instructions, including switching authentication to Supabase while keeping data in RDS, are in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Layers, modules and data flow |
| [DATABASE](docs/DATABASE.md) | Schema, RLS policies and migrations |
| [API](docs/API.md) | Endpoints, roles and error format |
| [TESTING](docs/TESTING.md) | What is and is not verified |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | EC2 + RDS, Nginx, PM2, Supabase switch |
| [ASSUMPTIONS](docs/ASSUMPTIONS.md) | Product and technical defaults |

## Out of scope (by design)

AI mock or video interviews, GitHub/LinkedIn verification, internship recommendations, an AI career-coach chat, workforce
analytics, a trained placement-probability model (there is no dataset), and a company self-login role. The data model
leaves room for the last one (`company_contacts`).
