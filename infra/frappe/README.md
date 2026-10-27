# Business environment (ERPNext + Frappe CRM)

The Frappe site behind an organization's CRM OS and ERP OS. One stack per deployment
for development and single-server production; one site per organization inside it.

Everything is pinned: the ERPNext image by digest, Frappe CRM and India Compliance by
release tag, MariaDB and Redis by digest. See `docs/business-platform/dependencies.md`.

## 1. Build the image

```bash
docker build -f infra/frappe/Containerfile -t savingroup/frappe-business:16.51.1 infra/frappe
```

The build starts from `frappe/erpnext:v16.51.1`, adds Frappe CRM v1.88.0, India
Compliance v16.10.1 and the Savingroup bridge app (`infra/frappe/apps/savingroup_business_bridge`),
and builds their assets into the directory the image's entrypoint links at start. Expect
10 to 25 minutes the first time.

## 2. Configure and start

```bash
cp infra/frappe/.env.example infra/frappe/.env   # then set real passwords and the company
docker compose -f infra/frappe/compose.yaml --env-file infra/frappe/.env up -d
```

`infra/frappe/.env` is gitignored. There are no default passwords: the compose file
refuses to start without `MARIADB_ROOT_PASSWORD`, `SITE_ADMIN_PASSWORD`, `COMPANY_NAME`
and `COMPANY_ABBR`.

The site answers on `http://localhost:${FRAPPE_HTTP_PORT}` (8090 by default).

## 3. Provision the site

```bash
docker compose -f infra/frappe/compose.yaml --env-file infra/frappe/.env --profile bootstrap run --rm bootstrap
```

`scripts/bootstrap-site.sh` is idempotent. It creates the site with ERPNext, installs the
blueprint's apps (`blueprints/india-smb.json` or `generic.json`), completes the setup
wizard with the blueprint's country, currency, timezone, chart and fiscal year, applies
the defaults the gateway relies on (customers named by name, a selling price list, the
negative-stock rule), and creates the gateway user with standard roles and an API key
pair. The credentials land in `infra/frappe/state/<site>.gateway.json` (gitignored,
mode 600). Re-running rotates the secret.

## 4. Connect Savingroup

With `BUSINESS_APPS_ENABLED=true` on the API and worker, open ERP → Overview in Savingroup
and use **Connect Savingroup ERP**: site URL, the gateway key pair from the state file, a new
random event signing secret, the blueprint, company name and abbreviation, country and
currency. Savingroup stores the credentials sealed, pings the bridge, checks the apps and
the company, tells the site where to deliver events, and only then marks the
environment active. From that moment every space of the organization reads and writes
on the site; **Disable** switches back to the built-in tables without deleting anything.

For the site to reach the API from inside Docker Desktop, set
`BUSINESS_WEBHOOK_BASE_URL=http://host.docker.internal:3100` on the API before
connecting (it defaults to `API_URL`).

## Autonomous operation

The business team can run without a person in the loop once the owner grants it. Two
steps, each run once:

1. On the site, give the gateway user the administrative roles (System Manager and the
   functional manager roles). Either provision with `GATEWAY_ADMIN=1` in `infra/frappe/.env`,
   or on a running site:

   ```bash
   docker compose -f infra/frappe/compose.yaml --env-file infra/frappe/.env exec backend bench --site frontend execute savingroup_business_bridge.setup.grant_admin --kwargs "{'email': 'savingroup-gateway@example.com'}"
   ```

   One line on purpose: it works unchanged in bash and in PowerShell. `revoke_admin` with the
   same arguments returns the user to the standard gateway roles.
   The bridge's `ping` reports `admin: true` once the grant is in place.

2. In Savingroup, create the Operator and lift the approval pauses in the space:

   ```bash
   pnpm --filter @savingroup/business team -- --email <owner> --space-name Business --sync --autonomous
   ```

   This adds an **Operator** bot that holds every CRM, ERP and site-administration tool,
   keeps the specialists restricted to their roles, and replaces the require-approval rules
   for the consequential tools with always-allow rules. Deleting site documents stays gated
   unless `--allow-delete` is passed. Rerunning the command without `--autonomous` restores the
   pauses (a pause rule beats an allow rule for the same tool). The four modes, the approval
   cards and the retry behaviour are described under "Operating modes" in
   `docs/setup-manual.md`.

