# API reference

Base URL: `/api` (JSON). Success envelope `{ "data": … }`; errors `{ "error": { "code", "message", "details?", "requestId" } }`.
Authentication: `Authorization: Bearer <Supabase access token>` (obtained from `POST /api/auth/login`).
Lists are paginated with `?page=&pageSize=` (max 100) and return `{ items, page, pageSize, total, totalPages }`.

Every protected route runs: **authenticate** (JWT verified, profile loaded) → **account status must be `active`** →
**role check** → **validation (zod)** → service-level **college scope / ownership** checks.

## Permission matrix

| Area | Public | Student | Placement cell (own college) | Admin (all) |
|---|---|---|---|---|
| Register / login / reset / accept invite | ✔ | | | |
| Own profile, projects, experience, resumes | | ✔ | | |
| Student list / detail / resume link / verify | | | ✔ | ✔ |
| Companies (workspace) create / edit / report | | | ✔ | ✔ |
| Drives: list/view | | ✔ (open/closed/completed, own college) | ✔ | ✔ |
| Drives: create / edit / status / extend deadline | | | ✔ | ✔ |
| Apply / withdraw / my applications | | ✔ (verified + eligible/approved exception) | | |
| Set application status, manual order | | | ✔ | ✔ |
| Exception request create / withdraw | | ✔ | | |
| Exception decision | | | ✔ | ✔ |
| Interviews: schedule / update | | | ✔ | ✔ |
| Interviews: mine | | ✔ | | |
| Analytics, AI ranking, AI insights | | | ✔ | ✔ |
| AI resume parse/analyse, readiness, match, skill-gap, roadmap, recommendations | | ✔ | | |
| Users, roles, approvals, invitations, colleges, audit log, settings, platform metrics | | | | ✔ |
| Notifications | | ✔ (own) | ✔ (own) | ✔ (own) |

A request for another college's record returns **404**, not 403, so existence is not disclosed.

## Auth
| Method & path | Notes |
|---|---|
| `GET /auth/colleges` | public list for the registration form |
| `POST /auth/register/student` | role fixed server-side; `status=active`, profile `unverified`. Body: `email,password,fullName,phone?,collegeId,consent:true` |
| `POST /auth/register/placement-cell` | role fixed server-side; `status=pending` until an admin approves |
| `GET /auth/invite/:token` · `POST /auth/accept-invite` | single-use, expiring (default 7 days), identity comes from the invite, not the body |
| `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` | login/refresh are IP rate limited |
| `POST /auth/forgot-password` · `POST /auth/reset-password` | always answers 202 (no account enumeration) |
| `GET /auth/me` | allowed for `pending/suspended/rejected` so the UI can show state |
| `DELETE /auth/me` | student erases account + data (audited) |

## Students
`GET|PUT /students/me` · `POST|PUT|DELETE /students/me/projects[/:id]` · `POST|PUT|DELETE /students/me/experience[/:id]` ·
`POST /students/me/apply-parsed` (merge reviewed AI-parsed data) · `GET|POST /students/me/resumes` (multipart `file`) ·
`GET /students/me/resumes/:id/url` (signed, 120 s) · `DELETE /students/me/resumes/:id`.
Staff: `GET /students` · `GET /students/:id` · `GET /students/:id/resume-url` · `PATCH /students/:id/verification {status: verified|needs_changes, comment}`.
Editing CGPA, 10th/12th %, backlogs, department, batch or roll number on a *verified* profile resets it to `unverified` (audited).

## Companies, drives
`GET|POST /companies` · `GET|PATCH /companies/:id` (workspace: drives + hiring numbers) · `GET /companies/:id/report.csv`.
`GET /drives` · `GET /drives/:id` (students also get `eligibilityResult`, `canApply`, `canRequestException`) · `POST /drives` ·
`PATCH /drives/:id` · `POST /drives/:id/status` · `POST /drives/:id/extend-deadline {deadline, reason}` ·
`GET /drives/:id/eligibility-report` · `GET /drives/:id/report` · `GET /drives/:id/report.csv`.

