import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const piStub = join(repoRoot, 'e2e', 'fixtures', 'pi-stub.cjs')

interface Harness {
  app: ElectronApplication
  page: Page
  workspace: string
}

/**
 * Launch pidex against a deterministic pi stub in a scratch workspace.
 * Each test gets its own instance so no test can leave focus or pane state
 * that breaks the next one.
 */
/**
 * Scratch pi-agent dir for the whole e2e run, so stub sessions are never
 * written into the developer's real ~/.pi.
 */
const agentDir = mkdtempSync(join(tmpdir(), 'pidex-e2e-agent-'))

/**
 * A pi-agent dir of one test's own, for tests that seed `npm/node_modules`
 * with a fixture package.
 *
 * The shared `agentDir` above cannot be used for those. Several surfaces run a
 * REAL `npm install` into `<agentDir>/npm` — the MCP tab installs its adapter
 * package, and pi installs whatever `settings.json` declares — and npm owns
 * `node_modules` wholesale: it prunes anything absent from its own manifest,
 * which is exactly what a hand-written fixture directory is. The result was a
 * test that passed alone and failed in the suite, because the pruning install
 * only wins the race once npm's cache is warm from an earlier test.
 *
 * Isolating the dir is the fix rather than ordering the tests: it makes the
 * fixture unreachable by any other test's installer, in either direction.
 */
function privateAgentDir(): string {
  return mkdtempSync(join(tmpdir(), 'pidex-e2e-agent-solo-'))
}

/**
 * `process.env` minus electron-vite's dev markers.
 *
 * main.ts decides dev-vs-built purely from `ELECTRON_RENDERER_URL`, and that
 * variable is exported into every child of `npm run dev`. Running the e2e
 * suite from a shell descended from a dev server therefore launched the built
 * main against the DEV SERVER's renderer: the suite silently tested code that
 * was never built, so it passed for the wrong reasons and failed on changes it
 * had never loaded. Strip the markers so a launch here always means `out/`.
 */
function devServerEnvStripped(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.ELECTRON_RENDERER_URL
  delete env.NODE_ENV_ELECTRON_VITE
  delete env.ELECTRON_CLI_ARGS
  return env
}

async function launch(
  options: {
    workspace?: string
    userDataDir?: string
    /** Override the run-wide agent dir; see `privateAgentDir`. */
    agentDir?: string
    env?: Record<string, string>
  } = {},
): Promise<Harness> {
  const workspace = options.workspace ?? (await mkdtemp(join(tmpdir(), 'pidex-e2e-')))
  await writeFile(join(workspace, 'hello.ts'), 'export function hello() {\n  return "new"\n}\n')

  const app = await electron.launch({
    args: [repoRoot],
    env: {
      ...devServerEnvStripped(),
      NODE_ENV: 'production',
      PIDEX_PI_STUB: piStub,
      PIDEX_E2E_WORKSPACE: workspace,
      PIDEX_TEST_USER_DATA: options.userDataDir ?? '1',
      PI_CODING_AGENT_DIR: options.agentDir ?? agentDir,
      ...options.env,
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, workspace }
}

/**
 * Close the app and remove everything it created: the scratch workspace and
 * the isolated userData dir main.ts points at for E2E runs (named by pid).
 */
async function shutdown(harness: Harness): Promise<void> {
  const pid = harness.app.process().pid
  await harness.app.close()
  await rm(harness.workspace, { recursive: true, force: true })
  if (pid !== undefined) {
    await rm(join(tmpdir(), `pidex-e2e-${pid}`), { recursive: true, force: true })
  }
}

/**
 * Get to the workspace home.
 *
 * The app restores its last location on launch, so a run may land on the
 * picker OR straight into a restored session. Wait for whichever appears
 * rather than assuming the picker — assuming it made this flaky, with the
 * 30s wait burned before failing.
 */
async function openWorkspace(page: Page): Promise<void> {
  const picker = page.getByRole('button', { name: /Open Folder/i })
  const homeComposer = page.getByPlaceholder('Describe a task or ask a question')
  const chatComposer = page.getByPlaceholder(/Describe a task…/i)

  await expect(picker.or(homeComposer).or(chatComposer).first()).toBeVisible({ timeout: 30_000 })

  if (await picker.isVisible()) {
    await picker.click()
  } else if (await chatComposer.isVisible()) {
    // Restored into a session — get back to the home screen.
    await page.getByRole('button', { name: /^New$/ }).click()
  }
  await expect(homeComposer).toBeVisible({ timeout: 20_000 })
}

test('workspace → session → streamed answer, diff and artifact render', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)

    await page.getByPlaceholder('Describe a task or ask a question').fill('Update hello.ts')
    await page.getByRole('button', { name: /Start session/i }).click()

    // Streamed assistant text.
    await expect(page.getByText(/Done:\s*hello\.ts\s*updated\./)).toBeVisible({ timeout: 30_000 })

    // The settled activity run collapses to a summary; expand it.
    await page.getByTestId('activity-summary').first().click()

    // Edit tool card with its diff.
    const editRow = page
      .getByTestId('activity-group')
      .getByRole('button', { name: /Edited\s+hello\.ts/ })
    await expect(editRow).toBeVisible()
    await editRow.click()
    await expect(page.getByText('return "new"').first()).toBeVisible()

    // Files Changed panel.
    await page.getByTitle(/Changes pane/).click()
    await expect(page.getByText('Files changed')).toBeVisible()
    await expect(page.getByText('hello.ts').first()).toBeVisible()

    // Artifacts pane got the artifact from the tool result.
    await page.getByTitle('Artifacts pane').click()
    await expect(page.getByText('E2E Card').first()).toBeVisible({ timeout: 10_000 })
  } finally {
    await shutdown(harness)
  }
})

/** 1×1 transparent PNG, as base64. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('dropped chat images open on click and copy on right-click', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)

    // Drop the PNG onto the home composer's drop zone. A synthetic
    // DataTransfer is the only drivable way to attach in e2e (the native
    // picker is undriveable): a File built in JS has no real path, but
    // images travel inline as base64, so no path is ever needed.
    await page.evaluate((pngB64: string) => {
      const bytes = Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0))
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(new File([bytes], 'dot.png', { type: 'image/png' }))
      const zone = document
        .querySelector<HTMLTextAreaElement>(
          'textarea[placeholder="Describe a task or ask a question"]',
        )!
        .closest('div.relative')!
      zone.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }),
      )
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
    }, PNG_1X1)

    // The attachment is an openable, copyable control (the accessible name
    // comes from the img's alt; the hover ring and the contract title are
    // CSS/tooltip-only).
    const thumbnail = page.getByRole('button', { name: 'Attached image', exact: true })
    await expect(thumbnail).toBeVisible()

    // Right-click copies the image to the system clipboard — read back in the
    // MAIN process, which is where `clipboard:writeImage` lands and which is
    // invisible to the renderer.
    await thumbnail.click({ button: 'right' })
    await expect
      .poll(() =>
        harness.app.evaluate(({ clipboard }) =>
          clipboard.readImage().isEmpty() ? 0 : clipboard.readImage().toPNG().length,
        ),
      )
      .toBeGreaterThan(0)

    // Click opens the full-size lightbox; Escape closes it.
    await thumbnail.click()
    await expect(page.getByAltText('Attached image, full size')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByAltText('Attached image, full size')).toBeHidden()
  } finally {
    await shutdown(harness)
  }
})

/** 1800×200 PNG — the aspect ratio is the point; see the test below. */
const PNG_WIDE =
  'iVBORw0KGgoAAAANSUhEUgAABwgAAADIAQAAAADUp4gRAAAAyUlEQVR42u3PQREAAAwCIPuX1hJ77aAB6XcxNDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ8N6z0InrHKhrFAAAAAElFTkSuQmCC'

test('a pasted wide image stays inside the transcript column', async () => {
  // Regression: chat images were capped in HEIGHT only (`max-h-40`). A wide
  // screenshot — a cropped strip of a window, 9:1 here — therefore rendered
  // 160px tall and ~1440px wide inside a 720px column. The user-message row is
  // a `justify-end` flex line, so the overflow grew LEFTWARDS: across the rows
  // beside it, over the activity group's left edge, and then clipped off by
  // the scroller, leaving most of the image unviewable.
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)
    await page.getByPlaceholder('Describe a task or ask a question').fill('Update hello.ts')
    await page.getByRole('button', { name: /Start session/i }).click()
    await expect(page.getByText(/Done:\s*hello\.ts\s*updated\./)).toBeVisible({ timeout: 30_000 })

    // Paste, not drop: the drop path is covered above, and pasting a
    // screenshot is how this shape of image actually arrives.
    const composer = page.getByPlaceholder(/Describe a task…/i)
    await composer.click()
    await page.evaluate((pngB64: string) => {
      const bytes = Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0))
      const clipboardData = new DataTransfer()
      clipboardData.items.add(new File([bytes], 'wide.png', { type: 'image/png' }))
      document
        .querySelector<HTMLTextAreaElement>('textarea[placeholder^="Describe a task…"]')!
        .dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }),
        )
    }, PNG_WIDE)
    await expect(page.getByRole('button', { name: 'Attached image', exact: true })).toBeVisible()

    await composer.fill('look at this')
    await composer.press('Enter')

    const scroller = page.getByTestId('transcript-scroll')
    const image = scroller.getByAltText('Attached image')
    await expect(image).toBeVisible()

    // The assertion is geometric on purpose: the class list is not the
    // contract, "it fits in the column" is.
    const shown = (await image.boundingBox())!
    const column = (await scroller.boundingBox())!
    expect(shown.width).toBeLessThanOrEqual(column.width)
    expect(shown.x).toBeGreaterThanOrEqual(column.x)
    expect(shown.x + shown.width).toBeLessThanOrEqual(column.x + column.width)
  } finally {
    await shutdown(harness)
  }
})

