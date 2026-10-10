# Assumptions and Decisions

This file records every decision made where the build prompt was silent or ambiguous.
Section numbers refer to the TalentBridge AI build prompt.

## A. Repository state and conflicts

| # | Topic | Decision |
|---|---|---|
| A1 | Existing code | The workspace only contained an untouched `create-next-app` scaffold (default home page, no custom code). It was created minutes earlier from the one-line request "create a nextjs project". |
| A2 | Next.js vs. React + Vite | The full build prompt (Section 12) explicitly specifies **React + Vite** and **Express**. The detailed, later instruction wins, so the Next.js scaffold was removed and replaced by `client/` (Vite) and `server/` (Express). If you actually want Next.js, the client is isolated and can be re-platformed; the API does not depend on it. |
| A3 | Git | A git repo was initialised by the scaffold. Nothing has been committed. |

## B. Architecture decisions

| # | Topic | Decision |
|---|---|---|
| B1 | DB access | The backend talks to Supabase Postgres through a direct `pg` connection (`DATABASE_URL`) so multi-step actions can use real transactions (`SELECT ... FOR UPDATE`). Supabase is used for **Auth** and **Storage** only (service-role key, backend only). The browser never talks to Supabase; the client has no Supabase dependency. |
| B2 | RLS | RLS is enabled on every table with read policies scoped by role/college and **no write policies** for `anon`/`authenticated`. All writes go through the API. This is defence in depth: a leaked anon key cannot read or write anything it should not. |
| B3 | Auth flow | Register / login / refresh / forgot / reset are proxied through the Express API (so they can be rate limited and the role is always chosen server-side). Tokens are Supabase JWTs. The API verifies them locally with `jose` (HS256 secret if `SUPABASE_JWT_SECRET` is set, otherwise the project JWKS). |
| B4 | Token storage | The SPA keeps the access/refresh token in `localStorage`. This is a known XSS trade-off; mitigated by helmet CSP in production and no `dangerouslySetInnerHTML`. |
| B5 | Eligibility storage | Eligibility is computed on demand (pure function, cheap at college scale) and the evaluation used at apply-time is stored as `applications.eligibility_snapshot` / `exception_requests.eligibility_snapshot`. A separate `eligibility_evaluations` table was dropped as redundant. |
| B6 | Status combination | If any criterion fails the overall status is `ineligible`, even if other criteria are unavailable. `incomplete` is used only when nothing failed but something is missing. |
| B7 | Active exception request | "Active" means `pending` or `approved`. A student can file a new request after a `rejected` or `withdrawn` one. |
| B8 | Exception + deadline | An approved exception does not bypass the deadline. Staff can extend a drive's deadline (audited); extended deadline then applies to everyone. |
| B9 | Placement cell scope | Placement-cell members only see data where `college_id` equals their own. Admin can pass `?college_id=` to scope, otherwise sees all. |
| B10 | Companies | Company records belong to the college whose placement cell created them (`companies.college_id`). A `company_contacts` table exists for a future company login but is **not exposed** by any endpoint. |
| B11 | Admin bootstrap | First admin is created by `supabase/seed/seed-admin.js` using `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars. If `ADMIN_PASSWORD` is empty a random one is generated and printed once to the console of the person running the script. |
| B12 | Email verification | Whatever the Supabase project is configured to do (confirm-email on/off) is respected. Registration never bypasses it. |

## C. Scoring decisions

| # | Topic | Decision |
|---|---|---|
| C1 | Academics | `0.6 * CGPA/10 + 0.2 * 10th% + 0.2 * 12th%` (parts that are missing are dropped and weights re-normalised inside the component), minus 10 points per active backlog, floored at 0. Unavailable when CGPA is missing. |
| C2 | Skills | `min(skill count, 10) / 10 * 100`. Unavailable when no skills have been entered. |
| C3 | Projects / experience | Deterministic: each project/experience entry is worth up to 33 / 50 points depending on description detail. **Zero entries scores 0 and is treated as available** because "none" and "not entered yet" cannot be told apart; the UI says so. When an AI resume analysis exists, its project-relevance score is averaged into Projects and flagged as AI. |
| C4 | Resume quality | Comes only from a validated AI resume analysis. Unavailable if there is no readable resume, AI is off, or the call failed. No fake score is ever produced. |
| C5 | Profile completeness | Deterministic: 14 weighted fields (see `server/src/domain/profileCompletion.js`). |
| C6 | Job match | Required-skills 50 (deterministic: mandatory counted double), academic fit 15 (deterministic), role/experience relevance 20 and projects relevance 15 (AI). If AI is unavailable those two are marked unavailable and weights are re-normalised ("Based on 2 of 4 components"). |
| C7 | Skill matching | Case-insensitive, with a small alias table (`js` = `javascript`, `node` = `nodejs`, ...). Skills are matched against profile skills plus skills parsed from the active resume. |
| C8 | Recommendations | Ranked by the deterministic match score only (no paid AI call per drive), restricted to open drives the student is eligible for or can request an exception for. Cached AI components are used when they already exist. |
| C9 | Candidate ranking | Composite = match score (0-100) with verified + eligible applicants first. Optional `?ai=true` enriches up to 20 applicants lacking a cached AI match. The placement cell can save a manual order which overrides the AI order. AI never changes a status. |

## D. AI decisions

| # | Topic | Decision |
|---|---|---|
| D1 | Transport | Plain `fetch` to the Gemini REST API (`generateContent`) with a JSON schema generated from the same zod schema used for validation. Key and model come from env only. |
| D2 | Unverified | The exact request shape was written from documentation, **not** exercised against the live API because no key was supplied. Tests use a mock. |
| D3 | Fairness | Name, email, phone, links, gender/age/religion/caste-style lines and the college name are removed from prompts before sending. |
| D4 | Caching | Keyed by `(feature, user, drive, input_hash)`; only successful, validated results are cached. |
| D5 | Rate limits | Per-user hourly AI limit and global per-minute limit (in-memory; for multi-instance deployments move to Redis, noted in DEPLOYMENT.md). |

## E. Defaults taken from Section 20

Multi-college via `college_id`; student must be `verified` to apply; invitation expiry 7 days;
upload limit 5 MB, PDF/DOCX only; in-app notifications on, email off unless SMTP env set;
INR / `en-IN` / IST; Google login off.

## F. Things deliberately not built (Section 16)

AI mock/video interviews, GitHub/LinkedIn verification, internship recommendations, AI career-coach chat,
workforce analytics/IoT, ML placement-probability model, company self-login.

## G. Added during the build

| # | Topic | Decision |
|---|---|---|
| G1 | Verification reset | If a *verified* student edits CGPA, 10th/12th %, backlogs, department, batch or roll number, the profile returns to `unverified` (audited, student told). Otherwise a student could raise their CGPA after verification and apply. Skills, projects, links etc. do not reset it. |
| G2 | Exception requirements | A student must be `verified` to file an exception, and only an `ineligible` (not `incomplete`) result qualifies. |
| G3 | Re-applying | A withdrawn application is re-activated (same row) if the student applies again before the deadline; history records it. |
| G4 | Interview scheduling | Allowed only for `shortlisted` (or already `interview_scheduled`) applications; scheduling moves the status to `interview_scheduled`. Withdrawing cancels scheduled interviews. |
| G5 | Application statuses set by staff | `under_review`, `shortlisted`, `interview_scheduled`, `selected`, `rejected`. A rejected application can be reopened to `under_review`; `selected` is final. |
| G6 | Drive lifecycle | draft → open → closed/completed/cancelled; closed → open again only with a future deadline. Open drives past their deadline are auto-closed on read. Opening a drive notifies students who are not ruled out by the rules. |
| G7 | Match-score AI parts | Role/experience and project relevance prompts receive no CGPA or name; academic fit is rule-based. |
| G8 | AI result freshness | An analysis made for an older resume version is shown as "stale" and is **not** used in the readiness score. |
| G9 | Ranking pools | "Applicants of this drive" (default) or "all eligible, verified students". AI enrichment is capped at 20 candidates per request. Saving a manual order sets `manual_rank` which then takes precedence. |
| G10 | Local preview | `server/scripts/dev-preview.js` runs the real API on in-memory Postgres with fake auth for UI exploration. Never for production; it is blocked when `NODE_ENV=production`. |
| G11 | Gemini default model | `gemini-2.5-flash` is only a default; set `GEMINI_MODEL` to whatever your key supports. |
| G12 | Fonts | Space Grotesk and Inter are self-hosted via npm (@fontsource), so no third-party font request is made and the CSP can stay `'self'`. |
| G13 | MUI v9 | `Stack` no longer accepts `alignItems`/`justifyContent`/`flexWrap`; `client/src/components/layout.jsx` wraps it so the existing API keeps working. |
