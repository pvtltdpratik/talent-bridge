# Deployment (prepared, NOT executed)

> **Status: prepared only.** Nothing has been run against any server. No server address, PEM key or domain has been provided
> and none is stored in this repository. Do not deploy until (1) tests pass, (2) you approve the plan produced from the
> inspection step below.

## Target topology

```
Internet ──443──> Nginx ──/            static files  client/dist           (gzip, security headers, SPA fallback)
                        └─/api,/health  proxy → 127.0.0.1:4000  (PM2: talentbridge-api)  ──> Supabase (DB, Auth, Storage) + Gemini
```

Files: `deploy/nginx/talentbridge.conf`, `deploy/ecosystem.config.cjs`, `deploy/logrotate-talentbridge.conf`,
`deploy/scripts/{server-inspect,build-release,deploy}.sh`.

Suggested server layout (change after inspection if the server differs):

```
/var/www/talentbridge/
  releases/<timestamp>/      unpacked release (server/, client/dist, supabase/, deploy/)
  current -> releases/<ts>   symlink swapped on deploy (rollback = repoint + pm2 reload)
  shared/server.env          secrets, owned by deploy user, chmod 600, never in a release
/var/log/talentbridge/       api.out.log, api.err.log (logrotate: 14 days)
```

## Step 0: what I need from you (and when)

| Item | Needed for | Notes |
|---|---|---|
| Server address + SSH user | inspection | You will supply it; nothing assumes it |
| PEM key | SSH | Keep it outside the repo. `chmod 400 key.pem`. It is `.gitignore`d and the secret scan fails on `*.pem` in the tree |
| Domain name pointing at the server | HTTPS | Let's Encrypt needs a real DNS name. Without one, see "No domain" below |
| Supabase URL, anon key, service-role key, DB connection string, (JWT secret only for legacy projects) | runtime | Put them in `shared/server.env` on the server yourself, or paste them to me when asked |
| Gemini API key + model name | AI features | Optional; app works without |
| SMTP details | email notifications | Optional |

## Step 1: inspect only (safe, read-only)

```bash
ssh -i /path/to/key.pem <user>@<host> 'bash -s' < deploy/scripts/server-inspect.sh
```

It reports OS, user/sudo, CPU/RAM/disk, Node/PM2/Nginx/Certbot, listening ports, running services, firewall state, sshd
settings and existing Nginx sites. It changes nothing. Send me the output; I will write a plan that fits what is actually there
(OS, existing sites/ports, Node version). **No change is made to the server until you confirm the plan.**

## Step 2: build the release (on your machine or CI)

```bash
bash deploy/scripts/build-release.sh      # secret scan → server tests+lint → client tests+lint → client build → release-*.tar.gz
```

A broken build cannot be packaged because the gates run first.

## Step 3: one-time server preparation (after approval; typical Ubuntu/Debian)

1. Non-root deploy user with key-only SSH; `PermitRootLogin no`, `PasswordAuthentication no`.
2. Firewall / security group: allow 22 (your IP if possible), 80, 443 only. **Do not expose 4000.**
3. Install Node.js ≥ 20 LTS, `nginx`, `certbot python3-certbot-nginx`, and `npm i -g pm2`.
4. `mkdir -p /var/www/talentbridge/{releases,shared} /var/log/talentbridge`; own them by the deploy user.
5. Create `/var/www/talentbridge/shared/server.env` from `server/.env.example`, `chmod 600`. Set
   `NODE_ENV=production`, `CORS_ORIGINS=https://your.domain`, `CLIENT_URL=https://your.domain`.
6. Copy `deploy/nginx/talentbridge.conf` to `/etc/nginx/sites-available/`, replace `example.com`, enable it, `nginx -t`.
7. HTTPS: `certbot --nginx -d your.domain -d www.your.domain` (renewal is automatic: verify with `certbot renew --dry-run`).
8. `cp deploy/logrotate-talentbridge.conf /etc/logrotate.d/talentbridge`.
9. `pm2 startup` (once) so the API returns after a reboot.

### No domain?