The Operator then works through the bridge's `admin.*` actions: describe any doctype, list
and read documents, insert, update, submit and cancel them, and call whitelisted methods.
Identity and permission doctypes (User, Role, User Permission, …), stored-credential
doctypes (Email Account, OAuth, …), code execution (Server Script, Client Script, System
Console) and schema changes (DocType) are refused by the bridge whatever the roles say, and
every write is recorded as a Savingroup Operation like any other action.

## The Savingroup workspace on the site

Signed-in desk users see a **Savingroup** page in the sidebar (`/app/savingroup`): live number
cards (open leads and deals, won value, active items, confirmed orders, outstanding
receivables, gateway operations and failures), shortcuts to the ledger, bridge settings,
Frappe CRM and the main ERPNext lists, and link cards for the gateway, CRM, selling, stock
and compliance masters. The bridge creates it on install and refreshes it on migrate
(`savingroup_business_bridge.workspace.ensure_workspace`).

## Sign-in pages

The bridge serves the site's sign-in pages in place of Frappe's: `/login` (sign in, email link,
forgot password, create account, two-step verification), `/update-password` (the first password
from an invitation, a reset, or a change while signed in) and the message page (expired links,
"Not Permitted"). Frappe still answers every request they make, so rate limits, two-factor,
social and LDAP sign-in behave as the site configures them. The pages show the organization's
name, logo and copyright from Website Settings, falling back to the default company and its logo,
and follow the system's light or dark appearance. A guest who opens `/crm`, or any other page that
needs a sign-in, goes straight to `/login` and returns there afterwards.

Self sign-up follows Website Settings → **Disable Signup**; while it is set, the page explains
that accounts come by invitation. A self sign-up creates a website user and needs outgoing email,
because the password is chosen from the emailed link. The templates and styles are in
`savingroup_business_bridge/www/` and `savingroup_business_bridge/templates/savingroup_auth/`; the image
carries them, so rebuild it after changing them.

## India blueprint notes

- India Compliance requires an HSN/SAC code on every item, at least six digits by default
  (GST Settings → `min_hsn_digits`). The gateway passes `hsnCode`; the ERP product form
  shows the field when the organization's environment uses the `india-smb` blueprint.
- The company is created without a GSTIN. Set it in ERPNext (Company → GST details) before
  issuing GST invoices; statutory configuration still needs a qualified review.

## Operations

- **Health**: `GET /api/method/ping` on the site; the bridge's `ping` method (as the
  gateway user) reports apps, companies and protocol version. Savingroup's **Check** button
  runs the same verification and records the result on the environment.
- **Logs**: `docker compose -f infra/frappe/compose.yaml logs backend queue-short`; bench
  logs are in the `logs` volume. Failed event deliveries appear in the site's Error Log.
- **Backups**: `docker compose … exec backend bench --site <site> backup --with-files`
  writes to `sites/<site>/private/backups` inside the `sites` volume. Copy that volume
  off the host (restic or any object store). Restore with `bench --site <site> restore
  <sql.gz> --with-public-files … --with-private-files …` after creating an empty site.
  Test a restore on a scratch stack before relying on it.
- **Upgrades**: bump the tags and digests in `Containerfile`, rebuild, `docker compose up
  -d`, then `docker compose … exec backend bench --site <site> migrate`. The bridge's
  `after_migrate` re-applies custom fields. Run `bench --site <site> execute
  savingroup_business_bridge.api.ping` and Savingroup's **Check** afterwards.
- **Resource limits**: the stack idles around 2 GB of RAM (MariaDB, gunicorn, two
  workers, scheduler, websocket, nginx) and needs about 4 GB during image builds. Add
  `deploy.resources.limits` per service for production hosts.
- **Monitoring**: not wired in this slice. The intended path is Prometheus scraping
  `/api/method/frappe.monitor…` style exporters plus container metrics, and Grafana on
  top; see `docs/business-platform/dependencies.md`.

## Security notes

- The gateway user has Sales, Sales Master, Stock, Item and Accounts roles plus the bridge role. It is
  not System Manager and never Administrator. Savingroup never receives the database password
  or the Administrator password; bots never receive any site credential.
- Events are signed per environment; replays are dropped by delivery id.
- The compose network is private; only the nginx front door is published.
