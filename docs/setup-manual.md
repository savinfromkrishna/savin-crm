# Savingroup full setup manual

Set up this fork of Savingroup on any machine, from nothing to the complete working system: the
Savingroup app with its own Postgres and Docker bot computers, the ERPNext + Frappe CRM site behind
it, your owner account, and a Business space with the Sales Executive, Operations, Finance,
Business Analyst and Operator bots running unattended. A fresh install starts empty (one account,
one bot, no team, no ERP), so sections 7 and 8 are part of every new deployment: they are what add
the business team.

Verified on 2026-10-18 against a working setup on Windows 11 with Docker Desktop. Commands are
written for a POSIX shell (Git Bash, macOS, Linux) and work unchanged in PowerShell when typed on
one line; the only PowerShell difference is `Copy-Item` instead of `cp`.

## 1. What you are deploying

| Component | What it does | Where it runs | Address |
| --- | --- | --- | --- |
| Web app | The UI, served by Vite in development or `vite preview` under Compose | Node (`pnpm dev`) or the app container | http://127.0.0.1:5173 |
| API | Sign-in, REST and RPC, business actions, the client side of the ERPNext bridge | Node | http://127.0.0.1:3100 |
| Worker | Bot runs, routines, the Graphile job queue, live events | Node | no port |
| Sandbox supervisor | Creates and controls bot computers through the Docker API | Node on the host | http://127.0.0.1:7091 |
| Postgres 16 | Every Savingroup record: accounts, spaces, bots, approvals, business ledger, job queue | Docker container `compose-postgres-1`, volume `compose_pgdata` | 127.0.0.1:5433 |
| Bot computers | One Linux desktop container per team or private bot, image `savingroup/computer:local` | Docker, one isolated network each | loopback, random ports |
| ERPNext + Frappe CRM site | Business records, workflow rules, automations; the `savingroup_business_bridge` app exposes them to bots | Docker project `savingroup-frappe`: nginx, backend, two queue workers, scheduler, websocket, MariaDB 11.8, two Redis | http://localhost:8090 |
| Model provider | The language model behind every bot | OpenRouter, Anthropic or another key; or a local OpenAI-compatible server | outbound only |

How they talk: the browser calls the web app, which proxies `/api` and `/rpc` to the API. API and
worker share Postgres (the worker also listens for live events there). The worker asks the
supervisor for computers; the supervisor talks to Docker. The API calls the site's bridge for every
`crm_*`, `erp_*` and `admin_*` action, each as an idempotent operation recorded on both sides. The
site posts signed events back to the API at `BUSINESS_WEBHOOK_BASE_URL`.

The bots live in Savingroup, not on the site: the Operator holds every business and site-administration
tool, the four specialists hold only their role's tools, and the approval rules of the space decide
what pauses for a person.

## 2. Prerequisites

Hardware: 4 CPU cores and 16 GB RAM are comfortable (the ERPNext stack idles at about 2 GB and
its image build needs about 4 GB free; each active bot computer is capped at 2 GB). Allow 40 GB of
free disk: the ERPNext image is 7 GB plus its 4.4 GB base, the bot computer image 2.3 GB, and the
Node dependencies several GB.

| Software | Version | Check | Notes |
| --- | --- | --- | --- |
| Git | any recent | `git --version` | On Windows, Git Bash provides `openssl`, `curl` and `tar` |
| Node.js | 24 LTS (the repo accepts `^22.22.2`, `^24`, `>=26`) | `node --version` | Install from nodejs.org or with your version manager |
| pnpm | 9.15.0 exactly, as declared in `package.json` | `pnpm --version` | `corepack enable && corepack prepare pnpm@9.15.0 --activate`, or `npm i -g pnpm@9.15.0` |
| Docker | Engine 26+ with the Compose plugin | `docker version`, `docker compose version` | Docker Desktop on Windows (WSL 2 backend) and macOS; Docker Engine on Linux |
| OpenSSL | any | `openssl version` | Only for generating secrets; a Node one-liner works instead |
| curl | any | `curl --version` | Only for the verification steps |

Ports that must be free on the machine: 5173 (web), 3100 (API), 7091 (supervisor), 5433 (Postgres
on loopback), 8090 (ERPNext front door). Outbound access is needed to npm, GitHub, Docker Hub,
ghcr.io and your model provider.

Accounts: your GitHub account for the fork, and a model provider key (OpenRouter is the simplest)
unless you will connect a model inside the app after signing up.

## 3. Get the code