test('right-hand pane controls stay clear of the OS window controls', async () => {
  // Regression: the pane header used to render its own expand/close buttons at
  // the top-right of the window, directly underneath the Window Controls
  // Overlay that Electron paints there on Windows/Linux — so "close pane" sat
  // on top of "close app". Only the chat header carried the inset padding, and
  // it stops spanning the window as soon as a pane opens.
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)
    await page.getByPlaceholder('Describe a task or ask a question').fill('Update hello.ts')
    await page.getByRole('button', { name: /Start session/i }).click()
    await expect(page.getByText(/Done:\s*hello\.ts\s*updated\./)).toBeVisible({ timeout: 30_000 })

    await page.getByTitle(/Terminal pane/).click()
    const closePane = page.getByRole('button', { name: 'Close pane' })
    await expect(closePane).toBeVisible({ timeout: 10_000 })

    // The pane's own chrome must start below the title bar, which is the one
    // element allowed to occupy the strip the OS draws its buttons in.
    const titleBarBottom = await page
      .locator('header.titlebar-drag')
      .first()
      .evaluate((el) => el.getBoundingClientRect().bottom)
    const paneButton = await closePane.evaluate((el) => el.getBoundingClientRect().top)
    expect(paneButton).toBeGreaterThanOrEqual(titleBarBottom)
  } finally {
    await shutdown(harness)
  }
})

test('settings modal switches theme and reports versions', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)

    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.getByRole('button', { name: 'Light', exact: true }).click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)

    await page.getByRole('button', { name: 'About', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'About pidex' })).toBeVisible()
    await expect(page.getByText('pidex version')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'About pidex' })).toBeHidden()
  } finally {
    await shutdown(harness)
  }
})

test('command palette opens with the keyboard shortcut', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
    const palette = page.getByPlaceholder('Type a command…')
    await expect(palette).toBeVisible({ timeout: 10_000 })

    // Right-pane commands are session-scoped: the pane is rendered by
    // MainWithPanes, which requires an active session, so offering them on the
    // home screen was a no-op that also desynced the pane state.
    await palette.fill('terminal')
    await expect(page.getByText('Toggle terminal')).toBeHidden()

    // A command that is always available still resolves, so this is testing
    // the filter and not just an empty palette.
    await palette.fill('sidebar')
    await expect(page.getByText('Toggle sidebar')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden()
  } finally {
    await shutdown(harness)
  }
})

test('terminal pane spawns a real shell, and reopening replays its scrollback', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)

    // Start a session so the pane toggles are available.
    await page.getByPlaceholder('Describe a task or ask a question').fill('hello')
    await page.getByRole('button', { name: /Start session/i }).click()
    await expect(page.getByText(/Done:\s*hello\.ts\s*updated\./)).toBeVisible({ timeout: 30_000 })

    const toggleTerminal = async (): Promise<void> => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+`' : 'Control+`')
    }

    await toggleTerminal()
    await expect(page.getByText('Terminal', { exact: true })).toBeVisible({ timeout: 15_000 })
    // xterm renders into a canvas/rows container once the PTY is attached.
    await expect(page.locator('.xterm').first()).toBeVisible({ timeout: 15_000 })
    // A spawn failure leaves the pane on this forever, which is exactly the
    // regression: assert we got past it rather than just that chrome rendered.
    await expect(page.getByText('Starting shell…')).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText('Could not start a shell')).toBeHidden()

    // Prove the shell is real and talking back.
    const marker = 'pidex_marker_7f3a'
    await page.locator('.xterm').first().click()
    await page.keyboard.type(`echo ${marker}`)
    await page.keyboard.press('Enter')
    await expect(page.locator('.xterm-rows')).toContainText(marker, { timeout: 15_000 })

    // Copying is entirely ours: xterm ships no copy binding and its selection
    // is invisible to the browser, so nothing else can put it on the clipboard.
    await page.locator('.xterm').first().click({ button: 'right' })
    // Named by its shortcut so this cannot match the chat's own Copy buttons.
    await expect(page.getByRole('button', { name: /^Copy\s+(Ctrl\+Shift\+C|⌘C)$/ })).toBeVisible()
    await page.getByRole('button', { name: 'Select all' }).click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+Shift+C')
    await expect
      .poll(() => harness.app.evaluate(({ clipboard }) => clipboard.readText()), {
        timeout: 10_000,
      })
      .toContain(marker)

    // Closing the pane disposes the xterm but keeps the PTY; reopening must
    // replay main's scrollback instead of showing a blank pane in front of a
    // live shell.
    await toggleTerminal()
    await expect(page.locator('.xterm')).toHaveCount(0)
    await toggleTerminal()
    await expect(page.locator('.xterm-rows')).toContainText(marker, { timeout: 15_000 })
  } finally {
    await shutdown(harness)
  }
})

