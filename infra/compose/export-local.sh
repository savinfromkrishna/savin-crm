#!/usr/bin/env bash
# Package this machine's data for `infra/compose/deploy-full.sh restore` on a server: the Savingroup
# database, DATA_DIR (bot computer homes and artifacts; local backups are skipped), the ERPNext
# site (database and files) and its gateway key pair. Nothing local changes.
#
# Run from the repository root while Docker and both local stacks are up; stop `pnpm dev` first
# for a consistent copy. On Windows, from PowerShell:
#   & "$env:ProgramFiles\Git\bin\bash.exe" infra/compose/export-local.sh
#
# The package holds sealed credentials and business data. Copy it to the server over SSH only,
# delete it afterwards, and give the server the same ENCRYPTION_KEY as this .env.
# PG_CONTAINER overrides the local Postgres container (default compose-postgres-1).
set -Eeuo pipefail
# Git Bash would otherwise rewrite container paths such as /tmp/... into Windows paths.
export MSYS_NO_PATHCONV=1

env_value() {
  sed -n "s/^$1=//p" "$2" 2>/dev/null | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

[[ -f .env && -f infra/frappe/.env ]] || {
  echo "Run from the repository root; it needs .env and infra/frappe/.env." >&2
  exit 1
}

database_url="$(env_value DATABASE_URL .env)"
# postgres(ql)://user:password@host:port/database?options
pg_user="$(sed -E 's#^[a-z]+://([^:@/]+).*#\1#' <<<"${database_url}")"
pg_db="$(sed -E 's#^[a-z]+://[^/]+/([^?]+).*#\1#' <<<"${database_url}")"
pg_container="${PG_CONTAINER:-compose-postgres-1}"
data_dir="$(env_value DATA_DIR .env)"
data_dir="${data_dir:-./data}"
site="$(env_value SITE_NAME infra/frappe/.env)"
site="${site:-frontend}"
[[ -n "${pg_user}" && -n "${pg_db}" ]] || {
  echo "DATABASE_URL in .env is not a postgres URL." >&2
  exit 1
}
[[ -f "infra/frappe/state/${site}.gateway.json" ]] || {
  echo "Missing infra/frappe/state/${site}.gateway.json (the site's gateway key pair)." >&2
  exit 1
}

out="backups/migration-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${out}/frappe"
chmod 700 "${out}"
site_stack=(docker compose -f infra/frappe/compose.yaml --env-file infra/frappe/.env)

echo "Savingroup database ${pg_db} (${pg_container})..."
docker exec "${pg_container}" pg_dump -U "${pg_user}" -d "${pg_db}" -Fc --no-owner --no-privileges -f /tmp/savingroup-export.dump
docker cp "${pg_container}:/tmp/savingroup-export.dump" "${out}/savingroup.dump"
docker exec "${pg_container}" rm -f /tmp/savingroup-export.dump

echo "DATA_DIR ${data_dir}..."
# GNU tar exits 1 when a file changes while it reads (a bot still writing); the archive is
# still usable, as in backup-prod.sh. Only a fatal error (2) stops the export.
rc=0
tar -C "${data_dir}" --exclude=./backups -czf "${out}/data.tgz" . || rc=$?
[[ "${rc}" -le 1 ]] || exit "${rc}"

echo "ERPNext site ${site}..."
"${site_stack[@]}" exec -T -u root backend rm -rf /tmp/savingroup-export
"${site_stack[@]}" exec -T backend bench --site "${site}" backup --with-files --backup-path /tmp/savingroup-export
"${site_stack[@]}" cp backend:/tmp/savingroup-export/. "${out}/frappe/"
"${site_stack[@]}" exec -T -u root backend rm -rf /tmp/savingroup-export
cp "infra/frappe/state/${site}.gateway.json" "${out}/gateway.json"

echo
echo "Wrote ${out}:"
ls -l "${out}" "${out}/frappe"