The business platform (the `packages/business` package, the `infra/frappe` stack, the Operator,
the bridge app and the admin tools) exists only in the working tree of the original machine: on
2026-10-18 that tree had 122 modified and 100 untracked files on top of upstream commit `16b99f28`,
and the upstream repository `savin8878/testing` does not contain them. Publish them to your own
repository first, otherwise a clone elsewhere will lack everything this manual is about.

On the original machine:

```bash
git checkout -b business-platform
git add -A
git status --short | grep -E '(^|/)\.env($|\.)|infra/frappe/state/|^data/' || echo "no secrets staged"
git commit -m "Business platform: ERPNext bridge, business team, Operator and autonomy"
git remote add mine https://github.com/<your-account>/savingroup.git
git push -u mine business-platform
```

The grep must print nothing but "no secrets staged": `.env`, `infra/frappe/.env`,
`infra/frappe/state/` and `data/` are gitignored and must stay out of the commit. Without GitHub,
`git bundle create savingroup.bundle business-platform` produces one file to copy.

On the new machine:

```bash
git config --global core.autocrlf false
git clone https://github.com/<your-account>/savingroup.git
cd savingroup
git checkout business-platform
```

`core.autocrlf false` matters on Windows: the bot computer scripts must keep LF line endings or
the computer hangs on boot.

## 4. Configure Savingroup

Create `.env` from the example and fill the values below. Everything else can stay as shipped.

```bash
cp .env.example .env
node -e "for (const n of ['POSTGRES_PASSWORD(16)','BETTER_AUTH_SECRET','ENCRYPTION_KEY','SCREEN_PROXY_SECRET','SANDBOX_SUPERVISOR_TOKEN']) console.log(n, require('crypto').randomBytes(n.includes('16') ? 16 : 32).toString('hex'))"
```

| Setting | Value | Why |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | the 16-byte hex value | Password of the Compose Postgres role; applied on the volume's first start only |
| `DATABASE_URL` | `postgres://savingroup:<POSTGRES_PASSWORD>@127.0.0.1:5433/savingroup` | How the host-run API, worker and CLIs reach Postgres |
| `BETTER_AUTH_SECRET`, `SCREEN_PROXY_SECRET`, `SANDBOX_SUPERVISOR_TOKEN` | three distinct 32-byte hex values | Session signing, screen streaming, supervisor access |
| `ENCRYPTION_KEY` | a 32-byte hex value (64 characters) | Seals stored credentials: model keys, the site's gateway key, bot secrets. Back it up; losing it means reconnecting everything |
| `BETTER_AUTH_URL`, `WEB_ORIGIN` | `http://127.0.0.1:5173` | The web origin cookies and CORS trust |
| `API_URL`, `API_HOST` | `http://127.0.0.1:3100`, `127.0.0.1` | Where the API listens |
| `SIGNUPS_ENABLED` | `true` for the first start | Read once, at the API's first start; later changes happen in the app's settings |
| `SANDBOX_PROVIDER` | `docker` | Local bot computers |
| `SANDBOX_CONTROL_VIA_LOOPBACK` | `true` on Docker Desktop (Windows, macOS); unset on Linux Docker Engine | Container IPs are unreachable from a Docker Desktop host |
| `BUSINESS_APPS_ENABLED` | `true` | Turns on the CRM, ERP and site-administration tools for API and worker |
| `BUSINESS_WEBHOOK_BASE_URL` | `http://host.docker.internal:3100` on Docker Desktop | Where the site posts events; see the Linux note in section 11 |
| `TELEPHONY_PROVIDER` | `emulator` or `none` | Phone calls are simulated or off; `livekit` needs the extra values in the example file |
| `OPENROUTER_API_KEY`, `PI_DEFAULT_PROVIDER`, `PI_DEFAULT_MODEL` | optional | A deployment-wide model. Leave the key empty to connect a model per user during onboarding instead |
| `EMAIL_EMULATOR` | `1` for local use | Prints password-reset links to the API console instead of sending mail |

Never commit `.env`. Keep a copy of it, together with `infra/frappe/.env` and the
`infra/frappe/state` folder, in your password manager or an encrypted backup.

## 5. Start Savingroup

1. Start Docker (Docker Desktop, or `sudo systemctl start docker` on Linux) and wait until
   `docker info` answers.
2. Start Postgres, published on loopback so the host-run services can reach it:

   ```bash
   docker compose --env-file .env -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.postgres-host.yml up postgres -d
   docker update --restart unless-stopped compose-postgres-1
   ```

   The second command makes it come back with Docker after a reboot.
3. Install dependencies and prepare the database:

   ```bash
   pnpm install --frozen-lockfile
   pnpm db:generate
   pnpm db:migrate
   ```

   `pnpm db:migrate` applies every migration (111 on 2026-10-18) and prints "Database schema is up to date" when rerun.
