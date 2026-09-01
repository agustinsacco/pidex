# install.sh crashed on every mac: bash 3.2 + UTF-8 + `$VAR…`

`curl … | sh` died with `REPO…: unbound variable` (the `…` renders as `?` in
some terminals) at the first status line, on every macOS machine, since the
installer shipped.

macOS `/bin/sh` is bash 3.2 — the last GPLv2 release, from 2007, never
upgraded by Apple. Under a UTF-8 locale its parser swallows a multibyte
character that directly follows a variable expansion into the variable name:
`"$REPO…"` looks up a variable literally named `REPO…`, and the script's
`set -eu` makes that fatal. `install.sh` had two such lines (`$REPO…` at the
resolve step, `$ASSET…` at the mount step), so fixing only the reported one
would have moved the crash, not removed it.

Why nothing caught it:

- CI runs Linux and mac, but never executes install.sh; the release
  pipeline's `finalize` job only asserts the asset _names_ match.
- Linux `/bin/sh` is dash or bash 4+, both of which parse this correctly.
- A C-locale shell (like a sandboxed agent shell) parses byte-wise and also
  works — the bug reproduces only in a UTF-8 locale, i.e. every real
  interactive mac terminal and nowhere a machine was watching.

Fix: the installer is now pure printable ASCII (`…` → `...`, `—` → `-`,
`→` → `->`). Banning specific characters next to `$VAR` would miss the next
variant, so `scripts/__tests__/install-sh-portability.test.ts` pins the whole
file to printable ASCII + tab.

Until a release built from this commit is live, the already-published broken
script still works when forced into a C locale: `curl -fsSL … | LC_ALL=C sh`.