test('the right pane is per session, so a terminal does not follow you', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)

    // Two sessions in the same workspace.
    await page.getByPlaceholder('Describe a task or ask a question').fill('first')
    await page.getByRole('button', { name: /Start session/i }).click()
    await expect(page.getByText(/Done:\s*hello\.ts\s*updated\./)).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: /^New$/ }).click()
    await page.getByPlaceholder('Describe a task or ask a question').fill('second')
    await page.getByRole('button', { name: /Start session/i }).click()
    await expect(page.getByText(/Done:\s*hello\.ts\s*updated\./)).toBeVisible({ timeout: 30_000 })

    // Open a terminal in the SECOND session.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+`' : 'Control+`')
    await expect(page.getByText('Terminal', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.xterm').first()).toBeVisible({ timeout: 15_000 })

    // Switching to the first session must NOT bring the pane along. It used to:
    // rightPane was global, so the pane opened everywhere and — because first
    // open auto-spawns — silently forked a login shell in every session you
    // visited.
    // The stub names every session "stub session", so rows are identified by
    // order (sidebar is newest-first) and the switch is confirmed by the user
    // bubble — otherwise a hidden Terminal could just mean the click missed.
    const rows = page.getByTestId('session-row')
    await expect(rows).toHaveCount(2, { timeout: 20_000 })
    const terminalTitle = page.getByText('Terminal', { exact: true })

    await rows.nth(1).click()
    await expect(page.getByText('first', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(terminalTitle).toBeHidden({ timeout: 10_000 })

    // …and coming back restores it, with its shell intact.
    await rows.nth(0).click()
    await expect(page.getByText('second', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(terminalTitle).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.xterm').first()).toBeVisible({ timeout: 10_000 })
  } finally {
    await shutdown(harness)
  }
})

test('tool run: grouping, in-flight animation, and clean streaming', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)
    await page.getByPlaceholder('Describe a task or ask a question').fill('Update hello.ts')
    await page.getByRole('button', { name: /Start session/i }).click()

    // The in-flight window is short, so watch for it with a MutationObserver
    // rather than polling — a poll can straddle the whole window and miss it.
    // Also capture whether a LIVE activity group was expanded at the time,
    // which is the live-vs-settled behavior (open while working).
    await page.evaluate(() => {
      const w = window as unknown as {
        __sawRunning?: boolean
        __sawWorkingIndicator?: boolean
        __liveOpen?: string
      }
      const workingIndicator = () =>
        /\d[\d.]*(ms|s)\s*·\s*[\d.]+[kM]?\s*tokens/.test(document.body.innerText) &&
        document.querySelector('.pi-spark') !== null
      w.__sawRunning = document.querySelector('.tool-running-dot') !== null
      w.__sawWorkingIndicator = workingIndicator()
      new MutationObserver(() => {
        if (document.querySelector('.tool-running-dot')) w.__sawRunning = true
        if (workingIndicator()) w.__sawWorkingIndicator = true
        const live = document.querySelector('[data-testid="activity-group"][data-live="true"]')
        if (live && w.__liveOpen === undefined) {
          w.__liveOpen =
            live.querySelector('[data-testid="activity-summary"]')?.getAttribute('aria-expanded') ??
            'missing'
        }
      }).observe(document.body, { childList: true, subtree: true, attributes: true })
    })

    await expect(page.getByText(/Done:\s*hello\.ts\s*updated\./)).toBeVisible({ timeout: 30_000 })

    // The running affordance appeared while tools were executing…
    expect(
      await page.evaluate(() => (window as unknown as { __sawRunning: boolean }).__sawRunning),
    ).toBe(true)
    // …and is gone now that the run finished.
    await expect(page.locator('.tool-running-dot')).toHaveCount(0)

    // The persistent working strip (elapsed time · tokens, Claude-Code-style)
    // appeared above the composer during the run and disappears once done.
    expect(
      await page.evaluate(
        () => (window as unknown as { __sawWorkingIndicator: boolean }).__sawWorkingIndicator,
      ),
    ).toBe(true)
    await expect(page.getByText(/tokens$/)).toBeHidden()

    // Live vs settled: the group was expanded while work was in flight…
    expect(
      await page.evaluate(() => (window as unknown as { __liveOpen?: string }).__liveOpen),
    ).toBe('true')

    // Settled runs collapse to a verb-counted summary. Counting (rather than
    // listing every call) is what keeps an 18-deep run to one line.
    const summary = page.getByTestId('activity-summary').first()
    await expect(summary).toBeVisible()
    // …and auto-collapsed once it settled.
    await expect(summary).toHaveAttribute('aria-expanded', 'false')
    await expect(summary).toContainText(/step/)
    await expect(summary).toContainText(/edited 1 file/)
    await expect(summary).toContainText(/ran 1 command/)

    // The whole run is ONE group even though pi sent one message per tool
    // call — this is the regression that made runs march down the page.
    await expect(page.getByTestId('activity-group')).toHaveCount(1)

    // Expanding shows the individual calls as rows.
    await summary.click()
    const group = page.getByTestId('activity-group')
    await expect(group.getByRole('button', { name: /Edited\s+hello\.ts/ })).toBeVisible()
    await expect(group.getByRole('button', { name: /Ran/ })).toBeVisible()

    // Placeholder tool names never surface (pi ≥0.84 omits the name until
    // toolcall_end).
    await expect(page.getByText(/unknown/)).toHaveCount(0)

    // Per-message cost is gone from the transcript.
    await expect(page.locator('text=/\\$\\d+\\.\\d{4}/')).toHaveCount(0)

    // Streaming repair: the transcript briefly contained "**hello.ts" before
    // its closing marker arrived. Raw asterisks must never survive to the DOM.
    const transcript = await page.locator('.md-content').allInnerTexts()
    expect(transcript.join('\n')).not.toContain('**')

    // Spacing: ONE step (`STREAM_GAP`, 8px), owned by the row wrapper and
    // nothing else. Every row either leads with that step or, being the
    // first, leads with nothing — a row carrying some third value means a
    // second owner of vertical space came back.
    const gaps = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('[data-index]')] as HTMLElement[]
      return nodes.slice(0, 4).map((n) => {
        const inner = n.firstElementChild as HTMLElement | null
        return inner ? parseFloat(getComputedStyle(inner).paddingTop) : 0
      })
    })
    expect(gaps.some((gap) => gap === 8)).toBe(true)
    expect(gaps.filter((gap) => gap !== 0 && gap !== 8)).toEqual([])

    // Extension status line arrived styled with ANSI SGR codes; the strip
    // must show clean (optionally colored) text, never raw escape bytes.
    const statusText = await page.getByText(/MCP: 2 servers enabled/).innerText()
    expect(statusText).not.toContain('[38;2')
    expect(statusText).not.toContain('\u001b')
  } finally {
    await shutdown(harness)
  }
})

test('worktree flow: create from the branch chip, session stays under the project group', async () => {
  // The workspace must be a git repo BEFORE the app queries git:info.
  const workspace = await mkdtemp(join(tmpdir(), 'pidex-e2e-wt-'))
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  await writeFile(join(workspace, 'hello.ts'), 'export function hello() {\n  return "new"\n}\n')
  await run('git', ['init', '-b', 'main'], { cwd: workspace })
  await run('git', ['config', 'user.email', 'e2e@pidex.dev'], { cwd: workspace })
  await run('git', ['config', 'user.name', 'pidex e2e'], { cwd: workspace })
  await run('git', ['add', '-A'], { cwd: workspace })
  await run('git', ['commit', '-m', 'initial'], { cwd: workspace })

  const harness = await launch({ workspace })
  const { page } = harness
  try {
    await openWorkspace(page)

    // Create a worktree from the top bar's branch control.
    await page.getByTestId('branch-chip').click()
    await page.getByRole('button', { name: 'New branch…' }).click()
    await page.getByPlaceholder('new branch name').fill('task-1')
    await page.getByRole('button', { name: 'Create worktree' }).click()

    // Chip now targets the worktree.
    await expect(page.getByTestId('branch-chip')).toContainText('task-1', { timeout: 10_000 })

    // Start a session from the home composer. It does NOT continue on task-1:
    // a new chat gets its own branch off trunk, so this lands in a second
    // worktree.
    await page.getByPlaceholder('Describe a task or ask a question').fill('Update hello.ts')
    await page.getByRole('button', { name: /Start session/i }).click()
    await expect(page.getByText(/Done:\s*hello\.ts\s*updated\./)).toBeVisible({ timeout: 30_000 })

    // The folder is slugged from the FIRST MESSAGE, not from the generated
    // title, because the branch is now cut before the naming model is asked —
    // that inversion is what keeps the send button from blocking on a ~13s
    // subprocess. The folder never changes afterwards: it is a live session's
    // cwd, and moving it would break the session's binding to its transcript.
    expect(existsSync(join(workspace, '.pidex', 'worktrees', 'update-hello-ts'))).toBe(true)

    // ...and then the name lands and the BRANCH is renamed to match it, so the
    // branch chip and the session title still agree. "Stub Session Title" is
    // the stub's deterministic answer to the naming prompt.
    await expect(page.getByTestId('branch-chip')).toContainText('pidex/stub-session-title', {
      timeout: 30_000,
    })
    // The generated name reaches both surfaces. Two locators, not one
    // `getByText`: the stub now persists a rename as `session_info` (as pi
    // does), so the sidebar row reads the name off disk as well and a bare
    // text match is ambiguous.
    await expect(page.getByRole('banner').getByText('Stub Session Title')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByTestId('session-row').first()).toContainText('Stub Session Title', {
      timeout: 15_000,
    })

    const branches = await run('git', ['branch', '--format=%(refname:short)'], { cwd: workspace })
    const names = branches.stdout.split('\n').map((b) => b.trim())
    expect(names).toContain('pidex/stub-session-title')
    // Renamed, not duplicated: the provisional slug branch is gone.
    expect(names).not.toContain('pidex/update-hello-ts')

    // The "still being named" treatment must CLEAR. Catching the shimmer while
    // it is up would be racing a sub-second window, but a stuck one is the
    // failure that actually matters: `.name-pending` paints its glyphs with a
    // transparent fill over a moving gradient, so a flag that never resets
    // leaves every session title permanently animated.
    await expect(page.locator('.name-pending')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByTestId('branch-chip')).not.toHaveAttribute('title', /provisional/)

    // Still one sidebar group for the project (not a header per branch); the
    // worktree is surfaced on the session row itself instead.
    await expect(page.getByTestId('workspace-group')).toHaveCount(1, { timeout: 15_000 })
    await expect(page.getByTitle('Runs in a git worktree')).toBeVisible({ timeout: 15_000 })

    // The top bar's branch control marks the worktree.
    await expect(page.getByTitle(/Worktree of/)).toBeVisible({ timeout: 10_000 })

    // ...and the folder chip beside it still names the PROJECT. The reported
    // bug: with a worktree session open it showed the worktree folder's own
    // basename — the branch slug — so the top bar read as if the user had
    // switched to a workspace called "update-hello-ts".
    const folderChip = page.getByRole('banner').getByTestId('workspace-chip')
    await expect(folderChip).toContainText(basename(workspace), { timeout: 10_000 })
    await expect(folderChip).not.toContainText('update-hello-ts')
    await expect(folderChip).not.toContainText('stub-session-title')
  } finally {
    await shutdown(harness)
  }
})

test('a session whose file lands late still becomes a real, right-clickable row', async () => {
  // The reported bug: right-click did nothing on a chat you had just started,
  // and kept doing nothing until you clicked away to another session and back.
  //
  // The cause was never the menu. A live session with no row in `disk` yet
  // renders as `PendingSessionRow`, which deliberately has no context menu at
  // all (every SessionRow action is keyed on `meta.path`, which it lacks). It
  // should be a flicker — except the directory watcher that promotes it was
  // attached to a session directory that did not exist yet, and chokidar never
  // revisits a missing target. So the promotion never came.
  //
  // The delay is what makes this a real test: with the stub writing its
  // session file synchronously the directory is always there before pidex can
  // attach, and this passes against the unfixed code too (confirmed).
  const workspace = await mkdtemp(join(tmpdir(), 'pidex-e2e-late-'))
  await writeFile(join(workspace, 'hello.ts'), 'export function hello() {\n  return "new"\n}\n')

  const harness = await launch({
    workspace,
    env: { PIDEX_E2E_SESSION_WRITE_DELAY_MS: '2500' },
  })
  const { page } = harness
  try {
    await openWorkspace(page)
    await page.getByPlaceholder('Describe a task or ask a question').fill('hello')
    await page.getByRole('button', { name: /Start session/i }).click()

    const row = page.getByTestId('session-row').first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    // Promoted out of the placeholder WITHOUT switching session and back.
    await expect(row).not.toHaveAttribute('data-pending', 'true', { timeout: 30_000 })

    await row.click({ button: 'right' })
    // Any SessionRow-only action proves the promotion: `PendingSessionRow` has
    // no context menu at all. (Rename is not in this menu — it is an inline
    // edit on the row, covered by the next test.)
    await expect(
      page.getByTestId('context-menu').getByRole('button', { name: /^Fork/ }),
    ).toBeVisible({ timeout: 10_000 })
  } finally {
    await shutdown(harness)
  }
})