4. Provide the bot computer image. Either build it (10 to 20 minutes the first time) or pull the
   published one, which is identical for this fork:

   ```bash
   pnpm sandbox:build
   # or
   docker pull ghcr.io/savin8878/testing/computer:edge && docker tag ghcr.io/savin8878/testing/computer:edge savingroup/computer:local
   ```

5. Start the stack and keep the terminal open:

   ```bash
   pnpm dev
   ```

   This runs the API, worker, web app, sandbox supervisor and phone agent with file watching. On
   Windows the phone agent exits with an onnxruntime DLL error; that is expected and harmless with
   `TELEPHONY_PROVIDER=emulator` or `none`.
6. Verify:

   ```bash
   curl http://127.0.0.1:3100/internal/health
   curl http://127.0.0.1:7091/health
   ```

   The first must contain `"ok":true`, `"runtime":"pi"`, `"sandbox":"docker"`, `"jobs":"graphile"`
   and `"realtime":"postgres"`; the second `"ok":true` with the computer image. Then open
   http://127.0.0.1:5173.

Production alternative for a single server: run everything in Docker from your checkout with
`docker compose --env-file .env -f infra/compose/docker-compose.yml up --build -d`. That builds the
app image from your code, keeps Postgres internal, publishes the web app on 127.0.0.1:5173 and
expects a TLS proxy in front; leave `SANDBOX_CONTROL_VIA_LOOPBACK` unset in that mode. Stop it with
`docker compose --env-file .env -f infra/compose/docker-compose.yml down` and never with `-v` or
`pnpm compose:down`, which delete the database volume. Public URLs, SMTP and signup allowlists are
covered in [self-host.md](./self-host.md). For a public server with HTTPS and the ERPNext site,
use section 14 instead.

## 6. First login and what a fresh account contains

Open http://127.0.0.1:5173 and create an account. The first account becomes the deployment owner.
Onboarding then asks for a model (skip if `OPENROUTER_API_KEY` is set deployment-wide) and creates
your first bot under any name you give it.

That is all a fresh account has: one Personal space, that one bot, no business team, no Operator,
and no ERP connection. Sections 7 and 8 add the rest, and both are per deployment, not per machine
image: a second person who signs up gets the same empty start, and the team is created for them
by running section 8's command with their email.

If you want every new account to receive the business team automatically at signup, that is a
small change to the onboarding completion in the API rather than a setup step; ask for it.

## 7. The ERPNext + Frappe CRM stack

1. Configure the stack:

   ```bash
   cp infra/frappe/.env.example infra/frappe/.env
   ```

   Set `MARIADB_ROOT_PASSWORD` and `SITE_ADMIN_PASSWORD` to two new random values,
   `SITE_ADMIN_EMAIL` to yours, `BLUEPRINT` to `india-smb` (India, INR, GST, India Compliance) or
   `generic`, `COMPANY_NAME` and `COMPANY_ABBR` to your company, and `GATEWAY_ADMIN=1` so the
   Operator can administer the site. Keep `SITE_NAME=frontend`, `FRAPPE_HTTP_PORT=8090` and
   `GATEWAY_USER_EMAIL=savingroup-gateway@example.com` unless you have a reason to change them.
2. Build the image (10 to 25 minutes the first time; it downloads `frappe/erpnext:v16.51.1` and
   builds the Frappe CRM frontend):

   ```bash
   docker build -f infra/frappe/Containerfile -t savingroup/frappe-business:16.51.1 infra/frappe
   ```

3. Start the stack and wait until `docker compose -f infra/frappe/compose.yaml --env-file infra/frappe/.env ps` shows `db` healthy and the other services up:

   ```bash
   docker compose -f infra/frappe/compose.yaml --env-file infra/frappe/.env up -d
   ```

4. Provision the site (10 to 20 minutes; safe to rerun if interrupted):

   ```bash
   docker compose -f infra/frappe/compose.yaml --env-file infra/frappe/.env --profile bootstrap run --rm bootstrap
   ```

   This creates the site, installs ERPNext, Frappe CRM, India Compliance (india-smb) and the
   Savingroup bridge, completes the setup wizard with your company, applies the gateway defaults,
   creates the gateway user with an API key pair, and with `GATEWAY_ADMIN=1` grants it the
   administrative roles. The credentials land in `infra/frappe/state/frontend.gateway.json`
   (gitignored, keep it private). Rerunning rotates the secret, so reconnect Savingroup afterwards
   (section 8, step 1).
