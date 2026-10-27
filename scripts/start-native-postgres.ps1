$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$dataRoot = Join-Path (Get-Location) "data\postgres"
$binDir = Join-Path $dataRoot "pgsql\bin"
$pgData = Join-Path $dataRoot "pgdata"
$zipPath = Join-Path $dataRoot "postgresql-16.4-windows-x64-binaries.zip"
$logFile = Join-Path $dataRoot "postgres.log"

New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null

# 1. Update .env flags for Docker-free CRM operation
if (Test-Path ".env") {
  $envContent = Get-Content ".env" -Raw
  $envContent = $envContent -replace "(?m)^SANDBOX_PROVIDER=.*$", "SANDBOX_PROVIDER=none"
  $envContent = $envContent -replace "(?m)^BUSINESS_APPS_ENABLED=.*$", "BUSINESS_APPS_ENABLED=true"
  if ($envContent -notmatch "(?m)^TICKET_BOARD_ENABLED=") {
    $envContent += "`nTICKET_BOARD_ENABLED=true`n"
  } else {
    $envContent = $envContent -replace "(?m)^TICKET_BOARD_ENABLED=.*$", "TICKET_BOARD_ENABLED=true"
  }
  Set-Content ".env" -Value $envContent -NoNewline
}

# Parse DATABASE_URL from .env
$dbLine = (Get-Content ".env" | Where-Object { $_ -match "^DATABASE_URL=" }) -replace '^DATABASE_URL=', '' -replace '^"|"$', ''
if ($dbLine -notmatch "^postgres(ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/(.+)$") {
  throw "Could not parse DATABASE_URL from .env"
}
$dbUser = $Matches[2]
$dbPass = $Matches[3]
$dbHost = $Matches[4]
$dbPort = [int]$Matches[5]
$dbName = $Matches[6]

# 2. Download & extract portable PostgreSQL 16 binaries if not present
$pgCtl = Join-Path $binDir "pg_ctl.exe"
$initDb = Join-Path $binDir "initdb.exe"
$psql = Join-Path $binDir "psql.exe"

if (-not (Test-Path $pgCtl)) {
  if (-not (Test-Path $zipPath)) {
    Write-Output "Downloading portable PostgreSQL 16 binaries..."
    curl.exe -L --fail --retry 3 -o $zipPath "https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip"
  }
  Write-Output "Extracting pgsql/bin, pgsql/lib, pgsql/share..."
  tar.exe -xf $zipPath -C $dataRoot pgsql/bin pgsql/lib pgsql/share
  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
}

# 3. Initialize cluster if needed
if (-not (Test-Path (Join-Path $pgData "PG_VERSION"))) {
  Write-Output "Initializing native PostgreSQL cluster at $pgData..."
  & $initDb -D $pgData -U postgres -A trust --encoding=UTF8 --locale=C
}

# 4. Start PostgreSQL on $dbPort if not already listening
$listening = Get-NetTCPConnection -LocalPort $dbPort -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Write-Output "Starting native PostgreSQL on 127.0.0.1:$dbPort..."
  & $pgCtl -D $pgData -l $logFile -o "-p $dbPort -h 127.0.0.1" start
  Start-Sleep -Seconds 2
}

# 5. Ensure role and database exist
Write-Output "Ensuring role '$dbUser' and database '$dbName' exist on port $dbPort..."
& $psql -h 127.0.0.1 -p $dbPort -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$dbUser') THEN CREATE ROLE `"$dbUser`" WITH LOGIN SUPERUSER PASSWORD '$dbPass'; ELSE ALTER ROLE `"$dbUser`" WITH LOGIN SUPERUSER PASSWORD '$dbPass'; END IF; END `$`$;"
$dbExists = & $psql -h 127.0.0.1 -p $dbPort -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$dbName'"
if ($dbExists.Trim() -ne "1") {
  & $psql -h 127.0.0.1 -p $dbPort -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE `"$dbName`" OWNER `"$dbUser`";"
}
Write-Output "Native PostgreSQL is ready on 127.0.0.1:$dbPort/$dbName"