test('double-clicking a sidebar row renames the session inline', async () => {
  // Rename used to be a modal behind two popovers. It is now an inline input
  // on the row itself, which only works if three things hold: the field takes
  // focus and real keystrokes, the commit reaches pi, and the sidebar re-reads
  // the name afterwards — the row's title comes from the session file on disk,
  // not from renderer state, so a rename that never persists appears to revert
  // (verified: dropping the stub's `session_info` write fails this test).
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)
    await page.getByPlaceholder('Describe a task or ask a question').fill('hello')
    await page.getByRole('button', { name: /Start session/i }).click()

    // Let auto-naming finish first: it lands seconds after the first reply and
    // would otherwise overwrite the rename mid-test.
    const row = page.getByTestId('session-row').first()
    await expect(row).toContainText('Stub Session Title', { timeout: 30_000 })
    await expect(page.locator('.name-pending')).toHaveCount(0, { timeout: 15_000 })

    await row.dblclick()
    const input = page.getByLabel('Session name')
    await expect(input).toBeVisible({ timeout: 10_000 })
    await expect(input).toBeFocused()

    // Pre-filled with the current name and pre-selected, so typing replaces it.
    await expect(input).toHaveValue('Stub Session Title')
    // Real mouse click + real keystrokes, not `fill()`: `fill()` focuses the
    // element itself and would pass even if the row swallowed the click.
    await input.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Renamed inline')
    await expect(input).toHaveValue('Renamed inline')
    await page.keyboard.press('Enter')

    // Committed through pi and read back from the session file, not just held
    // in renderer state: the stub records the rename as `session_info`, which
    // is what the sidebar scanner reads.
    await expect(row).toContainText('Renamed inline', { timeout: 15_000 })
    await expect(page.getByLabel('Session name')).toHaveCount(0)

    // Escape abandons a second edit.
    await row.dblclick()
    await page.getByLabel('Session name').fill('Not this one')
    await page.getByLabel('Session name').press('Escape')
    await expect(row).toContainText('Renamed inline', { timeout: 10_000 })
  } finally {
    await shutdown(harness)
  }
})

test('new chat without isolation runs in the open workspace', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'pidex-e2e-nowt-'))
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  await writeFile(join(workspace, 'hello.ts'), 'export function hello() {\n  return "new"\n}\n')
  await run('git', ['init', '-b', 'main'], { cwd: workspace })
  await run('git', ['config', 'user.email', 'e2e@pidex.dev'], { cwd: workspace })
  await run('git', ['config', 'user.name', 'pidex e2e'], { cwd: workspace })
  await run('git', ['add', '-A'], { cwd: workspace })
  await run('git', ['commit', '-m', 'initial'], { cwd: workspace })

  const harness = await launch({ workspace })
  const { page } = harness
  try {
    await openWorkspace(page)

    // Untick the composer's "new branch" box: the chat should then run on the
    // branch that is already checked out, creating nothing.
    await page.getByRole('checkbox', { name: 'new branch' }).uncheck()
    await page.getByPlaceholder('Describe a task or ask a question').fill('Update hello.ts')
    await page.getByRole('button', { name: /Start session/i }).click()
    await expect(page.getByText(/Done:\s*hello\.ts\s*updated\./)).toBeVisible({ timeout: 30_000 })

    await expect(page.getByTestId('branch-chip')).toContainText('main', { timeout: 15_000 })
    const branches = await run('git', ['branch', '--format=%(refname:short)'], { cwd: workspace })
    expect(branches.stdout.trim()).toBe('main')
    expect(existsSync(join(workspace, '.pidex'))).toBe(false)
  } finally {
    await shutdown(harness)
  }
})

test('MCP settings: chain rows, disable toggle, add project server', async () => {
  // Seed a global server in an agent dir of this test's own. Shared would leak:
  // this `mcp.json` is never cleaned up, and every later test would inherit a
  // global MCP server it did not ask for.
  const soloAgentDir = privateAgentDir()
  await writeFile(
    join(soloAgentDir, 'mcp.json'),
    JSON.stringify({ mcpServers: { linear: { url: 'https://mcp.linear.app/sse' } } }),
  )
  // Dedicated prefs dir: project-scope writes target the ACTIVE workspace, so
  // a `lastSessionPath` left by an earlier test could restore a different
  // workspace and send the write there.
  const harness = await launch({
    agentDir: soloAgentDir,
    userDataDir: await mkdtemp(join(tmpdir(), 'pidex-e2e-mcp-')),
  })
  const { page, workspace } = harness
  try {
    await openWorkspace(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'MCP', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'MCP servers' })).toBeVisible({
      timeout: 10_000,
    })

    // The seeded global server resolves into the list.
    await expect(page.getByText('linear', { exact: true })).toBeVisible()
    await expect(page.getByText('https://mcp.linear.app/sse').first()).toBeVisible()

    // Disable writes `"disabled": true` into the owning file. Plain click:
    // the checkbox is controlled and only re-renders after the IPC round
    // trip, which uncheck()'s immediate post-click assertion would race.
    await page.getByRole('checkbox').first().click()
    await expect
      .poll(async () => {
        const raw = await readFile(join(soloAgentDir, 'mcp.json'), 'utf8')
        return (JSON.parse(raw).mcpServers.linear as { disabled?: boolean }).disabled === true
      })
      .toBe(true)

    // Add a project-scoped stdio server → workspace/.pi/mcp.json is written.
    await page.getByRole('button', { name: 'Add server…' }).click()
    await page.getByPlaceholder('server name (e.g. linear)').fill('local-tools')
    await page.getByRole('radio', { name: 'Local command' }).check()
    await page.getByPlaceholder('npx some-mcp-server --flag').fill('npx local-tools-mcp')
    await page.getByRole('radio', { name: /This project/ }).check()
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    await expect
      .poll(async () => {
        try {
          const raw = await readFile(join(workspace, '.pi', 'mcp.json'), 'utf8')
          return (JSON.parse(raw).mcpServers['local-tools'] as { command?: string }).command
        } catch {
          return null
        }
      })
      .toBe('npx')
  } finally {
    await shutdown(harness)
    await rm(soloAgentDir, { recursive: true, force: true })
  }
})

test('Connectors: adding a catalog connector writes a verified OAuth endpoint', async () => {
  // Own agent dir: this writes a global mcp.json, which nothing cleans up.
  const soloAgentDir = privateAgentDir()
  const harness = await launch({
    agentDir: soloAgentDir,
    userDataDir: await mkdtemp(join(tmpdir(), 'pidex-e2e-connectors-')),
  })
  const { page } = harness
  try {
    await openWorkspace(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Connectors', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Connectors' })).toBeVisible({
      timeout: 10_000,
    })

    // Datadog is the interesting row: its endpoint is per site, so the choice
    // has to reach the written config rather than defaulting silently.
    const datadog = page.getByTestId('connector-datadog')
    await datadog.getByRole('combobox').selectOption('eu1')
    await datadog.getByRole('button', { name: 'Add', exact: true }).click()

    await expect
      .poll(async () => {
        try {
          const raw = await readFile(join(soloAgentDir, 'mcp.json'), 'utf8')
          return JSON.parse(raw).mcpServers.datadog as Record<string, unknown>
        } catch {
          return null
        }
      })
      .toEqual({ url: 'https://mcp.datadoghq.eu/v1/mcp', auth: 'oauth' })
  } finally {
    await shutdown(harness)
    await rm(soloAgentDir, { recursive: true, force: true })
  }
})