5. Verify:

   ```bash
   curl http://localhost:8090/api/method/ping
   ```

   must return `{"message":"pong"}`. The desk at http://localhost:8090 accepts `Administrator`
   with `SITE_ADMIN_PASSWORD`. With the key pair from the state file,
   `curl -H "Authorization: token <api_key>:<api_secret>" http://localhost:8090/api/method/savingroup_business_bridge.api.ping`
   lists the installed apps, the company and `"admin": true`.
6. Brand the sign-in pages: in the desk open **Website Settings** and set App Name, App Logo,
   Favicon and Copyright. The site's sign-in pages (`/login`, `/update-password`, and `/crm` or
   `/desk` when signed out) use them; without a logo they show the company name and its initial.
   People get accounts by invitation: add them as a User with **Send Welcome Email**, or invite
   them from Frappe CRM's settings, and the email link opens **Set up your account**. To let
   people create accounts themselves, clear **Disable Signup** in Website Settings; that needs
   outgoing email, because the password is chosen from the emailed link.

If the site was provisioned with `GATEWAY_ADMIN=0`, grant the roles later with one command (one
line in any shell), and revoke them with `revoke_admin` in the same form:

```bash
docker compose -f infra/frappe/compose.yaml --env-file infra/frappe/.env exec backend bench --site frontend execute savingroup_business_bridge.setup.grant_admin --kwargs "{'email': 'savingroup-gateway@example.com'}"
```

## 8. Connect Savingroup to the site and create the team

1. Connect the owner's organization to the site. The command stores the gateway key sealed with
   `ENCRYPTION_KEY`, pings the bridge, checks the apps and the company, tells the site where to post
   events, and marks the environment active. One site serves one organization; every space in it
   then reads and writes on the site.

   ```bash
   pnpm --filter @savingroup/api business:connect -- --email <owner email> --site-url http://localhost:8090 --state-file infra/frappe/state/frontend.gateway.json
   ```

   The same can be done in the app under ERP → Overview → Connect Savingroup ERP with the values from the
   state file.
2. Create the Business space, the four specialists and the Operator, and grant autonomy. This is
   the single human involvement: afterwards every consequential tool runs without a pause, except
   deleting site documents unless you add `--allow-delete`.

   ```bash
   pnpm --filter @savingroup/business team -- --email <owner email> --space-name Business --sync --autonomous
   ```

   The output lists the five bots and the autonomy grant. Variants: `--operator` without
   `--autonomous` creates the Operator but keeps every consequential action behind approval; neither
   flag creates only the four specialists. Rerun with `--sync` whenever the role definitions or the
   tool list change.
3. Optional demo data. Before a site is connected,
   `pnpm --filter @savingroup/business demo -- --email <owner email>` seeds companies, products, leads,
   a deal and an order into the prototype tables of the person's default space. After connecting,
   `pnpm --filter @savingroup/api business:migrate -- --email <owner email>` shows what would move to
   the site and `--apply --hsn <6-digit code>` moves it (GST sites require an HSN code on items).
4. Open the Business space in the app. It holds Operator, Sales Executive, Operations, Finance and
   Business Analyst. Give the Operator its first mission; it can set up masters, workflow rules,
   notifications and assignment rules on the site, spawn further specialists, message the team and
   schedule its own recurring jobs.

### Operating modes

The same command selects the mode; rerun it with `--sync` and the flags of the mode you want.
Every mode keeps reads free, always asks before `create_space` and before a bot rewrites its own
instructions, and needs the site-side admin grant (section 7) before the `admin_*` tools work.

| Mode | Command flags | Bots | What pauses for a person |
| --- | --- | --- | --- |
| Supervised | `--sync` | Sales Executive, Operations, Finance, Business Analyst | Every consequential tool: stock adjustments, order approve, confirm and cancel, invoice issue, payment recording, and every `admin_*` write |
| Supervised with Operator | `--sync --operator` | the four plus Operator | The same list; the Operator plans and reads freely, but each consequential write asks |
| Autonomous | `--sync --autonomous` | the four plus Operator | Only `admin_document_delete` |
| Fully autonomous | `--sync --autonomous --allow-delete` | the four plus Operator | Nothing |

Switching: run the command again with the new flags. Tightening works the same way, because a
pause rule always wins over an allow rule for the same tool: rerunning without `--autonomous`
restores the pauses even though the allow rules stay listed; remove them under Account settings →
Action confirmations (while in the Business space) if you want the list clean. The site-side
grant is separate from the mode: `revoke_admin` (section 7) turns the `admin_*` tools off in every
mode.

