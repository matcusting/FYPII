#!/usr/bin/env bash
# Run on the production Linux host after deploy/.env.production is configured.
# No job is installed by this file. It never acts on the local development stack.
set -Eeuo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
environment_file=deploy/.env.production
compose_file=deploy/compose.production.yml

if [[ ! -f "$environment_file" ]]; then
  echo 'Create the private deploy/.env.production file before production maintenance.' >&2
  exit 1
fi
if ! command -v flock >/dev/null || ! command -v docker >/dev/null; then
  echo 'Production maintenance requires flock and Docker Compose on the host.' >&2
  exit 1
fi

# The same private env file is the lock inode; it is opened read-only.
exec 9< "$environment_file"
if ! flock -n 9; then
  echo 'Another production maintenance run is already active.' >&2
  exit 1
fi

compose=(docker compose --env-file "$environment_file" -f "$compose_file")
"${compose[@]}" config --quiet

originally_running=$("${compose[@]}" ps --status running --services)
api_running=false
worker_running=false
if [[ $'\n'"$originally_running"$'\n' == *$'\napi\n'* ]]; then api_running=true; fi
if [[ $'\n'"$originally_running"$'\n' == *$'\nemail-worker\n'* ]]; then worker_running=true; fi
stopped=false

resume_services() {
  if [[ "$stopped" == true ]]; then
    if [[ "$api_running" == true ]]; then "${compose[@]}" up -d api; fi
    if [[ "$worker_running" == true ]]; then "${compose[@]}" up -d email-worker; fi
    stopped=false
  fi
}
trap resume_services EXIT

stop_writes() {
  stopped=true
  "${compose[@]}" stop api email-worker
}

make_backup() {
  local result archive
  result=$("${compose[@]}" run --rm -T maintenance node /app/scripts/production-backup.mjs create --confirm-writes-stopped)
  printf '%s\n' "$result"
  archive=${result##*: }
  if [[ ! "$archive" =~ ^/backups/uts-housing-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}\.uthbak$ ]]; then
    echo 'The backup command did not return an expected archive path.' >&2
    return 1
  fi
  printf '%s' "$archive"
}

rehearse_backup() {
  local archive=$1
  "${compose[@]}" run --rm -T maintenance node /app/scripts/production-backup.mjs rehearse "--file=$archive"
}

case "${1:-}" in
  backup)
    [[ $# == 1 ]] || { echo 'Usage: maintenance.sh backup' >&2; exit 2; }
    stop_writes
    backup_output=$(make_backup)
    archive=${backup_output##*$'\n'}
    printf '%s\n' "${backup_output%$'\n'*}"
    resume_services
    rehearse_backup "$archive"
    ;;
  retention-dry-run)
    [[ $# == 1 ]] || { echo 'Usage: maintenance.sh retention-dry-run' >&2; exit 2; }
    "${compose[@]}" run --rm -T maintenance npm run evidence:retention -- --student-offer-end --identity-years=2 --property-years=2 --limit=100
    ;;
  retention-apply)
    [[ $# == 3 && "$2" =~ ^--actor-email=[^[:space:]@]+@[^[:space:]@]+$ && "$3" == '--confirm=DELETE_ELIGIBLE_EVIDENCE' ]] || {
      echo 'Usage: maintenance.sh retention-apply --actor-email=ACTIVE_ADMIN_EMAIL --confirm=DELETE_ELIGIBLE_EVIDENCE' >&2
      exit 2
    }
    stop_writes
    backup_output=$(make_backup)
    archive=${backup_output##*$'\n'}
    printf '%s\n' "${backup_output%$'\n'*}"
    rehearse_backup "$archive"
    "${compose[@]}" run --rm -T maintenance npm run evidence:retention -- --student-offer-end --identity-years=2 --property-years=2 --limit=100 --apply --confirm-maintenance --confirm=DELETE_ELIGIBLE_EVIDENCE "$2"
    ;;
  *)
    echo 'Usage: maintenance.sh backup | retention-dry-run | retention-apply --actor-email=... --confirm=DELETE_ELIGIBLE_EVIDENCE' >&2
    exit 2
    ;;
esac