Let's Encrypt cannot issue certificates for a bare IP. Options: (a) get a domain (even a free subdomain) and point an A record
at the server; (b) put Cloudflare or an AWS load balancer/CloudFront in front, which terminates TLS for its own hostname;
(c) for a private demo only, use a self-signed certificate and accept the browser warning. Tell me which and I will adapt the
Nginx file. **I will wait for your decision rather than assume.**

## Step 4: deploy

```bash
scp -i key.pem release-<ts>.tar.gz deploy/scripts/deploy.sh <user>@<host>:/tmp/
ssh -i key.pem <user>@<host> 'bash /tmp/deploy.sh /tmp/release-<ts>.tar.gz'
```

`deploy.sh` unpacks to a new release folder, installs production dependencies, runs migrations (idempotent, each file once),
switches the `current` symlink, reloads PM2, then polls `/health`; **if the health check fails it restores the previous release
automatically.** It refuses to run if `server.env` is not mode 600 and never prints its contents.

Front-end note: `client/dist` is served directly by Nginx from `current/client/dist`; no Node process is needed for it.

## Health checks

```bash
curl -fsS https://your.domain/health                       # {"status":"ok","db":"up","ai":{"configured":true|false},"email":{"enabled":…}}
curl -fsS http://127.0.0.1:4000/health                     # on the server, bypassing Nginx
pm2 status talentbridge-api && pm2 logs talentbridge-api --lines 100
sudo nginx -t && sudo systemctl status nginx
node server/scripts/migrate.js                             # prints "skip" for applied migrations; fails loudly on DB problems
```

`/health` returns 503 with `"db":"down"` when Postgres is unreachable, which makes it suitable for an uptime monitor.

## Rollback plan

| Situation | Action |
|---|---|
| Health check fails during deploy | automatic (script) |
| Bad release discovered later | `ln -sfn /var/www/talentbridge/releases/<previous> /var/www/talentbridge/current && pm2 reload talentbridge-api` (last 5 releases are kept) |
| Bad migration | migrations are additive; restore from a Supabase backup/PITR and redeploy the previous release. Take a backup before any release that adds a migration |
| Secrets leaked | rotate the Supabase service-role key / Gemini key, update `server.env`, `pm2 reload`, review `audit_logs` |

## Security checklist

- [ ] PEM never committed; `chmod 400`; consider a passphrase and a bastion/IP allow-list
- [ ] Key-based SSH only, root login disabled, `fail2ban` or provider equivalent
- [ ] Security group/UFW: only 22/80/443; port 4000 bound to 127.0.0.1 behind Nginx
- [ ] `server.env` mode 600, owned by the deploy user, outside `releases/`
- [ ] Supabase service-role key only on the server; anon key used only by the API
- [ ] `CORS_ORIGINS` is exactly the production origin
- [ ] HTTPS with HSTS (in the Nginx file); certificate renewal tested
- [ ] Supabase email confirmation / password policy decided; Auth redirect URL set to `CLIENT_URL`
- [ ] First admin created with `npm run seed:admin`; password stored in a manager
- [ ] Backups: Supabase PITR or scheduled `pg_dump`
- [ ] Log rotation active; no secrets in logs (the logger redacts credentials)
- [ ] If you ever run more than one API instance: move rate limiting to Redis and switch PM2 to cluster mode

## Out-of-band items I will not do without you

Provision or modify AWS resources (security groups, IAM, load balancers, DNS), install packages on the server, open ports, or
issue certificates. Each needs your explicit go-ahead after you have seen the plan.

---

## Standalone deployment: EC2 + RDS PostgreSQL (no Supabase)

Used for the first real deployment. All data (accounts, profiles, applications, audit log) lives in the RDS database;
resumes are files on the EC2 disk.

| Setting | Value |
|---|---|
| `AUTH_PROVIDER=local` | email/password accounts in schema `auth` of `DATABASE_URL`; passwords are salted **scrypt** hashes; refresh/recovery tokens stored hashed; access tokens are HS256 JWTs signed with `AUTH_JWT_SECRET` |
| `STORAGE_PROVIDER=local` | files under `LOCAL_UPLOAD_DIR` (mode 700), readable only through 2-minute HMAC-signed links `GET /api/files/<token>` |
| `TRUST_PROXY=0` | API reachable directly; set to `1` once Nginx fronts it |