### Approvals and retries while the bots work

- A gated tool shows a card in the bot's thread with **Allow once**, **Always allow** and
  **Deny**. Always allow writes an allow rule for that tool in the space, which is what the
  autonomy grant does for the whole list at once.
- A write the site rejects (a validation rule, a link to another document, a missing permission)
  is recorded as failed. Repeating the identical call in the same run replays that failure instead
  of reaching the site, because the per-run idempotency key is derived from the run, the tool and
  the arguments. Fix the cause, then send a new message: the new run gets a new key, and a gated
  tool asks once more.
- A timeout is an unknown outcome, not a failure. Savingroup reconciles it with the site before the
  same key can run again; wait for the result instead of retrying.
- Deleting on the site follows Frappe's link rules: a document that another document links to
  cannot be deleted until that link is cleared or the linking document goes first. A converted
  lead and its deal point at each other through the deal's `lead` field, so clear it on the deal
  before deleting either.
- Where to look afterwards: the thread itself; ERP → Overview in the app for the environment's
  status and its Check; the site's Savingroup Operation list for every operation and its outcome; and
  Account settings → Action confirmations for the rules in force.

## 9. Verification checklist

| Check | Command or place | Expected |
| --- | --- | --- |
| API healthy | `curl http://127.0.0.1:3100/internal/health` | `ok:true`, `runtime:"pi"`, `sandbox:"docker"`, `jobs:"graphile"`, `realtime:"postgres"` |
| Supervisor healthy | `curl http://127.0.0.1:7091/health` | `ok:true` and `image:"savingroup/computer:local"` |
| Web app | http://127.0.0.1:5173 | Sign-in page, then your spaces after login |
| Worker running | the `pnpm dev` terminal | `worker ready` and `Worker connected and looking for jobs` |
| Bot computer | a bot's Agent computer pane | reaches `running` and shows a desktop |
| Site up | `curl http://localhost:8090/api/method/ping` | `{"message":"pong"}` |
| Sign-in page | http://localhost:8090/crm while signed out | your organization's sign-in page; for a site named Acme the subtitle reads "Continue to Acme CRM" |
| Bridge admin grant | bridge ping with the gateway token | `"admin": true` |
| Environment connected | ERP → Overview in the app | status active, site URL shown |
| Team present | Business space bot list | Operator plus the four specialists |
| Autonomy | the team command's output, or Account settings → Action confirmations while in the Business space | always-allow rules for the consequential tools; `admin_document_delete` still asks unless `--allow-delete` was used |
| Operator can administer | ask the Operator to describe the `Notification` doctype | a field list, not `permission_denied` |

## 10. Day-2 operations

Start order after a reboot: Docker first; Postgres and the ERPNext containers restart with it
(the Postgres container because of the restart policy set in section 5, the ERPNext services
because Docker Desktop restarts them); then `pnpm dev`.

Stop without losing data: Ctrl+C in the `pnpm dev` terminal, then
`docker compose -f infra/frappe/compose.yaml --env-file infra/frappe/.env stop` and
`docker compose --env-file .env -f infra/compose/docker-compose.yml stop postgres`. Never use
`down -v` or `pnpm compose:down` unless you mean to delete every database.

Logs: the `pnpm dev` terminal for Savingroup;
`docker compose -f infra/frappe/compose.yaml --env-file infra/frappe/.env logs -f backend queue-short`
for the site; failed event deliveries appear in the site's Error Log.

Backups, all three together, plus `.env`:

```bash
mkdir -p backups
docker exec compose-postgres-1 pg_dump -U savingroup -Fc savingroup > backups/savingroup.dump
docker compose -f infra/frappe/compose.yaml --env-file infra/frappe/.env exec backend bench --site frontend backup --with-files
docker cp savingroup-frappe-backend-1:/home/frappe/frappe-bench/sites/frontend/private/backups backups/frappe
tar czf backups/data.tgz data
```

Restore: `pg_restore -U savingroup -d savingroup --clean` into a fresh Postgres,
`bench --site frontend restore <sql.gz> --with-public-files … --with-private-files …` into a fresh
site, unpack `data`, and reuse the same `.env` (the `ENCRYPTION_KEY` must match the dump).

Upgrading your fork: `git pull`, `pnpm install --frozen-lockfile`, `pnpm db:migrate`, restart
`pnpm dev`. A change under `infra/frappe/apps` needs the image rebuilt (section 7 step 2) and the
application containers recreated:

```bash
docker compose -f infra/frappe/compose.yaml --env-file infra/frappe/.env up -d --force-recreate --no-deps backend frontend websocket queue-short queue-long scheduler
```

