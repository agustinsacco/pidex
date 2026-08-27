import { homedir } from 'node:os'
import { stripAnsi } from '@shared/ansi'
import type { LoginFlowState, LoginProviderId } from '@shared/models'
import { checkPiHealth } from './health'
import { piProcessEnv } from './shell-env'
import { ptyManager } from '../pty/pty-manager'
import { checkProviderAuth } from './auth-status'

/**
 * Signing into a pi provider without making the user drive a terminal.
 *
 * pi's `/login` is TUI-only: there is no `pi auth login`, no RPC command, and
 * the provider registry is not a package export. So a pty is the only door —
 * but it does not have to be a door the *user* walks through. This drives that
 * TUI off-screen and reports structured state, so the UI can be a button, a
 * browser tab, and a row that flips to "Signed in".
 *
 * Everything here was established by driving the real TUI (pi 0.84.1); the
 * screens below are quoted from that capture, because this file is a parser
 * for someone else's rendering and the shapes are the whole contract:
 *
 *     Select authentication method:
 *     → Sign in with an account
 *       Sign in with an API key
 *
 *     Select provider to configure:
 *     → Anthropic • unconfigured
 *       OpenAI Codex ✓ stored
 *
 * Providers then split into two sign-in shapes, and both had to be handled —
 * the first version of this file only knew the device-code one and hung
 * forever on Anthropic. Device code (xAI):
 *
 *     Login to xAI
 *     https://accounts.x.ai/oauth2/device?user_code=8G95-72AD
 *     Cmd+click to open
 *     Enter code: 8G95-72AD
 *     Waiting for authentication...
 *
 * Loopback redirect (Anthropic) — no code, because pi runs a callback server
 * and the browser finishes the exchange by itself:
 *
 *     Login to Anthropic
 *     https://claude.ai/oauth/authorize?…&redirect_uri=http%3A%2F%2Flocalhost%3A53692%2Fcallback&…
 *     Cmd+click to open
 *     Complete login in your browser. If the browser is on another machine, …
 *
 * Two consequences worth knowing before editing:
 *
 * - The device code, where there is one, must reach the user — not just the
 *   URL, or they get a browser page they cannot complete.
 * - pi does **not** open the browser ("Cmd+click to open"), so pidex does.
 *   That is a feature: the login lands in the user's real browser, where they
 *   are already signed in, instead of an embedded view.
 */

/** How long to wait for each expected screen before giving up. */
const STEP_TIMEOUT_MS = 20_000
/** The whole flow, including however long the human takes in the browser. */
const FLOW_TIMEOUT_MS = 5 * 60_000
/** How often to re-read the terminal for a state change. */
const POLL_MS = 250
/** How often to ask pi whether the sign-in has landed. */
const VERIFY_INTERVAL_MS = 2_000
/** Width of the hidden terminal. See the note where the pty is created. */
const TERMINAL_COLS = 1000

const CR = String.fromCharCode(13)
/** Written to the pty to cancel a pending device-code request. */
const ESC = String.fromCharCode(27)

/**
 * A pty screen as plain text.
 *
 * Escape removal is `@shared/ansi`'s — this used to be a second, narrower
 * `stripAnsi` here (CSI plus terminated OSC only), which is exactly the kind
 * of near-duplicate that drifts. What is specific to reading a *screen* is the
 * carriage-return handling: the TUI redraws a line by returning to its start,
 * so a bare CR separates two states of the same row and must read as a line
 * break, not as a join.
 */
export function screenText(raw: string): string {
  return stripAnsi(raw).split('\r').join('\n')
}

/**
 * The authorization URL and its device code, if this screen is showing them.
 *
 * Matched independently rather than as one block: the URL and the `Enter code:`
 * line are several rows apart and the TUI redraws between them, so requiring
 * them adjacent would miss the frame where only one had painted.
 *
 * `userCode` is absent for providers that use a loopback redirect instead of a
 * device code (Anthropic does): pi listens on `localhost` and the browser
 * completes the sign-in by itself, so there is nothing for the user to type.
 *
 * The character class excludes non-ASCII deliberately — the TUI pads lines
 * with box-drawing rules, and `─` is not whitespace.
 */
export function parseAuthPrompt(screen: string): { url: string; userCode?: string } | null {
  const url = /https?:\/\/[!-~]*(?:oauth|auth|login|device|activate)[!-~]*/i.exec(screen)?.[0]
  if (!url) return null
  const userCode = /Enter code:\s*([A-Z0-9][A-Z0-9-]{3,})/i.exec(screen)?.[1]
  return userCode ? { url, userCode } : { url }
}

/**
 * Which screen the TUI is currently showing.
 *
 * Both sign-in shapes count as `awaiting-auth`, because from here they are the
 * same state — pi has produced a URL and is waiting on the browser:
 *
 * - device code (xAI): `Enter code: ABCD-1234` / `Waiting for authentication...`
 * - loopback redirect (Anthropic): `Complete login in your browser`, with pi
 *   listening on a `localhost` callback port
 */