test('reopens the last session on relaunch instead of the picker', async () => {
  // Both launches share a userData dir so prefs survive the restart, while
  // staying isolated from the developer's real config.
  const userDataDir = await mkdtemp(join(tmpdir(), 'pidex-e2e-prefs-'))
  const workspace = await mkdtemp(join(tmpdir(), 'pidex-e2e-'))

  try {
    // First launch: open the workspace and start a session.
    const first = await launch({ workspace, userDataDir })
    try {
      await openWorkspace(first.page)
      await first.page.getByPlaceholder('Describe a task or ask a question').fill('hello')
      await first.page.getByRole('button', { name: /Start session/i }).click()
      // Session is live once the chat composer replaces the greeting composer.
      await expect(first.page.getByPlaceholder(/Describe a task…/i)).toBeVisible({
        timeout: 20_000,
      })
      // …but "live" is not "persisted": the session file path arrives with
      // get_state, after the composer renders. Closing before that lands
      // leaves no lastSessionPath and the relaunch falls back to home —
      // which is exactly how this test failed on (slower) Linux CI.
      //
      // `:not([data-pending])` is load-bearing. A live session gets a
      // PLACEHOLDER row (`PendingSessionRow`) the moment it is created, and
      // that row carries the same `session-row` testid — so a bare match was
      // satisfied before the session file existed, and the guard proved
      // nothing. It only held because starting a chat used to be slow enough
      // that the disk write won the race anyway; taking ~0.9s of git off the
      // send path made it lose. The disk-backed row is the actual signal.
      await expect(
        first.page.locator('[data-testid="session-row"]:not([data-pending])').first(),
      ).toBeVisible({ timeout: 20_000 })
    } finally {
      await first.app.close()
    }

    // Second launch: must land straight in that session, no picker.
    const second = await launch({ workspace, userDataDir })
    try {
      await expect(second.page.getByPlaceholder(/Describe a task…/i)).toBeVisible({
        timeout: 30_000,
      })
      await expect(second.page.getByRole('button', { name: /Open Folder/i })).toBeHidden()
    } finally {
      await second.app.close()
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('sidebar groups sessions from several workspaces and badges pinned rows', async () => {
  // Two projects, one shared prefs store so both stay in "known workspaces".
  const userDataDir = await mkdtemp(join(tmpdir(), 'pidex-e2e-prefs-'))
  const workspaceA = await mkdtemp(join(tmpdir(), 'pidex-e2e-a-'))
  const workspaceB = await mkdtemp(join(tmpdir(), 'pidex-e2e-b-'))
  const nameA = workspaceA.split('/').pop()!
  const nameB = workspaceB.split('/').pop()!

  try {
    // Session in workspace A.
    const first = await launch({ workspace: workspaceA, userDataDir })
    try {
      await openWorkspace(first.page)
      await first.page.getByPlaceholder('Describe a task or ask a question').fill('work in A')
      await first.page.getByRole('button', { name: /Start session/i }).click()
      await expect(first.page.getByPlaceholder(/Describe a task…/i)).toBeVisible({
        timeout: 20_000,
      })
      // A live composer is not a persisted session: the file path arrives with
      // get_state, after the composer renders, and closing before it lands
      // leaves no lastSessionPath — so the relaunch below opens the picker and
      // never restores A. Same race the relaunch test guards against; wait for
      // the sidebar row, which only appears once the session is on disk.
      await expect(first.page.getByTestId('session-row').first()).toBeVisible({
        timeout: 20_000,
      })
    } finally {
      await first.app.close()
    }

    // Session in workspace B — A must remain listed alongside it.
    const second = await launch({ workspace: workspaceB, userDataDir })
    try {
      // The app restores A's session, so explicitly switch to B via the
      // workspace switcher — the same path a user takes.
      await expect(second.page.getByPlaceholder(/Describe a task…/i)).toBeVisible({
        timeout: 30_000,
      })
      await second.page.getByRole('button', { name: /^New$/ }).click()
      await expect(second.page.getByTestId('workspace-chip')).toBeVisible({ timeout: 20_000 })
      await second.page.getByTestId('workspace-chip').click()
      await second.page.getByText('Open folder…').click()
      await expect(second.page.getByPlaceholder('Describe a task or ask a question')).toBeVisible({
        timeout: 20_000,
      })
      await second.page.getByPlaceholder('Describe a task or ask a question').fill('work in B')
      await second.page.getByRole('button', { name: /Start session/i }).click()
      await expect(second.page.getByPlaceholder(/Describe a task…/i)).toBeVisible({
        timeout: 20_000,
      })

      // Both workspaces appear as sidebar groups.
      const groups = second.page.getByTestId('workspace-group')
      await expect(groups.filter({ hasText: nameA })).toBeVisible({ timeout: 20_000 })
      await expect(groups.filter({ hasText: nameB })).toBeVisible()

      // Starting in B must not promote it over A. The header overflow menu is
      // the sole control that changes the user-defined workspace order.
      await expect(groups).toHaveCount(2)
      expect(await groups.allTextContents()).toEqual([nameA, nameB])
      const groupB = groups.filter({ hasText: nameB })
      await groupB.locator('..').getByTestId('workspace-group-menu').click()
      await second.page.getByRole('button', { name: 'Move up' }).click()
      expect(await groups.allTextContents()).toEqual([nameB, nameA])

      // Pin a session from B's group; it moves to Pinned and gains a
      // workspace badge — the badge is what identifies a project once the
      // group no longer does.
      const sessionRow = second.page
        .locator(`[data-testid="session-row"][data-workspace="${nameB}"]`)
        .first()
      await sessionRow.click({ button: 'right' })
      await second.page.getByRole('button', { name: /^Pin$/ }).click()

      await expect(second.page.getByText('Pinned')).toBeVisible()
      const badge = second.page.getByTestId('session-workspace-badge').first()
      await expect(badge).toBeVisible()
      await expect(badge).toHaveText(nameB)
    } finally {
      await second.app.close()
    }
  } finally {
    await rm(workspaceA, { recursive: true, force: true })
    await rm(workspaceB, { recursive: true, force: true })
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('home composer: grey focus border, top-bar chip popovers, and model picker', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)

    const composer = page.getByPlaceholder('Describe a task or ask a question')
    const card = page.locator('.composer-field').first().locator('..')

    // Regression: focus must never draw the accent ring. The global
    // :focus-visible rule used to paint a 2px orange outline over the whole
    // composer; the card's own border is the only focus signal.
    await composer.click()
    await expect(composer).toBeFocused()
    const focusOutline = await composer.evaluate((el) => getComputedStyle(el).outlineStyle)
    expect(focusOutline).toBe('none')

    // Border shifts one small step on focus, and stays grey (r≈g≈b) rather
    // than picking up the terracotta accent.
    const focused = await card.evaluate((el) => {
      // Settle the colour transition before sampling.
      return new Promise<string>((resolve) => {
        setTimeout(() => resolve(getComputedStyle(el).borderTopColor), 600)
      })
    })
    const [r, g, b] = focused.match(/\d+/g)!.map(Number) as [number, number, number]
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(24)

    // Every chip opens a popover. (The informational "Local" chip was removed —
    // pidex only ever runs pi as a local subprocess. On the home screen the
    // folder and branch chips sit above the composer and the top bar shows
    // neither, so "which folder / which branch" still has exactly one answer.)
    await expect(page.getByRole('banner').getByTestId('workspace-chip')).toHaveCount(0)
    await page.getByTestId('workspace-chip').click()
    await expect(page.getByText(/Open folder/)).toBeVisible()
    // PopupMenu dismisses on outside mousedown.
    await page.mouse.click(20, 400)
    await expect(page.getByText(/Open folder/)).toBeHidden()

    // Attachment affordance is present next to the pickers.
    await expect(page.getByRole('button', { name: 'Attach files' })).toBeVisible()
  } finally {
    await shutdown(harness)
  }
})

test('model picker: lexical search across providers, family grouping, stars', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)

    await page.getByTestId('home-model-picker').click()
    const search = page.getByTestId('model-search')
    await expect(search).toBeVisible()
    const rows = page.getByTestId('model-row')

    // The catalogue offers Claude Opus 5 four ways: pi's native provider, the
    // Claude Code CLI provider, and two Bedrock entries. One family header,
    // four routes — the case a flat list of identical names cannot express.
    await search.fill('opus')
    await expect(rows).toHaveCount(4)
    // The header is uppercased in CSS only, so match the underlying text.
    await expect(page.getByTestId('model-list')).toContainText('Claude Opus 5')
    // Every row names its provider, because the display names are identical.
    await expect(rows.nth(0)).toContainText('anthropic')

    // Terms AND together in any order, and `aws` resolves to amazon-bedrock —
    // a provider nobody spells out in full.
    await search.fill('opus aws')
    await expect(rows).toHaveCount(2)
    await expect(rows.filter({ hasText: 'amazon-bedrock' })).toHaveCount(2)
    await search.fill('aws opus')
    await expect(rows).toHaveCount(2)

    // The bare Bedrock foundation id stays visible and stays unselectable:
    // hiding it would make "where did Opus go?" unanswerable.
    await expect(rows.filter({ hasText: /inference profile/ })).toHaveCount(1)
    await expect(rows.first()).toBeDisabled()

    // Separators are noise.
    await search.fill('opus-5')
    await expect(rows).toHaveCount(4)

    // Negation and field qualifiers.
    await search.fill('opus -aws')
    await expect(rows).toHaveCount(2)
    await search.fill('provider:openai')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveAttribute('title', 'openai/gpt-5')

    // A miss says so rather than falling back to the whole catalogue.
    await search.fill('llama')
    await expect(rows).toHaveCount(0)
    await expect(page.getByText(/No models match/)).toBeVisible()

    // Starring survives closing and reopening the menu.
    await search.fill('provider:openai')
    await page
      .getByRole('button', { name: /^Star / })
      .first()
      .click()
    await page.keyboard.press('Escape')
    await page.getByTestId('home-model-picker').click()
    await expect(page.getByTestId('model-list')).toContainText('Starred')
    // Twice: once in the Starred shortcut, once in its place in the catalogue.
    await expect(page.getByRole('button', { name: /^Unstar GPT-5$/ })).toHaveCount(2)
  } finally {
    await shutdown(harness)
  }
})

test('artifact pane scrolls a long document', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)
    await page
      .getByPlaceholder('Describe a task or ask a question')
      .fill('write a longartifact please')
    await page.getByRole('button', { name: /Start session/i }).click()

    // The artifact tool card carries the artifact's identity now, not a
    // generic "Used artifact_create" row. Tool rows live inside the turn's
    // activity group, which collapses once the run settles.
    // Wait for the run to settle (the group auto-collapses) before expanding —
    // reading aria-expanded while it is still live races that transition.
    const summary = page.getByTestId('activity-summary').first()
    await expect(summary).toBeVisible({ timeout: 30_000 })
    await expect(summary).toHaveAttribute('aria-expanded', 'false', { timeout: 30_000 })
    await summary.click()
    const card = page.getByRole('button', { name: /Created artifact\s+E2E Long Doc/ })
    await expect(card).toBeVisible({ timeout: 30_000 })

    // The artifacts pane auto-opens on the session's first artifact, so don't
    // click the header toggle here — that would close it again.
    const scroller = page.getByTestId('artifact-scroll')
    await expect(scroller).toBeVisible({ timeout: 10_000 })

    // Regression: the pane used to clip its body with no scrollbar at all, so
    // everything past the first screen of a long artifact was unreachable.
    const metrics = await scroller.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }))
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight + 200)

    const moved = await scroller.evaluate((el) => {
      el.scrollTop = 400
      return el.scrollTop
    })
    expect(moved).toBeGreaterThan(0)
  } finally {
    await shutdown(harness)
  }
})