followed by `bench --site frontend migrate` through `docker compose … exec backend` when doctypes
changed. After any change to the bot tool list, rerun the team command with `--sync` so the
specialists' restrictions cover the new tools.

Reverting autonomy: rerun the team command without `--autonomous` (the modes are in section 8),
or remove the always-allow rules under Account settings → Action confirmations while in the
Business space, and run `revoke_admin` on the site (section 7). Disabling the site connection: ERP → Overview → Disable
switches the organization back to the built-in tables without deleting anything.

Full reset: stop everything, run both Compose stacks with `down -v`, delete the `data` folder, and
start again at section 5.

## 11. Platform notes

Windows: use Docker Desktop with the WSL 2 backend and keep the checkout on the Windows drive or,
for better speed, inside WSL. Type commands on one line in PowerShell; a trailing backslash is not a
line continuation there. Set `SANDBOX_CONTROL_VIA_LOOPBACK=true`. Start Docker Desktop before
`pnpm dev`, and leave the `pnpm dev` window open; closing it stops the app.

macOS: Docker Desktop, `SANDBOX_CONTROL_VIA_LOOPBACK=true`, otherwise identical. The phone agent
runs normally.

Linux workstation or server: Docker Engine with the Compose plugin; leave
`SANDBOX_CONTROL_VIA_LOOPBACK` unset. For a public server, section 14 deploys everything in
Docker and handles the points below. `host.docker.internal` does not exist by default, so the site
cannot post events to a loopback-bound API: either run the production Compose stack and set
`BUSINESS_WEBHOOK_BASE_URL` to the public HTTPS origin, or add
`extra_hosts: ["host.docker.internal:host-gateway"]` to the Frappe services and bind the API to an
address the containers can reach behind your firewall. Bots keep working without events; only the
live refresh from site-side changes depends on them. For a public server put TLS in front of
port 5173, set `BETTER_AUTH_URL`, `WEB_ORIGIN` and `API_URL` to that HTTPS origin, configure SMTP
and a signup allowlist before exposing it, and consider `SANDBOX_COMPUTER_EGRESS=restricted`; the
details are in [self-host.md](./self-host.md).

## 12. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `failed to connect to the docker API` | Docker is not running | Start Docker Desktop or the Docker service and retry |
| `max clients reached in session mode (EMAXCONNSESSION)` or very slow pages | `DATABASE_URL` points at a hosted connection pooler with a small client cap | Use the local Compose Postgres from section 5 |
| `worker startup failed` in `pnpm dev` | The worker could not open its database connections | Fix `DATABASE_URL`, then save any file under `apps/worker/src` to restart it |
| Health shows `"sandbox":"none"` | `SANDBOX_SUPERVISOR_TOKEN` is empty or the supervisor is down | Set the token, restart `pnpm dev` |
| The computer pane stays on "booting" (Windows) | CRLF line endings in the computer image scripts | `git config core.autocrlf false`, `git add --renormalize . && git checkout -- .`, rebuild with `pnpm sandbox:build` |
| `A dynamic link library (DLL) initialization routine failed` from the phone agent | onnxruntime cannot load on this Windows machine | Ignore with `TELEPHONY_PROVIDER=emulator` or `none` |
| `bench : The term 'bench' is not recognized` | A multi-line command was pasted into PowerShell | Type the command on one line |
| `unable to prepare context: path "infra/frappe" not found` | `docker build` ran from the wrong directory | Run it from the repository root or with absolute paths |
| Operator's `admin_*` tools answer `permission_denied` | The gateway user lacks the administrative roles | Run `grant_admin` (section 7) |
| Bridge answers `Unknown query admin_doctype` | The containers still run an older image | Rebuild the image and force-recreate the application containers (section 10) |
| The site's sign-in page still looks like stock Frappe | The containers run an older image, or the page cache is stale | Rebuild and force-recreate (section 10), then `docker compose -f infra/frappe/compose.yaml --env-file infra/frappe/.env exec backend bench --site frontend clear-website-cache` |
| `erp_product_search` returns nothing although items exist | The items are disabled | Search with `includeInactive`, or set them active again with `erp_product_update` |
| Item creation fails with an HSN error | GST sites require an HSN or SAC code of at least six digits | Pass `hsnCode` (or `--hsn` to the migrate command) |
| Prisma `P1001` or TLS handshake timeouts against a remote database | Slow connection setup | Append `connect_timeout=60&pool_timeout=60` to `DATABASE_URL` for that command |
| Site events never arrive | The site cannot reach `BUSINESS_WEBHOOK_BASE_URL` | Use `http://host.docker.internal:3100` on Docker Desktop; see section 11 for Linux |