export function classifyScreen(
  screen: string,
):
  'auth-method' | 'provider-list' | 'login-method' | 'host-question' | 'awaiting-auth' | 'unknown' {
  // Ordered most-specific first: the provider list and the auth prompt can
  // both still have the earlier prompt in scrollback above them.
  // `Cmd+click to open` is pi's own "here is a URL" affordance and the one
  // string every provider's prompt shares — the prose around it does not
  // (Anthropic says "Complete login", OpenRouter "Complete sign-in", xAI
  // neither). Ctrl+click on Linux. The wordier patterns stay as backstops in
  // case that hint is ever dropped.
  const awaitingAuth =
    /(?:Cmd|Ctrl)\+click to open/i.test(screen) ||
    /Waiting for authentication|Enter code:/i.test(screen) ||
    /Complete (?:log|sign)[\s-]?in in your browser/i.test(screen)
  if (awaitingAuth) return 'awaiting-auth'
  if (/GitHub Enterprise URL\/domain/i.test(screen)) return 'host-question'
  // Before provider-list: this screen still has the provider list above it.
  // Matched on the preselected option rather than the heading, because the
  // heading is per-provider prose ("Select OpenAI Codex login method:" vs
  // "Sign in to Radius:") while the browser option is worded consistently.
  if (/Browser login|Sign in with browser|Select .{0,40} login method:/i.test(screen)) {
    return 'login-method'
  }
  if (/Select provider to configure/i.test(screen)) return 'provider-list'
  if (/Select authentication method/i.test(screen)) return 'auth-method'
  return 'unknown'
}

/**
 * Providers pi offers on its "Sign in with an account" screen, keyed by the
 * label it renders. Typing the label filters the list, which is how a
 * provider is chosen without counting arrow-key presses against a list whose
 * order pi controls.
 */
const TUI_LABELS: Record<LoginProviderId, string> = {
  anthropic: 'Anthropic',
  'openai-codex': 'OpenAI Codex',
  'github-copilot': 'GitHub Copilot',
  'kimi-for-coding': 'Kimi For Coding',
  openrouter: 'OpenRouter',
  radius: 'Radius',
  xai: 'xAI',
}

export interface LoginFlowHandle {
  cancel: () => void
}

interface RunningFlow extends LoginFlowHandle {
  ptyId: string
}

const running = new Map<LoginProviderId, RunningFlow>()

/** Is a login already in flight for this provider? */
export function loginInFlight(providerId: LoginProviderId): boolean {
  return running.has(providerId)
}

/**
 * Drive `/login` for one provider, reporting each state change.
 *
 * `onState` is called with every transition; the caller broadcasts them. The
 * returned handle cancels the flow, which sends the TUI's own escape rather
 * than killing the pty outright — pi cleans up its pending device request
 * that way.
 */
