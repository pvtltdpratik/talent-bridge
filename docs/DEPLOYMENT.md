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
