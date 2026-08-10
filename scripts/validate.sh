#!/usr/bin/env bash
# Full validation, quiet by default: prints a short PASS/FAIL summary and
# leaves full output in a log file. Playwright's reporter and the Electron
# windows it spawns are the reason `npm run test:e2e` takes over the screen —
# here e2e runs headless-ish in the background with the dot reporter, and all
# chatter goes to the log.
set -uo pipefail
cd "$(dirname "$0")/.."

LOG="${VALIDATE_LOG:-/tmp/pidex-validate-$$.log}"
: > "$LOG"
FAILED=()

step() {
  local name="$1"; shift
  printf '%-12s' "$name" >&2
  if "$@" >>"$LOG" 2>&1; then
    printf 'PASS\n' >&2
  else
    printf 'FAIL\n' >&2
    FAILED+=("$name")
  fi
}

step typecheck npm run typecheck
step lint      npm run lint
step format    npx prettier --check .
step unit      npm test
if [[ "${SKIP_E2E:-}" != "1" ]]; then
  step e2e npm run test:e2e -- --reporter=dot
fi

echo >&2
if ((${#FAILED[@]})); then
  echo "FAILED: ${FAILED[*]}" >&2
  echo "log: $LOG" >&2
  exit 1
fi
echo "all green — log: $LOG" >&2