## 13. Quick reference

Every command in order, for a fresh machine. Replace the placeholders.

```bash
# code
git config --global core.autocrlf false
git clone https://github.com/<your-account>/savingroup.git && cd savingroup && git checkout business-platform

# Savingroup configuration (edit .env afterwards: secrets, DATABASE_URL, BUSINESS_APPS_ENABLED=true, loopback flag on Docker Desktop)
cp .env.example .env

# databases and services
docker compose --env-file .env -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.postgres-host.yml up postgres -d
docker update --restart unless-stopped compose-postgres-1
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
docker pull ghcr.io/savin8878/testing/computer:edge && docker tag ghcr.io/savin8878/testing/computer:edge savingroup/computer:local
pnpm dev

# first login: http://127.0.0.1:5173 (create the owner account, connect a model, name the first bot)

# ERPNext + Frappe CRM (edit infra/frappe/.env first; GATEWAY_ADMIN=1)
cp infra/frappe/.env.example infra/frappe/.env
docker build -f infra/frappe/Containerfile -t savingroup/frappe-business:16.51.1 infra/frappe
docker compose -f infra/frappe/compose.yaml --env-file infra/frappe/.env up -d
docker compose -f infra/frappe/compose.yaml --env-file infra/frappe/.env --profile bootstrap run --rm bootstrap
curl http://localhost:8090/api/method/ping

# connect the site and create the team with the Operator (the one-time grant)
pnpm --filter @savingroup/api business:connect -- --email <owner email> --site-url http://localhost:8090 --state-file infra/frappe/state/frontend.gateway.json
pnpm --filter @savingroup/business team -- --email <owner email> --space-name Business --sync --autonomous
#   other modes (rerun to switch): supervised = drop --autonomous | Operator but supervised = --operator | deletes unattended too = add --allow-delete

# verification
curl http://127.0.0.1:3100/internal/health
curl http://127.0.0.1:7091/health
```

Reference values of the verified setup: Business space named "Business"; blueprint `india-smb`;
company "Savingroup Demo Pvt Ltd"; gateway user `savingroup-gateway@example.com`; images
`savingroup/frappe-business:16.51.1` and `savingroup/computer:local`; containers `compose-postgres-1` and
`savingroup-frappe-*`.

## 14. Deploy everything to a server with Docker

One Linux server runs both stacks in Docker: Savingroup (Postgres, API, worker, web app, sandbox
supervisor, bot computers, and Caddy with automatic HTTPS) and the ERPNext + Frappe CRM site.
Caddy serves two hostnames, the app (`SAVINGROUP_HOST`) and the site (`FRAPPE_HOST`); Postgres,
MariaDB, the supervisor and the site's nginx stay on private Docker networks. Container platforms
such as Railway cannot host this layout, because bot computers need the Docker socket and the
services share volumes.

| Piece | File |
| --- | --- |
| Savingroup production stack | `infra/compose/docker-compose.prod.yml` |
| Docker bot computers on it | `infra/compose/docker-compose.prod.docker.yml` |
| The site's hostname, events and settings on it | `infra/compose/docker-compose.prod.business.yml`, `infra/compose/Caddyfile.business` |
| The site in production (restarts, loopback port, shared network) | `infra/frappe/compose.prod.yaml` |
| One command for all of it | `infra/compose/deploy-full.sh` |
| Moving this machine's data | `infra/compose/export-local.sh` |

1. Server: Ubuntu 24.04 LTS with 4 vCPU, 16 GB RAM and 80 GB SSD (8 GB runs a light load: the
   site idles at about 2 GB and each active bot computer may use up to 2 GB). Create two DNS `A`
   records, for example `app.example.com` and `erp.example.com`, pointing at the server, and allow
   TCP 22, 80 and 443 plus UDP 443.
