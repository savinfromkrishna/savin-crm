#!/usr/bin/env bash
# Deploy the whole product on one Linux host with Docker: the Savingroup production stack with
# local Docker bot computers, and the ERPNext + Frappe CRM site served by the same Caddy.
#
#   bash infra/compose/deploy-full.sh up                              build, start or update everything
#   bash infra/compose/deploy-full.sh connect <owner-email>           connect the owner's organization to the site
#   bash infra/compose/deploy-full.sh restore <export-dir> <owner-email>
#                                                                     load a package from export-local.sh
#   bash infra/compose/deploy-full.sh status                          containers and public health
#   bash infra/compose/deploy-full.sh app <compose args...>           docker compose on the Savingroup stack
#   bash infra/compose/deploy-full.sh site <compose args...>          docker compose on the site stack
#
# Run it from anywhere in the checkout as root or a docker-group member. It needs .env with the
# production values (docs/setup-manual.md section 14) and infra/frappe/.env. Every step checks
# before it acts, so rerunning `up` is how you deploy a new revision.
# Single-quoted container commands expand $POSTGRES_USER and friends inside the container.
# shellcheck disable=SC2016
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

NETWORK=savingroup-business
APP=(docker compose --env-file .env
  -f infra/compose/docker-compose.prod.yml
  -f infra/compose/docker-compose.prod.docker.yml
  -f infra/compose/docker-compose.prod.business.yml)
SITE_ENV=infra/frappe/.env
SITE_STACK=(docker compose --env-file "${SITE_ENV}"
  -f infra/frappe/compose.yaml
  -f infra/frappe/compose.prod.yaml)

die() {
  echo "deploy-full: $*" >&2
  exit 1
}
log() { printf '\n==> %s\n' "$*"; }

