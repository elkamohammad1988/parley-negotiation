#!/bin/bash
# Safeguard: verifies the monthly rehearsal quota is enforced for free accounts
# and NOT enforced for paid ones.
#
# Regression target: quota is checked server-side at the moment a room opens
# (app/api/rehearsal/session), and the failure that actually matters is the
# expensive direction — a paid user being told they have run out. getRehearsalQuota
# fails OPEN by design, so a database problem must never block a rehearsal, and
# this script confirms that intent still holds after a change.
#
# Requires SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL in the
# environment (same names as .env.local). Never hardcode the key here.
#   set -a && source .env.local && set +a && ./scripts/test-quota.sh
#
# Not wired into CI. Opening a room is free (the counterpart's opening line is
# scripted, not generated), so this costs nothing in model spend — but it does
# write real rows, so point it at a development project, never production.

set -uo pipefail

BASE_URL="${PARLEY_BASE_URL:-http://localhost:3000}"
SCENARIO="${PARLEY_TEST_SCENARIO:-renewal-uplift}"
COUNTERPART="${PARLEY_TEST_COUNTERPART:-deflector}"

echo "=== REHEARSAL QUOTA SAFEGUARD ==="
echo "Target: $BASE_URL"

if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || [ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]; then
  echo "FAIL: SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL must be set."
  echo "      Run: set -a && source .env.local && set +a"
  exit 1
fi

if [ -z "${PARLEY_TEST_FREE_USER_ID:-}" ] || [ -z "${PARLEY_TEST_PAID_USER_ID:-}" ]; then
  echo "FAIL: PARLEY_TEST_FREE_USER_ID and PARLEY_TEST_PAID_USER_ID must be set."
  echo "      Both must be real user rows; the paid one needs an active"
  echo "      subscriptions row on practitioner or above."
  exit 1
fi

failures=0

open_room() {
  local user_id="$1"
  curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/api/rehearsal/session" \
    -H "Content-Type: application/json" \
    -d "{\"userId\":\"$user_id\",\"scenarioSlug\":\"$SCENARIO\",\"counterpartId\":\"$COUNTERPART\"}"
}

# --- Paid account: must never be refused for quota -------------------------
echo ""
echo "-- Paid account (must always be allowed) --"
for i in 1 2 3 4; do
  status=$(open_room "$PARLEY_TEST_PAID_USER_ID")
  if [ "$status" = "402" ]; then
    echo "FAIL: paid account refused with 402 on attempt $i"
    failures=$((failures + 1))
  elif [ "$status" = "200" ]; then
    echo "  ok  attempt $i -> $status"
  else
    echo "WARN: unexpected status $status on attempt $i (not a quota failure)"
  fi
done

# --- Free account: must be refused once past its monthly allowance ---------
# The free plan allows 3 rehearsals a month (lib/plans.ts). This opens more
# than that and expects the surplus to be refused with 402.
echo ""
echo "-- Free account (must be refused past its allowance) --"
refused=0
for i in 1 2 3 4 5; do
  status=$(open_room "$PARLEY_TEST_FREE_USER_ID")
  echo "  attempt $i -> $status"
  if [ "$status" = "402" ]; then
    refused=$((refused + 1))
  fi
done

if [ "$refused" -eq 0 ]; then
  echo "FAIL: free account was never refused — the quota gate is not firing."
  echo "      (If this account already had rehearsals this month, reset it first.)"
  failures=$((failures + 1))
else
  echo "  ok  free account refused $refused time(s)"
fi

echo ""
if [ "$failures" -eq 0 ]; then
  echo "PASS: quota enforcement behaved correctly."
  exit 0
fi

echo "FAILED: $failures problem(s) found."
exit 1