test('transcript: reading back during a stream is not undone, and rows sit flush', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)
    await page.getByPlaceholder('Describe a task or ask a question').fill('do a longstream now')
    await page.getByRole('button', { name: /Start session/i }).click()

    const scroller = page.getByTestId('transcript-scroll')
    await expect(scroller).toBeVisible({ timeout: 30_000 })

    // An unidentified streaming tool must never surface as a literal name.
    // The anonymous window is a few stub ticks wide and adoption closes it,
    // so a point-in-time count-0 assertion passes vacuously (verified: it
    // stayed green with "Running unknown" restored). Watch the whole stream
    // with a MutationObserver instead, and assert at the end.
    await page.evaluate(() => {
      const w = window as unknown as { __sawUnknown?: boolean }
      w.__sawUnknown = /unknown/i.test(document.body.innerText)
      new MutationObserver(() => {
        if (/unknown/i.test(document.body.innerText)) w.__sawUnknown = true
      }).observe(document.body, { childList: true, subtree: true, characterData: true })
    })
    await expect(page.locator('.tool-card').first()).toBeVisible({ timeout: 30_000 })

    // Wait until the transcript overflows, then read back.
    await expect
      .poll(async () => await scroller.evaluate((el) => el.scrollHeight - el.clientHeight), {
        timeout: 30_000,
      })
      .toBeGreaterThan(300)

    const box = (await scroller.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -400)

    // Keep streaming: geometry-derived pinning used to re-pin right here (the
    // virtualizer re-measures, scrollHeight shrinks, scrollTop is clamped to
    // the bottom) and slam the viewport back down mid-sentence.
    await page.waitForTimeout(1200)
    const position = await scroller.evaluate((el) => ({
      top: el.scrollTop,
      max: el.scrollHeight - el.clientHeight,
    }))
    expect(position.max - position.top).toBeGreaterThan(100)
    // The app agrees it is no longer following the tail. The pill labels the
    // ACTION (it only renders while unpinned), never the current state.
    await expect(page.getByRole('button', { name: /Follow stream|Jump to bottom/ })).toBeVisible()

    // …and no fabricated tool name ever appeared during the whole stream.
    expect(
      await page.evaluate(() => (window as unknown as { __sawUnknown: boolean }).__sawUnknown),
    ).toBe(false)
  } finally {
    await shutdown(harness)
  }
})

test('a long tool run collapses to one dense group', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)
    // 40 tool-only turns: the shape a long agent run takes, and the only shape
    // where grouping and per-row spacing actually show up.
    await page.getByPlaceholder('Describe a task or ask a question').fill('run manyitems now')
    await page.getByRole('button', { name: /Start session/i }).click()
    await expect(page.getByText('many items complete')).toBeVisible({ timeout: 60_000 })

    // pi emits one assistant message per tool call, so this run arrives as ~40
    // messages. They must render as ONE activity row — that regression is what
    // made long runs march down the page.
    await expect(page.getByTestId('activity-group')).toHaveCount(1)
    const summary = page.getByTestId('activity-summary').first()
    await expect(summary).toContainText(/\d+ steps/)

    // Settled ⇒ collapsed: the whole run costs a single line until asked for.
    await expect(summary).toHaveAttribute('aria-expanded', 'false')

    /*
     * Poll, don't sample once.
     *
     * The body collapses via a 220ms `grid-template-rows: 1fr → 0fr`
     * transition, and the instant `aria-expanded` flips to "false" is the
     * instant that transition STARTS. A single `evaluate` right after it
     * therefore measures the group mid-collapse — CI read 61px of a group that
     * settles at ~33px (one ActivityRow still in the track). Polling keeps the
     * assertion meaningful (a group that genuinely stays tall still fails on
     * timeout) without racing the animation.
     */
    const groupHeight = async (): Promise<number> =>
      await page.evaluate(
        () =>
          document.querySelector('[data-testid="activity-group"]')?.getBoundingClientRect()
            .height ?? 0,
      )
    await expect.poll(groupHeight, { timeout: 5_000 }).toBeLessThan(44)

    await summary.click()
    // Same transition, opening: measuring mid-expand compresses the rows and
    // would make the density assertions below pass vacuously. Wait for the
    // height to stop changing first.
    let previous = -1
    await expect
      .poll(
        async () => {
          const current = await groupHeight()
          const stable = current > 100 && current === previous
          previous = current
          return stable
        },
        { timeout: 5_000, intervals: [120] },
      )
      .toBe(true)

    const geometry = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-index]')] as HTMLElement[]
      const sorted = rows
        .map((el) => ({ index: Number(el.dataset.index), rect: el.getBoundingClientRect() }))
        .sort((a, b) => a.index - b.index)
      let worstGap = 0
      for (let i = 1; i < sorted.length; i++) {
        const previous = sorted[i - 1]!
        const current = sorted[i]!
        if (current.index !== previous.index + 1) continue
        worstGap = Math.max(worstGap, current.rect.top - previous.rect.bottom)
      }
      // Density is now per tool card inside the group, not per virtualized row.
      const cards = [...document.querySelectorAll('.tool-card')] as HTMLElement[]
      const heights = cards.map((el) => el.getBoundingClientRect().height)
      return {
        worstGap,
        tallestCard: heights.length ? Math.max(...heights) : 0,
        cards: heights.length,
      }
    })

    expect(geometry.cards).toBeGreaterThan(3)
    // One tool line used to occupy 63px for ~20px of text (four owners of the
    // same gap at once). Inside the group a settled row is ~26px; 40px leaves
    // headroom for platform font metrics while still failing on a regression.
    expect(geometry.tallestCard).toBeLessThan(40)
    // Spacing lives *inside* each measured wrapper, so measured rows are flush.
    expect(geometry.worstGap).toBeLessThan(8)
  } finally {
    await shutdown(harness)
  }
})

test('the updater stays dormant in an unpackaged run', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)

    // The updater is gated on app.isPackaged. E2E and dev runs are unpackaged,
    // so it must report `unsupported` and never reach the network — otherwise
    // every test run (and every `npm run dev`) would poll GitHub releases.
    const state = await page.evaluate(() => window.pidex.invoke('updates:state'))
    expect(state.phase).toBe('unsupported')

    // An explicit check is likewise a no-op rather than a fetch.
    await page.evaluate(() => window.pidex.invoke('updates:check'))
    expect((await page.evaluate(() => window.pidex.invoke('updates:state'))).phase).toBe(
      'unsupported',
    )

    // And with nothing to install, the pill never renders.
    await expect(page.getByTestId('update-pill')).toHaveCount(0)
  } finally {
    await shutdown(harness)
  }
})