# Last assignment of KEY in an env file, without surrounding quotes.
env_value() {
  sed -n "s/^$1=//p" "$2" 2>/dev/null | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

load_settings() {
  [[ -f .env ]] || die "Create .env first (docs/setup-manual.md section 14)."
  [[ -f "${SITE_ENV}" ]] || die "Create infra/frappe/.env from infra/frappe/.env.example first."
  SAVINGROUP_HOST="$(env_value SAVINGROUP_HOST .env)"
  FRAPPE_HOST="$(env_value FRAPPE_HOST .env)"
  [[ -n "${SAVINGROUP_HOST}" && -n "${FRAPPE_HOST}" ]] || die "Set SAVINGROUP_HOST and FRAPPE_HOST in .env."
  SITE="$(env_value SITE_NAME "${SITE_ENV}")"
  SITE="${SITE:-frontend}"
  FRAPPE_IMAGE="$(env_value SAVINGROUP_FRAPPE_IMAGE "${SITE_ENV}")"
  FRAPPE_IMAGE="${FRAPPE_IMAGE:-savingroup/frappe-business:16.51.1}"
  FRAPPE_PORT="$(env_value FRAPPE_HTTP_PORT "${SITE_ENV}")"
  FRAPPE_PORT="${FRAPPE_PORT:-8090}"
  SUBNET="$(env_value SAVINGROUP_BUSINESS_SUBNET "${SITE_ENV}")"
  SUBNET="${SUBNET:-172.31.250.0/24}"
  STATE_FILE="infra/frappe/state/${SITE}.gateway.json"
  export GIT_SHA="${GIT_SHA:-$(git rev-parse --short HEAD 2>/dev/null || true)}"
}

check_docker() {
  docker info >/dev/null 2>&1 || die "Docker is not reachable. Install Docker Engine and run as root or a docker-group member."
  local version
  version="$(docker compose version --short 2>/dev/null)" || die "Install the Docker Compose plugin."
  version="${version#v}"
  [[ "$(printf '%s\n' 2.24.4 "${version}" | sort -V | head -n 1)" == 2.24.4 ]] ||
    die "Docker Compose ${version} is too old; 2.24.4 or newer is needed."
}

# Refuse the development values a copied .env still carries.
check_production_env() {
  local origin="https://${SAVINGROUP_HOST}" key value
  for key in BETTER_AUTH_URL WEB_ORIGIN API_URL; do
    value="$(env_value "${key}" .env)"
    [[ "${value%/}" == "${origin}" ]] || die "Set ${key}=${origin} in .env (it is '${value}')."
  done
  for key in POSTGRES_PASSWORD BETTER_AUTH_SECRET ENCRYPTION_KEY SCREEN_PROXY_SECRET SANDBOX_SUPERVISOR_TOKEN; do
    [[ -n "$(env_value "${key}" .env)" ]] || die "Set ${key} in .env."
  done
  if [[ -z "$(env_value SIGNUP_ALLOWLIST .env)" && "${SAVINGROUP_ALLOW_OPEN_SIGNUPS:-}" != 1 ]]; then
    die "SIGNUP_ALLOWLIST is empty, so anyone who finds ${SAVINGROUP_HOST} could sign up and run bot computers on this host. Set it to the owner's email (comma-separated for more), or rerun with SAVINGROUP_ALLOW_OPEN_SIGNUPS=1."
  fi
}

wait_for_url() {
  local url="$1" tries="${2:-90}"
  for _ in $(seq 1 "${tries}"); do
    curl -fsS -o /dev/null --max-time 5 "${url}" 2>/dev/null && return 0
    sleep 2
  done
  return 1
}

ensure_network() {
  docker network inspect "${NETWORK}" >/dev/null 2>&1 && return 0
  log "Creating network ${NETWORK} (${SUBNET})"
  docker network create --driver bridge --subnet "${SUBNET}" "${NETWORK}" >/dev/null
}

start_site() {
  if [[ "${REBUILD_FRAPPE:-}" == 1 ]] || ! docker image inspect "${FRAPPE_IMAGE}" >/dev/null 2>&1; then
    log "Building ${FRAPPE_IMAGE} (10 to 25 minutes the first time)"
    docker build -f infra/frappe/Containerfile -t "${FRAPPE_IMAGE}" infra/frappe
  fi
  log "Starting the ERPNext site"
  "${SITE_STACK[@]}" up -d
  if [[ ! -f "${STATE_FILE}" ]]; then
    log "Provisioning site ${SITE} (first deploy)"
    "${SITE_STACK[@]}" --profile bootstrap run --rm bootstrap
  fi
  wait_for_url "http://127.0.0.1:${FRAPPE_PORT}/api/method/ping" ||
    die "The site did not answer on 127.0.0.1:${FRAPPE_PORT}; see: deploy-full.sh site logs backend frontend"
  # Absolute links in mail, prints and redirects use the public origin.
  "${SITE_STACK[@]}" exec -T backend bench --site "${SITE}" set-config host_name "https://${FRAPPE_HOST}" >/dev/null
}

start_app() {
  log "Building and starting Savingroup"
  # Only the pull-only dependencies (postgres, caddy, busybox); the app images build from this checkout.
  "${APP[@]}" pull --ignore-buildable --quiet
  "${APP[@]}" up -d --build --wait --wait-timeout 600 --pull never
}

report_public() {
  log "Public addresses"
  local url
  for url in "https://${SAVINGROUP_HOST}/health" "https://${FRAPPE_HOST}/api/method/ping"; do
    local host="${url#https://}"
    host="${host%%/*}"
    if curl -fsS -o /dev/null --max-time 15 --resolve "${host}:443:127.0.0.1" "${url}" 2>/dev/null; then
      echo "  ${url} OK"
    else
      echo "  ${url} not answering yet. Point the DNS record for ${host} at this host and allow TCP 80/443; Caddy fetches the certificate on first contact."
    fi
  done
}

connect_site() {
  local email="${1:-}"
  [[ -n "${email}" ]] || die "Usage: deploy-full.sh connect <owner-email>"
  [[ -f "${STATE_FILE}" ]] || die "Missing ${STATE_FILE}; run 'up' first."
  log "Connecting ${email}'s organization to https://${FRAPPE_HOST}"
  "${APP[@]}" exec -T api sh -c 'umask 077; cat > /tmp/gateway.json' <"${STATE_FILE}"
  local status=0
  "${APP[@]}" exec -T api pnpm --filter @savingroup/api business:connect -- \
    --email "${email}" --site-url "https://${FRAPPE_HOST}" --state-file /tmp/gateway.json || status=$?
  "${APP[@]}" exec -T api rm -f /tmp/gateway.json
  [[ "${status}" == 0 ]] ||
    die "Connecting failed (above). If the site was already connected, use ERP > Overview > Disable first; if TLS failed, wait for DNS and the certificate, then rerun."
}

# The one file in DIR matching GLOB (empty when there is none).
one_file() {
  local match
  for match in "$1"/$2; do
    [[ -f "${match}" ]] && {
      printf '%s' "${match}"
      return 0
    }
  done
}

restore_app_data() {
  local dir="$1"
  log "Restoring the Savingroup database"
  "${APP[@]}" stop api worker web
  "${APP[@]}" exec -T postgres sh -c \
    'dropdb -U "$POSTGRES_USER" --force --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$POSTGRES_DB"'
  "${APP[@]}" exec -T postgres sh -c \
    'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --clean --if-exists --exit-on-error' \
    <"${dir}/savingroup.dump"

  if [[ -f "${dir}/data.tgz" ]]; then
    log "Restoring bot computer homes and artifacts"
    "${APP[@]}" run --rm --no-deps -T -v "${dir}:/restore:ro" data-init \
      sh -c 'tar -xzf /restore/data.tgz -C /data && chown -R 1000:1000 /data'
  fi
}

restore_site() {
  local dir="$1"
  log "Restoring the ERPNext site"
  "${SITE_STACK[@]}" exec -T -u root backend sh -c 'rm -rf /tmp/savingroup-restore && mkdir -p /tmp/savingroup-restore'
  "${SITE_STACK[@]}" cp "${dir}/frappe/." backend:/tmp/savingroup-restore/
  "${SITE_STACK[@]}" exec -T -u root backend chown -R frappe /tmp/savingroup-restore
  DB_ROOT_PASSWORD="$(env_value MARIADB_ROOT_PASSWORD "${SITE_ENV}")" \
    "${SITE_STACK[@]}" exec -T -e DB_ROOT_PASSWORD -e SITE="${SITE}" backend bash -s <<'SITE_RESTORE'
set -euo pipefail
cd /home/frappe/frappe-bench
d=/tmp/savingroup-restore
db=$(ls "$d"/*-database.sql.gz | head -n 1)
public=$(ls "$d"/*-files.tar 2>/dev/null | grep -v -- '-private-files.tar$' | head -n 1 || true)
private=$(ls "$d"/*-private-files.tar 2>/dev/null | head -n 1 || true)
config=$(ls "$d"/*-site_config_backup.json 2>/dev/null | head -n 1 || true)
files=()
[ -n "$public" ] && files+=(--with-public-files "$public")
[ -n "$private" ] && files+=(--with-private-files "$private")
bench --site "$SITE" restore "$db" --db-root-password "$DB_ROOT_PASSWORD" "${files[@]}"
# Passwords and API secrets on the site are sealed with the exported site's key.
if [ -n "$config" ]; then
  key=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("encryption_key", ""))' "$config")
  [ -n "$key" ] && bench --site "$SITE" set-config encryption_key "$key"
fi
bench --site "$SITE" migrate
SITE_RESTORE
  "${SITE_STACK[@]}" exec -T -u root backend rm -rf /tmp/savingroup-restore
  "${SITE_STACK[@]}" restart backend websocket queue-short queue-long scheduler frontend
  [[ -f "${STATE_FILE}" ]] && cp -p "${STATE_FILE}" "${STATE_FILE}.before-restore"
  install -m 600 "${dir}/gateway.json" "${STATE_FILE}"
  wait_for_url "http://127.0.0.1:${FRAPPE_PORT}/api/method/ping" || die "The restored site did not come back."
  "${SITE_STACK[@]}" exec -T backend bench --site "${SITE}" set-config host_name "https://${FRAPPE_HOST}" >/dev/null
}

restore_export() {
  local dir="${1:-}" email="${2:-}"
  [[ -d "${dir}" && -n "${email}" ]] || die "Usage: deploy-full.sh restore <export-dir> <owner-email>"
  dir="$(cd "${dir}" && pwd)"
  [[ -f "${dir}/savingroup.dump" && -f "${dir}/gateway.json" && -n "$(one_file "${dir}/frappe" '*-database.sql.gz')" ]] ||
    die "${dir} is not a package from infra/compose/export-local.sh."

  ensure_network
  start_site
  start_app
  restore_app_data "${dir}"
  restore_site "${dir}"

  log "Starting Savingroup on the restored data"
  "${APP[@]}" up -d --wait --wait-timeout 600 --pull never
  # The exported connection points at the old machine's site, which a server cannot reach.
  "${APP[@]}" exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
UPDATE business_environments SET status = 'disabled'
WHERE status = 'active' AND "siteUrl" ~* '^https?://(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)';
SQL
  connect_site "${email}"
}

show_status() {
  "${SITE_STACK[@]}" ps
  "${APP[@]}" ps
  report_public
}

main() {
  local command="${1:-up}"
  [[ $# -gt 0 ]] && shift
  load_settings
  case "${command}" in
    up)
      check_docker
      check_production_env
      ensure_network
      start_site
      start_app
      report_public
      echo
      echo "Next: sign in at https://${SAVINGROUP_HOST}. On a new install, create the owner account, then run:"
      echo "  bash infra/compose/deploy-full.sh connect <owner-email>"
      ;;
    connect) connect_site "$@" ;;
    restore)
      check_docker
      check_production_env
      restore_export "$@"
      report_public
      ;;
    status) show_status ;;
    app) "${APP[@]}" "$@" ;;
    site) "${SITE_STACK[@]}" "$@" ;;
    *) die "Unknown command '${command}'. Use up, connect, restore, status, app or site." ;;
  esac
}

# Sourcing the file (for a dry run against throwaway stacks) defines the steps without running them.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
