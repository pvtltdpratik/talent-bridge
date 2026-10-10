# Testing

Run everything: `npm test` (root) · server only: `npm --prefix server test` · client only: `npm --prefix client test`.
No test makes a network call or a paid Gemini request: Gemini, Supabase Auth and Supabase Storage are replaced by in-memory fakes.
Database tests run the **real migrations and real SQL** on PGlite (Postgres compiled to WASM), so constraints, partial unique
indexes, transactions and RLS policies are genuinely exercised.

## Result of the last full run

| Suite | Files | Tests | Result |
|---|---|---|---|
| Server (Vitest + Supertest + PGlite) | 8 | **141** | all passing |
| Client (Vitest + Testing Library) | 4 | **26** | all passing |
| Server lint (ESLint) / Client lint | | | 0 errors, 0 warnings |
| Secret scan (`scripts/check-secrets.js`) | | | passed |
| Client production build | | | succeeded |

## What is covered

**Unit (server)**
* Eligibility: every criterion, boundary values (`>=`, `<=`), missing data → `unavailable`/`incomplete`, `fail` beats `incomplete`, department case-insensitivity, odd input never throws.
* Scoring: weighted average, **weight re-normalisation when a component is missing**, `null` total when nothing is available, backlog penalty, AI-sourced flags, skill alias matching, profile completion.
* AI validation: scores clamped to 0-100, unknown keys dropped, bad structure rejected, list/string caps, JSON-schema conversion for all seven features.
* Gemini client: key in header never URL, retry with backoff on 429/5xx/network, timeout, non-retryable 4xx hides the provider message, invalid JSON / empty / blocked / truncated output, fenced JSON tolerated.
* Anonymiser + prompt hygiene: name/email/phone/links/college and protected-attribute lines removed, resume text cannot close the data fence, every system prompt marks data as untrusted.

**API integration (server)**
* Registration cannot create privileged roles (payload `role`/`status` ignored); placement cell self-registration is `pending`.
* Pending/suspended/rejected accounts blocked on every protected route; only `/auth/me` is reachable.
* Role separation: student ↛ staff/admin; placement cell ↛ admin; unauthenticated/invalid token → 401.
* Invitations: hash-only storage, single use, expiry, revocation, replaced by a newer invite, identity taken from the invite (payload email ignored), audited.
* Admin: approve/reject (reason required), role change audited, cannot change own role/status.
* Apply: eligible+verified succeeds with snapshot and history; duplicate blocked in code **and** by the DB constraint; concurrent double-submit → exactly one row; unverified, ineligible (reasons per criterion), incomplete, past deadline, closed/draft drive, other college all blocked; withdraw/re-apply; decisions cannot be withdrawn.
* Exceptions end to end: request does not grant eligibility; other-college staff get 404; approval audited and notified; apply-via-exception keeps the original `ineligible` snapshot; duplicate active request blocked (code + partial unique index); rejection needs a note and allows a fresh request; approval does not bypass the deadline; extension is audited; withdraw only when pending.
* Statuses: transitions validated, `withdrawn` unreachable by staff, history + audit + notification written, students cannot decide, cross-college blocked.
* Verification: `needs_changes` needs a comment; audited; academic edits on a verified profile reset verification.
* Interviews only for shortlisted candidates; notifications; CSV export with formula-injection protection; analytics scoped by college.
* Resumes: real PDF and DOCX text extraction, content-based type detection (a fake `.pdf` is rejected), scanned PDF reported clearly with no fake score, size limit from settings, versioning with one active, signed URL only for owner/same-college staff/admin, deletion promotes previous version, account erasure.
* AI: unconfigured / disabled / failing model all degrade gracefully (HTTP 200, rule-based parts intact); result caching and `force`; invalid output retried once and stored as `failed`; stale analysis not used for scores; prompts contain no name/college; **AI cannot override eligibility**; ranking never changes statuses and manual order overrides; insights say "not enough data" instead of inventing; unknown metric references dropped; per-user AI rate limit.
* Rate limiting on login; error handler never leaks stack traces; `/health` exposes no secrets.

**Database (RLS and constraints)**
* RLS enabled on every public table; anon sees nothing; students see only their rows; staff only their college; audit log admin-only;
  write privileges revoked for `anon`/`authenticated`; CHECK constraints and one-active-resume index enforced.

**Client**
* Route guards (signed-out, loading, wrong role, pending account), login form (validation, success routing, server error, pending account routing),
  registration (consent + matching passwords, no role sent), confirm dialog (mandatory reason), API client (bearer, refresh once on 401, forced sign-out, field errors, network failure), score breakdown/ring accessibility, badge text labels, en-IN formatting.

## Manual verification performed

With the local preview (`npm --prefix server run preview` + `npm --prefix client run dev`) the following were driven in a real browser:
student sign-in → dashboard (readiness breakdown) → drives list → drive detail (eligibility table, match, AI fit, learning plan);
placement-cell dashboard → drive → pipeline/ranking tab; admin approvals. The browser console surfaced a real MUI v9 incompatibility
(removed `Stack` system props), which was fixed and re-checked.

## Not tested / known limits (read this before relying on it)

* **Live Supabase Auth and Storage.** The adapters (`adapters/supabaseAuth.js`, `adapters/storage.js`) were written from the
  supabase-js API but never run against a real project (no keys were available). First sign-up/sign-in/upload on your project is the real test.
* **Live Gemini.** The REST request shape (`generateContent`, `responseJsonSchema`) and the default model name come from documentation.
  Tests use a mock. Run one real resume analysis after adding the key and adjust `GEMINI_MODEL` if needed.
* **Email (SMTP)** path is untested (off by default).
* **Supabase RLS** was tested on vanilla Postgres with Supabase-style roles and `auth.uid()` stubs, not on Supabase itself.
* **No automated end-to-end browser suite** and **no automated accessibility audit** (axe/Lighthouse). Keyboard focus, labels,
  `aria-*` and contrast were designed in and spot-checked, not machine-audited.
* **Mobile layout** (375 px): dashboard, profile and drive detail were checked in a browser for horizontal overflow and
  drawer navigation, with none found. The remaining pages use the same responsive primitives but were not each inspected.
* **Rate limiting is in-memory**: correct for one API process; with several instances use a shared store.
* **Load/performance** was not measured. Lists are paginated and indexed; the candidate-ranking and eligibility reports load a
  college's students in memory (bounded to 5,000) which suits a college, not a university system.