test('extensions tab lists pi packages and reveals per-extension tabs', async () => {
  // A dir of this test's own: the fixture below is a hand-written
  // `node_modules` entry, and any real `npm install` into a shared agent dir
  // prunes it (see `privateAgentDir`).
  const soloAgentDir = privateAgentDir()
  // Seed it: one installed fixture package plus the Claude provider declared
  // in settings (declared is enough to reveal its tab — installed-ness only
  // changes the health row).
  const pkgDir = join(soloAgentDir, 'npm', 'node_modules', 'demo-pack')
  await mkdir(join(pkgDir, 'extensions'), { recursive: true })
  await writeFile(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name: 'demo-pack',
      version: '1.2.3',
      description: 'Fixture package for the extensions tab',
      pi: { extensions: ['extensions/main.ts'] },
    }),
  )
  await writeFile(join(pkgDir, 'extensions', 'main.ts'), '')
  await writeFile(
    join(soloAgentDir, 'settings.json'),
    JSON.stringify({ packages: ['npm:demo-pack', 'npm:@saccolabs/pi-claude-cli'] }),
  )

  const harness = await launch({ agentDir: soloAgentDir })
  try {
    await openWorkspace(harness.page)
    const page = harness.page

    await page.keyboard.press('ControlOrMeta+Comma')
    await page.getByRole('button', { name: 'Extensions', exact: true }).click()

    // The installed fixture resolves against the real install-dir layout.
    await expect(page.getByText('demo-pack', { exact: true })).toBeVisible()
    await expect(page.getByText('v1.2.3')).toBeVisible()
    await expect(page.getByText('npm:demo-pack — 1 extension')).toBeVisible()
    // The declared-but-absent package is reported, not hidden.
    await expect(page.getByText('installs on next session start')).toBeVisible()

    // Presence of pi-claude-cli in packages reveals its dedicated tab.
    await page.getByRole('button', { name: 'Claude Code', exact: true }).click()
    await expect(page.getByText('Claude Code provider')).toBeVisible()
    await expect(page.getByText('Extension package')).toBeVisible()
  } finally {
    await shutdown(harness)
    // Nothing to leave as found — the whole dir was this test's.
    await rm(soloAgentDir, { recursive: true, force: true })
  }
})

test('extensions tab installs and removes a package through pi CLI (stubbed)', async () => {
  const soloAgentDir = privateAgentDir()
  const harness = await launch({ agentDir: soloAgentDir })
  try {
    await openWorkspace(harness.page)
    const page = harness.page

    await page.keyboard.press('ControlOrMeta+Comma')
    await page.getByRole('button', { name: 'Extensions', exact: true }).click()

    // Install by spec: the job shells to the (stubbed) pi package manager,
    // streams its output, and the listing refreshes on exit.
    await page.getByPlaceholder(/npm:pkg/).fill('npm:e2e-added-pack')
    await page.getByRole('button', { name: 'Install', exact: true }).click()
    await expect(page.getByText('Installed npm:e2e-added-pack')).toBeVisible()
    await expect(page.getByText('e2e-added-pack', { exact: true })).toBeVisible()
    await expect(page.getByText('v9.9.9-stub')).toBeVisible()

    // Remove round-trips the same way.
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.getByText('Removed npm:e2e-added-pack')).toBeVisible()
    await expect(page.getByText('e2e-added-pack', { exact: true })).toHaveCount(0)
  } finally {
    await shutdown(harness)
    await rm(soloAgentDir, { recursive: true, force: true })
  }
})

test('web access tab writes provider keys to web-search.json', async () => {
  const soloAgentDir = privateAgentDir()
  await writeFile(
    join(soloAgentDir, 'settings.json'),
    JSON.stringify({ packages: ['npm:pi-web-access'] }),
  )
  const harness = await launch({ agentDir: soloAgentDir })
  try {
    await openWorkspace(harness.page)
    const page = harness.page

    await page.keyboard.press('ControlOrMeta+Comma')
    await page.getByRole('button', { name: 'Web access', exact: true }).click()

    // Set the first provider row (Brave). Commit on Enter.
    await page.getByRole('button', { name: 'Set key' }).first().click()
    await page.getByPlaceholder('BSA_…').fill('BSA_e2e_123')
    await page.keyboard.press('Enter')

    await expect(page.getByText('configured', { exact: true }).first()).toBeVisible()
    // The key landed in pi-web-access's real config location (the sandboxed
    // agent dir is its highest-precedence directory).
    await expect
      .poll(async () => {
        try {
          return JSON.parse(await readFile(join(soloAgentDir, 'web-search.json'), 'utf8'))
            .braveApiKey
        } catch {
          return undefined
        }
      })
      .toBe('BSA_e2e_123')
  } finally {
    await shutdown(harness)
    await rm(soloAgentDir, { recursive: true, force: true })
  }
})

test('claude provider tab proves the chain end to end (stubbed claude + pi)', async () => {
  // A fake claude via the gated PIDEX_CLAUDE_BIN override — PATH games are
  // machine-dependent (a developer's real install shadows the fake). It answers
  // `auth status` and `auth login`, the two the tab drives; the login branch
  // reproduces the real CLI's shape (URL on stdout, code read from stdin).
  const claudeDir = await mkdtemp(join(tmpdir(), 'pidex-e2e-claude-'))
  await writeFile(
    join(claudeDir, 'claude'),
    '#!/bin/sh\n' +
      'case "$1 $2" in\n' +
      '  "auth login")\n' +
      '    echo "Opening browser to sign in..."\n' +
      '    echo "If the browser didn\'t open, visit: https://claude.com/cai/oauth/authorize?state=e2e"\n' +
      '    printf "Paste code here if prompted > "\n' +
      '    read code\n' +
      '    echo "Login successful."\n' +
      '    ;;\n' +
      '  *) case "$1" in\n' +
      '       --version) echo "2.1.219 (stub)";;\n' +
      '       auth) echo \'{"loggedIn": true, "authMethod": "claude.ai", "email": "e2e@test", "subscriptionType": "max"}\';;\n' +
      '     esac;;\n' +
      'esac\n',
  )
  await chmod(join(claudeDir, 'claude'), 0o755)
  const soloAgentDir = privateAgentDir()
  await writeFile(
    join(soloAgentDir, 'settings.json'),
    JSON.stringify({ packages: ['npm:@saccolabs/pi-claude-cli'] }),
  )

  const harness = await launch({
    agentDir: soloAgentDir,
    env: { PIDEX_CLAUDE_BIN: join(claudeDir, 'claude') },
  })
  try {
    await openWorkspace(harness.page)
    const page = harness.page

    await page.keyboard.press('ControlOrMeta+Comma')
    await page.getByRole('button', { name: 'Claude Code', exact: true }).click()

    // Health card sees the fake binary and its auth state.
    await expect(page.getByText(/v2\.1\.219 at /)).toBeVisible()
    await expect(page.getByText('e2e@test · max')).toBeVisible()

    // Switching accounts is in-app: the CLI's sign-in runs with piped stdio, so
    // the paste-code box is the whole UI it needs — no terminal, no pty.
    await page.getByRole('button', { name: 'Switch account' }).click()
    await expect(page.getByPlaceholder('Paste code')).toBeVisible()
    await page.getByPlaceholder('Paste code').fill('e2e-code')
    await page.getByRole('button', { name: 'Continue' }).click()
    // Back to a settled row — completion is read from `auth status`, never from
    // the CLI's "Login successful." prose.
    await expect(page.getByRole('button', { name: 'Switch account' })).toBeVisible()
    await expect(page.getByText('e2e@test · max')).toBeVisible()

    // The one-click proof runs through the (stubbed) pi print mode.
    await page.getByRole('button', { name: 'Test provider' }).click()
    await expect(page.getByText('pidex-provider-ok')).toBeVisible()
    await expect(page.getByText('Round-trip confirmed', { exact: false })).toBeVisible()
  } finally {
    await shutdown(harness)
    await rm(claudeDir, { recursive: true, force: true })
    await rm(soloAgentDir, { recursive: true, force: true })
  }
})

/**
 * The fleet hub, end to end: a live session becomes a card on the home screen
 * with a working inline composer, and the project shows an orchestrator row.
 *
 * Scope note — the stub is spawned WITHOUT pidex's bundled extensions (see
 * `bundledExtensions` in pi-session-handlers), so the orchestrator's own tools
 * cannot run here. What this proves is the mechanical layer that costs no
 * tokens: main observing pi's event stream, pushing snapshots, and the home
 * screen rendering them. Orchestrator tool behaviour is covered by unit tests
 * over the bridge instead.
 */
