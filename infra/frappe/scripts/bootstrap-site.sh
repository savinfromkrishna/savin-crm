#!/usr/bin/env bash
# Provision one Savingroup business site inside the bench container. Idempotent:
# every step checks before it acts, so a failed or interrupted run can simply
# be run again. Runs as the `frappe` user via the compose `bootstrap` service.
set -euo pipefail

: "${SITE_NAME:?SITE_NAME is required}"
: "${MARIADB_ROOT_PASSWORD:?MARIADB_ROOT_PASSWORD is required}"
: "${SITE_ADMIN_PASSWORD:?SITE_ADMIN_PASSWORD is required}"
: "${COMPANY_NAME:?COMPANY_NAME is required}"
: "${COMPANY_ABBR:?COMPANY_ABBR is required}"
BLUEPRINT="${BLUEPRINT:-india-smb}"
SITE_ADMIN_EMAIL="${SITE_ADMIN_EMAIL:-admin@example.com}"
GATEWAY_USER_EMAIL="${GATEWAY_USER_EMAIL:-savingroup-gateway@example.com}"
ALLOW_NEGATIVE_STOCK="${ALLOW_NEGATIVE_STOCK:-0}"
BLUEPRINT_FILE="/opt/savingroup/blueprints/${BLUEPRINT}.json"
STATE_DIR="/opt/savingroup/state"
BENCH_DIR="/home/frappe/frappe-bench"

cd "$BENCH_DIR"
[ -f "$BLUEPRINT_FILE" ] || { echo "Unknown blueprint ${BLUEPRINT}" >&2; exit 2; }

json() { python3 -c "import json,sys; v=json.load(open('$BLUEPRINT_FILE'))$1; print(v if not isinstance(v, list) else ' '.join(v))"; }
COUNTRY=$(json "['country']")
CURRENCY=$(json "['currency']")
TIMEZONE=$(json "['timezone']")
LANGUAGE=$(json "['language']")
CHART=$(json "['chart_of_accounts']")
FY_MONTH=$(json "['fiscal_year_start_month']")
PRICE_LIST=$(json "['price_list']")
APPS=$(json "['apps']")

echo "Waiting for the database and the queues..."
wait-for-it -t 180 "${DB_HOST:-db}:${DB_PORT:-3306}"
wait-for-it -t 180 redis-cache:6379
wait-for-it -t 180 redis-queue:6379
for _ in $(seq 1 60); do
  if grep -q '"db_host"' sites/common_site_config.json 2>/dev/null \
     && grep -q '"redis_cache"' sites/common_site_config.json \
     && grep -q '"redis_queue"' sites/common_site_config.json; then break; fi
  sleep 2
done

if [ ! -d "sites/${SITE_NAME}" ]; then
  echo "Creating site ${SITE_NAME} with ERPNext..."
  bench new-site "$SITE_NAME" \
    --mariadb-user-host-login-scope='%' \
    --db-root-username=root \
    --db-root-password="$MARIADB_ROOT_PASSWORD" \
    --admin-password="$SITE_ADMIN_PASSWORD" \
    --install-app erpnext \
    --set-default
fi

for app in $APPS; do
  if [ "$app" = "erpnext" ]; then continue; fi
  if bench --site "$SITE_NAME" list-apps | grep -qx "$app"; then
    echo "App ${app} already installed."
  else
    echo "Installing ${app}..."
    bench --site "$SITE_NAME" install-app "$app"
  fi
done

# Fiscal year containing today, from the blueprint's start month.
FY=$(python3 - "$FY_MONTH" <<'PY'
import datetime, sys
month = int(sys.argv[1])
today = datetime.date.today()
year = today.year if today.month >= month else today.year - 1
start = datetime.date(year, month, 1)
end = datetime.date(year + 1, month, 1) - datetime.timedelta(days=1)
print(f"{start.isoformat()} {end.isoformat()}")
PY
)
FY_START=${FY% *}
FY_END=${FY#* }

echo "Completing the setup wizard (company ${COMPANY_NAME})..."
bench --site "$SITE_NAME" execute savingroup_business_bridge.setup.complete_setup --kwargs "{
  'language': '${LANGUAGE}', 'country': '${COUNTRY}', 'timezone': '${TIMEZONE}', 'currency': '${CURRENCY}',
  'full_name': 'Administrator', 'email': '${SITE_ADMIN_EMAIL}',
  'company_name': '${COMPANY_NAME}', 'company_abbr': '${COMPANY_ABBR}', 'chart_of_accounts': '${CHART}',
  'fy_start_date': '${FY_START}', 'fy_end_date': '${FY_END}'
}"

bench --site "$SITE_NAME" execute savingroup_business_bridge.setup.configure_defaults --kwargs "{
  'company': '${COMPANY_NAME}', 'price_list': '${PRICE_LIST}', 'allow_negative_stock': ${ALLOW_NEGATIVE_STOCK}
}"

echo "Creating the gateway user ${GATEWAY_USER_EMAIL}..."
mkdir -p "$STATE_DIR"
GATEWAY_JSON=$(bench --site "$SITE_NAME" execute savingroup_business_bridge.setup.ensure_gateway_user \
  --kwargs "{'email': '${GATEWAY_USER_EMAIL}', 'full_name': 'Savingroup Gateway', 'rotate': 1}" | grep -m1 '^{')
python3 - "$GATEWAY_JSON" "$STATE_DIR/${SITE_NAME}.gateway.json" "$SITE_NAME" "$BLUEPRINT" "$COMPANY_NAME" "$COMPANY_ABBR" "$COUNTRY" "$CURRENCY" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
data.update({
    "site": sys.argv[3], "blueprint": sys.argv[4], "company_name": sys.argv[5],
    "company_abbr": sys.argv[6], "country": sys.argv[7], "currency": sys.argv[8],
})
with open(sys.argv[2], "w") as handle:
    json.dump(data, handle, indent=2)
PY
chmod 600 "$STATE_DIR/${SITE_NAME}.gateway.json"

if [ "${GATEWAY_ADMIN:-0}" = "1" ]; then
  echo "Granting the gateway user the administrative roles (GATEWAY_ADMIN=1)..."
  bench --site "$SITE_NAME" execute savingroup_business_bridge.setup.grant_admin \
    --kwargs "{'email': '${GATEWAY_USER_EMAIL}'}"
fi

bench --site "$SITE_NAME" set-config allow_tests 0 >/dev/null 2>&1 || true
echo "Site ${SITE_NAME} is ready. Gateway credentials: ${STATE_DIR}/${SITE_NAME}.gateway.json"
