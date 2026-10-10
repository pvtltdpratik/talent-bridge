# Architecture

## 1. Current state (at start of build)

The workspace contained only a default `create-next-app` scaffold with no domain code, no documents and no
configuration worth keeping. There was nothing to preserve; the scaffold was replaced (see ASSUMPTIONS A1/A2).

## 2. Conflicts between sources (resolved per the prompt, Section 2)

| Topic | Deck | Built |
|---|---|---|
| Backend | FastAPI / Django | Node.js + Express |
| AI | scikit-learn / sentence-transformers | Gemini (server-side) + deterministic Node code |
| DB | PostgreSQL | Supabase Postgres + RLS |
| Frontends | separate portals | one React app, role layouts |
| Company portal | separate portal | "Company workspace" inside the placement area, no company login |
| Placement probability | trained model | **not built** (no dataset); transparent readiness score instead |

## 3. System diagram

```
Browser (React + Vite SPA, MUI + Bootstrap grid)
   |  HTTPS, JSON, Bearer <Supabase JWT>
   v
Nginx  --serves-->  client/dist
   |  /api
   v
Express API (PM2)
   routes -> controllers -> services -> repositories -> pg Pool --> Supabase Postgres (RLS on)
                               |-> storage adapter --> Supabase Storage (private "resumes" bucket)
                               |-> ai/ (prompts v1, zod schemas, cache) --> Gemini REST
                               |-> auth adapter --> Supabase Auth (service role, backend only)
```

## 4. Layering rules (server)

* **routes** declare path, middleware chain (`authenticate`, `requireRole`, `validate`) and bind a controller.
* **controllers** are thin: pull validated input off `req`, call one service, shape the response.
* **services** hold business rules (eligibility enforcement, deadlines, transitions, audit).
* **repositories** hold SQL only. No business rules.
* **domain/** is pure (no I/O): eligibility, scoring, completeness, skill matching. Highly unit-tested.
* **ai/** wraps Gemini: client, versioned prompts, zod schemas, runner (cache + store + fallbacks), anonymiser.

## 5. Security model

1. `authenticate` verifies the JWT, loads `profiles` (role, status, college) and rejects non-`active` accounts.
   The single exception is `GET /api/auth/me`, which lets a `pending` user learn their state.
2. `requireRole(...)` is applied per route. Roles come only from our `profiles` table.
3. College scoping is applied inside services via `scopeCollege(user, requested)`; a placement-cell user can
   never read or write another college's rows.
4. Ownership checks for student resources (resume signed URLs, applications, exception requests).
5. Every privileged change writes `audit_logs` in the same transaction as the change.
6. Secrets: env only. Error handler never returns stacks. Logger redacts `authorization`, `apikey`, `password`, etc.

## 6. Workflows

* **Apply**: authenticate -> student active -> profile verified -> drive open & before deadline -> eligibility
  `eligible` or an `approved` exception -> insert application (unique `(student, drive)`) + history + snapshot, in one tx.
* **Exception**: ineligible student files request (unique active per student/drive) -> staff of same college decides ->
  on approval (tx): lock request row, mark approved, audit, notify. Student then applies; the application is flagged
  `via_exception = true`; the original eligibility result is kept in the snapshot.
* **Verification**: student profile `unverified | needs_changes | verified` set by same-college staff (audited, notified).
* **Placement cell account**: `pending` -> admin approve/reject (audited), or invite (hashed single-use token, 7 days, email-bound).

## 7. Frontend structure

`client/src`: `theme/` (tokens + MUI theme + CSS variables), `components/` (design system), `layouts/` (Student / Placement /
Admin shells), `routes/` (guards), `api/` (fetch wrapper + hooks), `pages/<role>/...`.