export async function startLogin(
  providerId: LoginProviderId,
  onState: (state: LoginFlowState) => void,
): Promise<LoginFlowHandle> {
  if (running.has(providerId)) {
    throw new Error('A sign-in is already in progress for this provider.')
  }

  const label = TUI_LABELS[providerId]
  if (!label) throw new Error(`Unknown provider: ${providerId}`)

  const health = await checkPiHealth()
  if (!health.ok || !health.binaryPath) {
    throw new Error(health.message ?? 'pi is not available')
  }

  // Absurdly wide on purpose. Nothing renders this pty, but pi hard-wraps its
  // output to the reported width, and a wrapped URL is a *broken* URL — there
  // is no reliable way to rejoin continuation lines, because the break lands
  // mid-token with no marker. Anthropic's authorize URL is ~330 characters
  // (it carries a redirect_uri, scopes and a PKCE challenge), and 160 columns
  // split it across three lines. Wider than any URL is the fix.
  const { ptyId } = ptyManager.create(homedir(), TERMINAL_COLS, 40, undefined, {
    file: health.binaryPath,
    args: ['--no-session'],
    env: await piProcessEnv(),
  })

  let cancelled = false
  let settled = false
  let sentLogin = false
  let sentMethod = false
  let sentProvider = false
  let answeredHost = false
  let sentLoginMethod = false
  let lastAuth: { url: string; userCode?: string } | null = null
  let verifying = false
  let lastVerifyAt = 0
  let stepStartedAt = Date.now()
  const startedAt = Date.now()

  const emit = (state: LoginFlowState): void => {
    if (settled && state.phase !== 'cancelled') return
    if (state.phase === 'signed-in' || state.phase === 'error' || state.phase === 'cancelled') {
      settled = true
    }
    onState(state)
  }

  const finish = (state: LoginFlowState): void => {
    emit(state)
    running.delete(providerId)
    clearInterval(timer)
    ptyManager.kill(ptyId)
  }

  const timer = setInterval(() => {
    if (cancelled) return
    // `attach` is a pure read of the buffer — no side effects on the pty.
    const screen = screenText(ptyManager.attach(ptyId).scrollback)

    if (Date.now() - startedAt > FLOW_TIMEOUT_MS) {
      finish({ providerId, phase: 'error', message: 'Sign-in timed out.' })
      return
    }

    const step = classifyScreen(screen)

    // pi's TUI drops keystrokes typed before it has painted, and offers no
    // ready signal. Rather than the fixed delay this replaces, each step is
    // sent only once its own screen is actually on the terminal.
    if (!sentLogin) {
      // The prompt line is the first thing pi paints once it accepts input.
      if (/›|>|Describe|pi |MCP:/i.test(screen)) {
        sentLogin = true
        stepStartedAt = Date.now()
        ptyManager.write(ptyId, `/login${CR}`)
      }
    } else if (step === 'auth-method' && !sentMethod) {
      sentMethod = true
      stepStartedAt = Date.now()
      // "Sign in with an account" is preselected — subscription auth is the
      // whole point here, so Enter takes it.
      ptyManager.write(ptyId, CR)
    } else if (step === 'provider-list' && !sentProvider) {
      sentProvider = true
      stepStartedAt = Date.now()
      emit({ providerId, phase: 'starting' })
      // Filter by label rather than arrowing: pi controls the list order and
      // it changes as providers are added.
      ptyManager.write(ptyId, label)
      setTimeout(() => {
        if (!cancelled) ptyManager.write(ptyId, CR)
      }, 400)
    } else if (step === 'login-method' && !sentLoginMethod) {
      sentLoginMethod = true
      stepStartedAt = Date.now()
      // OpenAI Codex asks browser-vs-device-code. "Browser login" is both the
      // preselected default and the better fit here, since pidex opens the
      // user's real browser — where they are already signed in.
      ptyManager.write(ptyId, CR)
    } else if (step === 'host-question' && !answeredHost) {
      answeredHost = true
      stepStartedAt = Date.now()
      // Copilot asks for a GitHub Enterprise host, and blank means github.com —
      // which is the account almost everyone signing in here has. An Enterprise
      // host cannot be guessed, so that case takes the login-terminal escape
      // hatch, and the provider's caveat in auth-status.ts says so.
      ptyManager.write(ptyId, CR)
    } else if (step === 'awaiting-auth') {
      const auth = parseAuthPrompt(screen)
      // Re-emit only when it actually changes: the TUI repaints constantly and
      // a status that rewrites itself would restart the browser open.
      if (auth && (!lastAuth || auth.url !== lastAuth.url || auth.userCode !== lastAuth.userCode)) {
        lastAuth = auth
        stepStartedAt = Date.now()
        emit({ providerId, phase: 'awaiting-browser', url: auth.url, userCode: auth.userCode })
      }
    }

    // Completion is asked of pi, not read off the screen. The TUI announces
    // success in prose that could change wording at any release, whereas
    // `auth check` is the same fact the rest of pidex already trusts.
    // Throttled well below the poll rate: each check is a `pi` subprocess, and
    // the thing being waited on is a human in a browser.
    if (lastAuth && !verifying && Date.now() - lastVerifyAt >= VERIFY_INTERVAL_MS) {
      verifying = true
      lastVerifyAt = Date.now()
      void checkProviderAuth(providerId)
        .then((result) => {
          if (result.status === 'ready' && !settled) {
            finish({ providerId, phase: 'signed-in' })
          }
        })
        .catch(() => {
          /* transient; the next tick asks again */
        })
        .finally(() => {
          verifying = false
        })
    }

    // A step that never arrives is a real failure, not a hang. Skipped once
    // the browser has the URL, because that step waits on a human.
    if (!lastAuth && Date.now() - stepStartedAt > STEP_TIMEOUT_MS) {
      finish({
        providerId,
        phase: 'error',
        message:
          'pi stopped at a screen this sign-in does not know how to answer. ' +
          'Use “Open pi’s login terminal” below to finish it by hand.',
      })
    }
  }, POLL_MS)

  const handle: RunningFlow = {
    ptyId,
    cancel: () => {
      if (cancelled || settled) return
      cancelled = true
      // Escape lets pi tear down its pending device-code request; killing the
      // pty would leave that dangling on the provider's side.
      try {
        ptyManager.write(ptyId, ESC)
      } catch {
        /* pty already gone */
      }
      finish({ providerId, phase: 'cancelled' })
    },
  }

  running.set(providerId, handle)
  emit({ providerId, phase: 'starting' })
  return handle
}

/** Stop a flow started by `startLogin`. Safe when nothing is running. */
export function cancelLogin(providerId: LoginProviderId): void {
  running.get(providerId)?.cancel()
}

/** Called on teardown so a half-finished sign-in cannot outlive the window. */
export function cancelAllLogins(): void {
  for (const providerId of [...running.keys()]) cancelLogin(providerId as LoginProviderId)
}
