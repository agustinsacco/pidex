#!/usr/bin/env sh
# pidex installer — detects OS/arch, downloads the matching artifact from the
# latest GitHub Release, verifies its checksum, and installs it.
#
#   curl -fsSL https://github.com/pidex-app/pidex/releases/latest/download/install.sh | sh
#
# Env overrides:
#   PIDEX_REPO     owner/repo               (default pidex-app/pidex)
#   PIDEX_VERSION  vX.Y.Z                   (default: latest release)
#   PIDEX_PREFIX   install prefix on Linux  (default $HOME/.local)

set -eu

REPO="${PIDEX_REPO:-pidex-app/pidex}"
PREFIX="${PIDEX_PREFIX:-$HOME/.local}"
MIN_PI_VERSION="0.78.0"

info()  { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
warn()  { printf '\033[1;33mwarning:\033[0m %s\n' "$1" >&2; }
die()   { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

need curl
need uname

# ---------- platform detection ----------

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) die "unsupported architecture: $ARCH" ;;
esac

case "$OS" in
  Darwin) PLATFORM="mac" ;;
  Linux)  PLATFORM="linux" ;;
  MINGW*|MSYS*|CYGWIN*)
    die "Windows: download the installer from https://github.com/$REPO/releases/latest"
    ;;
  *) die "unsupported OS: $OS" ;;
esac

# ---------- resolve release ----------

if [ -n "${PIDEX_VERSION:-}" ]; then
  TAG="$PIDEX_VERSION"
else
  info "Resolving latest release of $REPO…"
  TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"
  [ -n "$TAG" ] || die "could not determine the latest release tag"
fi
VERSION="${TAG#v}"
BASE="https://github.com/$REPO/releases/download/$TAG"

if [ "$PLATFORM" = "mac" ]; then
  ASSET="pidex-${VERSION}-${ARCH}.dmg"
else
  ASSET="pidex-${VERSION}-${ARCH}.AppImage"
fi

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

info "Downloading $ASSET ($TAG)…"
curl -fSL --progress-bar "$BASE/$ASSET" -o "$TMP/$ASSET" \
  || die "download failed — check https://github.com/$REPO/releases/tag/$TAG for available assets"

# ---------- checksum ----------

if curl -fsSL "$BASE/checksums.txt" -o "$TMP/checksums.txt" 2>/dev/null; then
  EXPECTED="$(grep " $ASSET\$" "$TMP/checksums.txt" | awk '{print $1}' | head -n1)"
  if [ -n "$EXPECTED" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      ACTUAL="$(sha256sum "$TMP/$ASSET" | awk '{print $1}')"
    elif command -v shasum >/dev/null 2>&1; then
      ACTUAL="$(shasum -a 256 "$TMP/$ASSET" | awk '{print $1}')"
    else
      ACTUAL=""
      warn "no sha256 tool found — skipping checksum verification"
    fi
    if [ -n "$ACTUAL" ]; then
      [ "$ACTUAL" = "$EXPECTED" ] || die "checksum mismatch for $ASSET (expected $EXPECTED, got $ACTUAL)"
      info "Checksum verified."
    fi
  else
    warn "no checksum entry for $ASSET — continuing without verification"
  fi
else
  warn "checksums.txt not published for $TAG — continuing without verification"
fi

# ---------- install ----------

if [ "$PLATFORM" = "mac" ]; then
  info "Mounting $ASSET…"
  MOUNT="$(hdiutil attach -nobrowse -readonly "$TMP/$ASSET" | grep -o '/Volumes/.*' | tail -n1)"
  [ -n "$MOUNT" ] || die "failed to mount the disk image"
  APP="$(find "$MOUNT" -maxdepth 1 -name '*.app' | head -n1)"
  if [ -z "$APP" ]; then
    hdiutil detach "$MOUNT" >/dev/null 2>&1 || true
    die "no .app bundle found inside the disk image"
  fi
  info "Installing to /Applications…"
  rm -rf "/Applications/pidex.app"
  cp -R "$APP" /Applications/ || {
    hdiutil detach "$MOUNT" >/dev/null 2>&1 || true
    die "copy to /Applications failed (try: sudo)"
  }
  hdiutil detach "$MOUNT" >/dev/null 2>&1 || true
  # Unsigned builds are quarantined; clear it so the app opens.
  xattr -dr com.apple.quarantine /Applications/pidex.app 2>/dev/null || true
  INSTALLED="/Applications/pidex.app"
else
  mkdir -p "$PREFIX/bin" "$PREFIX/share/applications" "$PREFIX/share/icons/hicolor/512x512/apps"
  install -m 755 "$TMP/$ASSET" "$PREFIX/bin/pidex"
  cat > "$PREFIX/share/applications/pidex.desktop" <<DESKTOP
[Desktop Entry]
Name=pidex
Comment=Desktop coding-agent app powered by the pi coding agent
Exec=$PREFIX/bin/pidex %U
Icon=pidex
Terminal=false
Type=Application
Categories=Development;IDE;
StartupWMClass=pidex
DESKTOP
  curl -fsSL "$BASE/icon.png" -o "$PREFIX/share/icons/hicolor/512x512/apps/pidex.png" 2>/dev/null || true
  command -v update-desktop-database >/dev/null 2>&1 \
    && update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true
  INSTALLED="$PREFIX/bin/pidex"
  case ":$PATH:" in
    *":$PREFIX/bin:"*) ;;
    *) warn "$PREFIX/bin is not on your PATH — add it to your shell profile" ;;
  esac
fi

info "Installed pidex $VERSION → $INSTALLED"

# ---------- prerequisite check (advisory) ----------

if command -v pi >/dev/null 2>&1; then
  PI_VERSION="$(pi --version 2>/dev/null | head -n1 | tr -d '[:space:]')"
  info "Found pi $PI_VERSION (pidex requires >= $MIN_PI_VERSION)"
else
  warn "The pi coding agent was not found on your PATH."
  printf '         Install it with: npm install -g @earendil-works/pi-coding-agent\n'
  printf '         pidex will show a setup screen until pi is available.\n'
fi

info "Done. Launch pidex from your applications menu."