test('home surfaces live sessions as fleet cards you can talk to', async () => {
  const harness = await launch({
    userDataDir: await mkdtemp(join(tmpdir(), 'pidex-e2e-fleet-')),
  })
  const { page } = harness
  try {
    await openWorkspace(page)

    await page.getByPlaceholder('Describe a task or ask a question').fill('fleet card please')
    await page.getByRole('button', { name: /Start session/i }).click()
    await expect(page.getByPlaceholder(/Describe a task…/i)).toBeVisible({ timeout: 30_000 })

    // Back to home with the session still live.
    await page.getByRole('button', { name: /^New$/ }).click()

    const card = page.getByTestId('fleet-session-card').first()
    await expect(card).toBeVisible({ timeout: 20_000 })

    // The card carries a real composer, and sending routes to the live session
    // rather than starting a new one.
    const box = card.getByRole('textbox')
    await expect(box).toBeVisible()
    await box.fill('steered from the home screen')
    await box.press('Enter')
    await expect(box).toHaveValue('', { timeout: 20_000 })

    // The message went to the SESSION, not into a new one: open it from the
    // sidebar (not the card's own button, which is "Stop" while streaming) and
    // find it in that transcript.
    await page.getByTestId('session-row').first().click()
    await expect(page.getByText('steered from the home screen')).toBeVisible({ timeout: 20_000 })
  } finally {
    await shutdown(harness)
  }
})

test('the lane loop renders above the composer and on the fleet card', async () => {
  const harness = await launch({
    userDataDir: await mkdtemp(join(tmpdir(), 'pidex-e2e-lane-')),
  })
  const { page } = harness
  try {
    await openWorkspace(page)

    await page.getByPlaceholder('Describe a task or ask a question').fill('lane loop please')
    await page.getByRole('button', { name: /Start session/i }).click()
    await expect(page.getByPlaceholder(/Describe a task…/i)).toBeVisible({ timeout: 30_000 })

    // MOUNT 1 — inside the lane, directly above the composer. This is the
    // mount that is missing from every tool in this category: the transcript
    // is history, and without this there is no state.
    const banner = page.getByTestId('lane-banner')
    await expect(banner).toBeVisible({ timeout: 30_000 })

    // The stub's lane has a failing rung, so the banner opens itself. A lane
    // that needs nothing collapses to one line instead.
    await expect(banner).toHaveAttribute('data-open', 'true')

    const ladder = banner.getByTestId('lane-ladder')
    // The full fixed ladder, in order, regardless of what was reported.
    await expect(ladder.locator('[data-rung]')).toHaveCount(6)
    await expect(ladder.locator('[data-rung="tsc"]')).toHaveAttribute('data-state', 'pass')
    await expect(ladder.locator('[data-rung="test"]')).toHaveAttribute('data-state', 'fail')
    // `pr` is present and unfilled from turn one, by design.
    await expect(ladder.locator('[data-rung="pr"]')).toHaveAttribute('data-state', 'stale')

    // The hint names the failure, and it is generated from rung state rather
    // than from anything the agent said.
    await expect(banner.getByText(/test failed/i)).toBeVisible()
    await expect(banner.getByText(/auth\/ttl\.test\.ts/)).toBeVisible()
    await expect(banner.getByText(/pidex\/stub-lane/)).toBeVisible()

    // It collapses. The first version was a fixed block with no way to
    // dismiss it, which costs transcript room on every single turn.
    await banner.getByRole('button', { name: /Collapse lane status/i }).click()
    await expect(banner).toHaveAttribute('data-open', 'false')
    // Collapsed still answers "is anything wrong": the ladder rides the
    // summary line rather than hiding behind the chevron.
    await expect(banner.getByTestId('lane-ladder')).toBeVisible()
    await banner.getByRole('button', { name: /Expand lane status/i }).click()
    await expect(banner).toHaveAttribute('data-open', 'true')

    // The action starts a new turn in the same session. This used to call
    // `follow_up`, which only queues work behind an active turn; after the
    // banner's settled-state render it was a successful no-op.
    const fixTest = banner.getByRole('button', { name: /Fix test/i })
    await expect(fixTest).toBeVisible()
    await fixTest.click()
    await expect(page.getByText('Lane action received.')).toBeVisible({ timeout: 20_000 })

    // The status strip must NOT print the raw payload. `setStatus` is the only
    // channel an extension has, so it doubles as a data bus, and every
    // structured key has to be excluded by name or its JSON lands in the strip
    // at the bottom of the window. Shipping `pidex-lane-loop` without adding it
    // to that list did exactly that; caught by looking at a screenshot.
    await expect(page.getByText(/"rungs":/)).toHaveCount(0)

    // The banner and composer use the same gutter and max-width contract. Open
    // a side pane to narrow the chat column, then compare their actual boxes:
    // a banner with its own padding used to remain wider than the input here.
    await page.getByTitle(/Files pane/).click()
    const composerCard = page.locator('.composer-field').locator('..')
    await expect
      .poll(async () => {
        const [bannerBox, composerBox] = await Promise.all([
          banner.boundingBox(),
          composerCard.boundingBox(),
        ])
        if (!bannerBox || !composerBox) return false
        return (
          Math.abs(bannerBox.x - composerBox.x) < 1 &&
          Math.abs(bannerBox.width - composerBox.width) < 1
        )
      })
      .toBe(true)

    // MOUNT 2 — the same component on the fleet card, so the two surfaces
    // cannot disagree about where the work is.
    await page.getByRole('button', { name: /^New$/ }).click()
    const card = page.getByTestId('fleet-session-card').first()
    await expect(card).toBeVisible({ timeout: 20_000 })
    const cardLadder = card.getByTestId('lane-ladder')
    await expect(cardLadder.locator('[data-rung]')).toHaveCount(6)
    await expect(cardLadder.locator('[data-rung="test"]')).toHaveAttribute('data-state', 'fail')
  } finally {
    await shutdown(harness)
  }
})

test('a pending PR is the banner CTA without redundant copy', async () => {
  const harness = await launch({
    userDataDir: await mkdtemp(join(tmpdir(), 'pidex-e2e-lane-pr-')),
  })
  const { page } = harness
  try {
    await openWorkspace(page)
    await page.getByPlaceholder('Describe a task or ask a question').fill('lane pr please')
    await page.getByRole('button', { name: /Start session/i }).click()

    const banner = page.getByTestId('lane-banner')
    await expect(banner).toBeVisible({ timeout: 30_000 })
    // There is no expanded success prose or duplicate PR button. The final
    // rung is the CTA and stays available while the compact banner is closed.
    await expect(banner).toHaveAttribute('data-open', 'false')
    await expect(banner.getByText(/All checks pass\. This lane still owes/i)).toHaveCount(0)
    await expect(banner.getByRole('button', { name: /^Open the PR$/i })).toHaveCount(0)

    const pr = banner.getByRole('button', { name: 'Open a pull request for this lane' })
    await expect(pr).toHaveAttribute('data-rung', 'pr')
    await pr.click()
    await expect(page.getByText('Lane action received.')).toBeVisible({ timeout: 20_000 })
  } finally {
    await shutdown(harness)
  }
})

test('the workspace header carries fixed settings / new / orchestrator controls', async () => {
  const harness = await launch({
    userDataDir: await mkdtemp(join(tmpdir(), 'pidex-e2e-orc-')),
  })
  const { page } = harness
  try {
    await openWorkspace(page)

    // All three are permanent, not hover-revealed: a control you cannot see is
    // a control you do not know exists.
    const orchestrator = page.getByTestId('orchestrator-header-button').first()
    await expect(orchestrator).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('workspace-group-new-session').first()).toBeVisible()
    await expect(page.getByTestId('workspace-group-menu').first()).toBeVisible()

    // The orchestrator is present before anything is spawned: watching costs
    // nothing, so the control is an invitation rather than a running process.
    await expect(orchestrator).toHaveAttribute('aria-label', /Orchestrator for/)

    // It is NOT a session row — that separation is the whole point — and it no
    // longer sits in the session list at all.
    await expect(page.getByTestId('session-row')).toHaveCount(0)
    await expect(page.getByTestId('orchestrator-row')).toHaveCount(0)
  } finally {
    await shutdown(harness)
  }
})

test('opening the orchestrator gives it controls, and never a session row', async () => {
  const harness = await launch({
    userDataDir: await mkdtemp(join(tmpdir(), 'pidex-e2e-orc-mode-')),
  })
  const { page } = harness
  try {
    await openWorkspace(page)

    await page.getByTestId('orchestrator-header-button').first().click()
    await expect(page.getByTestId('orchestrator-banner')).toBeVisible({ timeout: 20_000 })

    // The banner carries the thread's own controls. They used to live only
    // behind a right-click on the sidebar icon, so a thread that could no
    // longer take a turn offered nothing on the screen you were looking at.
    const picker = page.getByTestId('orchestrator-mode-picker')
    await expect(picker).toBeVisible()
    await expect(picker).toContainText('Supervise')
    await expect(page.getByTestId('orchestrator-menu')).toBeVisible()

    /*
     * The regression this guards: an orchestrator is a live session whose file
     * the scanner deliberately keeps out of `disk`, so the sidebar's
     * placeholder logic saw a live session that never "arrived" and rendered
     * it as a session row for the entire life of the process.
     */
    await expect(page.getByTestId('session-row')).toHaveCount(0)

    // A work session must NOT offer the mode picker.
    await page.getByTestId('workspace-group-new-session').first().click()
    await expect(page.getByTestId('orchestrator-mode-picker')).toHaveCount(0)
  } finally {
    await shutdown(harness)
  }
})