2. Docker and the code. Publish your working tree first (section 3), then on the server:

   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo git clone https://github.com/<your-account>/savingroup.git /srv/savingroup
   cd /srv/savingroup && sudo git checkout business-platform
   sudo cp infra/compose/docker-daemon.json /etc/docker/daemon.json && sudo systemctl restart docker
   ```

   Optionally harden the host as described in [self-host.md](./self-host.md) (`harden-host.sh`).
3. `.env`. To move this machine's data (step 6), start from this machine's `.env`, because the
   server must have the same `ENCRYPTION_KEY`; for a fresh install start from `.env.example` with
   the section 4 values. Then set:

   | Setting | Value |
   | --- | --- |
   | `SAVINGROUP_HOST`, `FRAPPE_HOST` | `app.example.com`, `erp.example.com` |
   | `BETTER_AUTH_URL`, `WEB_ORIGIN`, `API_URL` | `https://app.example.com`, all three |
   | `NODE_ENV` | `production` |
   | `SIGNUP_ALLOWLIST` | the owner's email (comma-separated for more); applied on every start |
   | `SMTP_URL`, `EMAIL_FROM` | your mail server, so people can verify addresses and reset passwords; leave `EMAIL_EMULATOR` empty |
   | `POSTGRES_PASSWORD` | a new 16-byte hex value |
   | `SANDBOX_CONTROL_VIA_LOOPBACK`, `BUSINESS_WEBHOOK_BASE_URL` | delete both lines; the overlays set the server values |

   `DATABASE_URL`, `DATA_DIR`, `API_HOST` and `SANDBOX_SUPERVISOR_URL` are set by Compose inside
   the containers, so their values in `.env` do not matter on the server. `deploy-full.sh` refuses
   to start while the three origins differ from `https://SAVINGROUP_HOST` or the allowlist is empty
   (an empty list lets anyone who finds the address sign up and run bot computers on the server).
   Run `chmod 600 .env`.
4. `infra/frappe/.env`: copy this machine's file, or create it as in section 7 step 1 with
   `GATEWAY_ADMIN=1`. If `172.31.250.0/24` is already used on the server, set
   `SAVINGROUP_BUSINESS_SUBNET` there to a free private /24.
5. Deploy:

   ```bash
   sudo bash infra/compose/deploy-full.sh up
   ```

   The first run builds the site image (10 to 25 minutes), provisions the site (10 to 20 minutes)
   and builds the app and bot computer images. It ends by checking both public addresses; Caddy
   requests the certificates once DNS points at the server. Rerunning `up` deploys a new revision
   and changes nothing that is already in place.
6. Accounts and data, one of:
   - **Fresh install.** Open `https://app.example.com`, create the owner account with an
     allowlisted email and connect a model, then connect the site and create the team (section 8):

     ```bash
     sudo bash infra/compose/deploy-full.sh connect <owner email>
     sudo bash infra/compose/deploy-full.sh app exec api pnpm --filter @savingroup/business team -- --email <owner email> --space-name Business --sync --autonomous
     ```

   - **Move this machine's data** (account, bots, spaces, approvals, bot computer homes, the site's
     records and files). Stop `pnpm dev`, keep Docker running, and export from the repository
     root. In PowerShell:

     ```powershell
     & "$env:ProgramFiles\Git\bin\bash.exe" infra/compose/export-local.sh
     scp -r backups/migration-<time> <user>@<server>:~/
     ```

     Then on the server:

     ```bash
     chmod 700 ~/migration-<time>
     sudo bash infra/compose/deploy-full.sh restore ~/migration-<time> <owner email>
     rm -rf ~/migration-<time>
     ```

     The restore replaces the server's Savingroup database and the site with the exported ones,
     restores the site's encryption key and gateway key pair, and reconnects the organization to
     `https://erp.example.com`. Sign in with your existing password; the site's `Administrator`
     password is the one from this machine. Delete `backups/migration-<time>` here as well: it
     holds sealed credentials and business data.
7. Verify with `sudo bash infra/compose/deploy-full.sh status`, then open ERP → Overview in the
   app (the connection is active) and give the Operator a task.

Day-2 on the server, from `/srv/savingroup`:

- **Update:** `sudo git pull && sudo bash infra/compose/deploy-full.sh up`. After a change under
  `infra/frappe/apps`, run `sudo REBUILD_FRAPPE=1 bash infra/compose/deploy-full.sh up` and then
  `sudo bash infra/compose/deploy-full.sh site exec backend bench --site frontend migrate`.
- **Logs:** `sudo bash infra/compose/deploy-full.sh app logs -f api worker` and
  `sudo bash infra/compose/deploy-full.sh site logs -f backend queue-short`.
- **Backups:** `sudo SAVINGROUP_DEPLOY_DIR=/srv/savingroup bash infra/compose/backup-prod.sh` saves the
  Savingroup database and bot homes under `/var/backups/savingroup` (`infra/systemd` has a daily timer);
  `sudo bash infra/compose/deploy-full.sh site exec backend bench --site frontend backup --with-files`
  saves the site into its `sites` volume. Copy both off the server, together with `.env`,
  `infra/frappe/.env` and `infra/frappe/state`.
- **Stop:** `deploy-full.sh app stop` and `deploy-full.sh site stop`. Never `down -v`, which
  deletes the databases.
