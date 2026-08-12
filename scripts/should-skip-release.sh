#!/usr/bin/env sh
# Decide whether a commit message asks to skip publishing a release.
#
# Exits 0 ("skip") only when the marker is in the commit SUBJECT. Matching the
# whole message once suppressed a release because the commit body merely
# *documented* the feature — v0.1.37 never shipped as a result. A directive
# belongs in the subject; prose about it belongs in the body.
#
# Usage: should-skip-release.sh "<full commit message>"
# Extracted from the workflow so it can be unit tested.

set -eu

MESSAGE=${1:-}
SUBJECT=$(printf '%s' "$MESSAGE" | head -n 1)

if printf '%s' "$SUBJECT" | grep -qF '[skip release]'; then
  exit 0
fi
exit 1