Layout on the server (deploy user's home, so no root needed): `~/talentbridge/{releases/<ts>, current, shared/server.env (600), shared/uploads, logs}`.
The process runs as `talentbridge-api` in the **existing** pm2 daemon on port 4000, alongside any other pm2 apps.

```bash
# one-time database + schema (idempotent)
DOTENV_CONFIG_PATH=~/talentbridge/shared/server.env node scripts/create-database.js
AUTH_PROVIDER=local DOTENV_CONFIG_PATH=~/talentbridge/shared/server.env node scripts/migrate.js
# first admin
DOTENV_CONFIG_PATH=~/talentbridge/shared/server.env ADMIN_EMAIL=you@example.com node scripts/seed-admin.js
# run
TB_ROOT=~/talentbridge TB_LOG_DIR=~/talentbridge/logs pm2 start current/deploy/ecosystem.config.cjs --only talentbridge-api --env production
pm2 save
```

Operational notes
* `supabase/standalone/bootstrap.sql` must only be applied to plain Postgres (the migrate script does it when `AUTH_PROVIDER=local`). Never on a Supabase project.
* Password-reset links are emailed, so reset needs SMTP settings; without them the request is accepted but no mail is sent.
* Uploaded resumes are on one disk: include `shared/uploads` in your backups, or move to S3 before running a second instance.
* Rotating `AUTH_JWT_SECRET` signs every user out and invalidates outstanding file links.

---

## Switching authentication to Supabase (data stays in RDS)

Target: **Supabase Auth** for sign-up / sign-in / password reset, **RDS** for all application data, resumes still on the
server disk (`STORAGE_PROVIDER=local`). Supabase then holds only identities (email + password hash); profiles, drives,
applications and the audit log remain in the `talentbridge` RDS database.

### 1. In the Supabase dashboard (project → Settings)
| Need | Where | Goes in `server.env` as |
|---|---|---|
| Project URL | Settings → API | `SUPABASE_URL` |
| Publishable / anon key | Settings → API Keys | `SUPABASE_ANON_KEY` |
| **Secret / service-role key** (server only; never commit, never put in the client) | Settings → API Keys | `SUPABASE_SERVICE_ROLE_KEY` |
| JWT secret (**only** if the project still uses the legacy HS256 secret) | Settings → JWT | `SUPABASE_JWT_SECRET` |

Authentication → URL Configuration: set **Site URL** to the frontend origin (`CLIENT_URL`) and add
`<CLIENT_URL>/reset-password` to **Redirect URLs**, or password-reset links will be rejected.
Authentication → Providers → Email: decide whether **Confirm email** is required. Supabase's built-in mailer is heavily
rate limited; configure your own SMTP under Authentication → SMTP for real use.

### 2. On the server (`~/talentbridge/shared/server.env`)
```
AUTH_PROVIDER=supabase
STORAGE_PROVIDER=local        # resumes stay on this server's disk
DB_MODE=standalone            # DATABASE_URL is RDS, not a Supabase database
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
# keep AUTH_JWT_SECRET: it still signs the resume download links
```

### 3. Apply and restart
```bash
cd ~/talentbridge/current/server
DOTENV_CONFIG_PATH=~/talentbridge/shared/server.env node scripts/migrate.js   # drops the profiles -> auth.users FK (idempotent)
pm2 restart talentbridge-api --update-env
curl -s http://127.0.0.1:4000/health
```

### 4. Things to know
* **Existing local accounts cannot be moved.** Their passwords are scrypt hashes, which Supabase cannot import. Switch before real
  users register, or have those users re-register / reset their passwords.
* **Create the first admin again** with `ADMIN_EMAIL=... node scripts/seed-admin.js` (it now creates the user in Supabase).
* **Tokens:** the API verifies Supabase JWTs locally via the project's JWKS. If sign-in works but every API call returns
  `401 invalid_token`, the project uses the legacy secret: set `SUPABASE_JWT_SECRET`.
* **Deleting an account** removes the profile row first and then the Supabase user; a failure in between leaves an orphaned
  Supabase user that can be removed from the dashboard (Authentication → Users).
* Rolling back is a config change: set `AUTH_PROVIDER=local` again (users created in Supabase will not exist locally).