## Applications, exceptions, interviews
| Endpoint | Rules |
|---|---|
| `POST /applications {driveId}` | active → same college → drive `open` → before deadline → profile `verified` → eligible **or** approved exception. One per (student, drive): DB unique constraint. Stores eligibility snapshot + history. |
| `GET /applications/mine` · `GET /applications/:id` · `POST /applications/:id/withdraw` | withdraw only before a decision |
| `GET /applications` · `PATCH /applications/:id/status` · `PUT /applications/order` | staff only; transitions validated; audited; student notified; **AI never calls these** |
| `POST /exceptions {driveId, reason 10-1000}` | only for `ineligible` verified students; one active (pending/approved) per drive: DB partial unique index |
| `GET /exceptions/mine` · `POST /exceptions/:id/withdraw` | pending only |
| `GET /exceptions` · `POST /exceptions/:id/decision {decision, note}` | same college; rejection needs a note; audited; never edits the original eligibility result; deadline still applies |
| `POST /interviews` · `PATCH /interviews/:id` · `GET /interviews` · `GET /interviews/mine` | only for shortlisted candidates; notifies the student |

## Notifications
`GET /notifications` · `GET /notifications/unread-count` · `POST /notifications/:id/read` · `POST /notifications/read-all`.

## Analytics (real data only)
`GET /analytics/overview` · `/analytics/skill-gaps` · `/analytics/eligibility-dropoff` · `/analytics/exceptions` (admin may pass `?collegeId=`).

## AI (`POST` may call the model; `GET` only reads saved results)
Responses always carry `ai: { status: ok|unavailable|none, reason?, message?, cached?, stale?, generatedAt? }`.
When AI is unavailable the deterministic part of the response is still returned (HTTP 200).

| Endpoint | Deterministic part | AI part |
|---|---|---|
| `GET /ai/status` | | |
| `POST /ai/resume/parse` · `GET /ai/resume/parsed` | | skills, education, experience, projects (review before saving) |
| `POST /ai/resume/analyze` · `GET /ai/resume/analysis` | | component scores + reasons; overall = mean of components |
| `GET /ai/readiness` | academics, skills, projects, experience, completeness, weights, re-normalisation | resume quality |
| `POST /ai/match/:driveId` · `GET /ai/match/:driveId` | required-skills match, academic fit | role + project relevance |
| `POST /ai/skill-gap` · `GET /ai/skill-gap/:driveId` | missing mandatory / preferred skills | learning steps |
| `GET /ai/recommendations` | everything (no model call) | uses cached AI components if present |
| `POST /ai/ranking/:driveId {pool, ai, force}` | eligibility, verification, skill match | optional enrichment (≤ 20 candidates per call) |
| `POST /ai/interview-questions` · `GET /ai/interview-questions/:driveId` | | technical + HR questions |
| `POST /ai/roadmap {weeks: 4|8|12}` · `GET /ai/roadmap?weeks=` | skill gaps from open drives | phased plan |
| `POST /ai/insights` · `GET /ai/insights` | all numbers (SQL) | narrative only |

AI POSTs are rate limited per user (admin-configurable, default 30/hour) and globally (120/min).

## Admin
`GET /admin/users` · `PATCH /admin/users/:id/status` · `PATCH /admin/users/:id/role` · `POST /admin/admins` ·
`GET|POST /admin/invitations` · `DELETE /admin/invitations/:id` · `GET|POST /admin/colleges` · `PATCH /admin/colleges/:id` ·
`GET /admin/audit-logs` · `GET|PUT /admin/settings` · `GET /admin/metrics`.

## Health
`GET /health` and `GET /api/health`: `{ status, db, ai: { configured }, email: { enabled } }` (503 when the DB is unreachable). No secrets.

## Status / error codes worth knowing
`401 invalid_token|unauthorized` · `403 account_pending|account_rejected|account_suspended|role_forbidden|profile_not_verified|not_eligible` ·
`404 not_found` · `409 already_applied|deadline_passed|drive_not_open|exception_already_active|invalid_transition|not_pending` ·
`410 invite_invalid` · `413 file_too_large` · `422 profile_incomplete|unsupported_file|no_resume|resume_unreadable` · `429 rate_limited`.
