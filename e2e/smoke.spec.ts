import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
  options: { workspace?: string; userDataDir?: string } = {},
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
      PI_CODING_AGENT_DIR: agentDir,
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

    // Per-message cost is gone from the transcript (usage lives elsewhere).
    await expect(page.locator('text=/\\$\\d+\\.\\d{4}/')).toHaveCount(0)

    // Streaming repair: the transcript briefly contained "**hello.ts" before
    // its closing marker arrived. Raw asterisks must never survive to the DOM.
    const transcript = await page.locator('.md-content').allInnerTexts()
    expect(transcript.join('\n')).not.toContain('**')

    // Spacing: messages are separated by more than the gap inside a message.
    const gaps = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('[data-index]')] as HTMLElement[]
      return nodes.slice(0, 4).map((n) => {
        const inner = n.firstElementChild as HTMLElement | null
        return inner ? parseFloat(getComputedStyle(inner).paddingTop) : 0
      })
    })
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(12)

    // Extension status line arrived styled with ANSI SGR codes; the strip
    // must show clean (optionally colored) text, never raw escape bytes.
    const statusText = await page.getByText(/MCP: 2 servers enabled/).innerText()
    expect(statusText).not.toContain('[38;2')
    expect(statusText).not.toContain('\u001b')
  } finally {
    await shutdown(harness)
  }
})

test('usage view aggregates cost and tokens from session files', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)
    await page.getByPlaceholder('Describe a task or ask a question').fill('Update hello.ts')
    await page.getByRole('button', { name: /Start session/i }).click()
    await expect(page.getByText(/Done:\s*hello\.ts\s*updated\./)).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Usage' }).click()
    await expect(page.getByText('Total cost')).toBeVisible({ timeout: 10_000 })

    // The stub persisted an assistant message with usage → nonzero rollup.
    await expect(page.getByText('$0.033').first()).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByText('Total cost')).toBeHidden()
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

    // Create a worktree from the branch chip.
    await page.getByTestId('branch-chip').click()
    await page.getByRole('button', { name: 'New worktree…' }).click()
    await page.getByPlaceholder('new branch name').fill('task-1')
    await page.getByRole('button', { name: 'Create worktree' }).click()

    // Chip now targets the worktree.
    await expect(page.getByTestId('branch-chip')).toContainText('task-1', { timeout: 10_000 })

    // Start a session — it runs in the worktree cwd, but the sidebar still
    // shows one group for the project (not a second header split off by
    // branch); the worktree is surfaced on the session row itself instead.
    await page.getByPlaceholder('Describe a task or ask a question').fill('Update hello.ts')
    await page.getByRole('button', { name: /Start session/i }).click()
    await expect(page.getByText(/Done:\s*hello\.ts\s*updated\./)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('workspace-group')).toHaveCount(1, { timeout: 15_000 })
    await expect(page.getByTitle('Runs in a git worktree')).toBeVisible({ timeout: 15_000 })

    // The chat header's git chip marks the worktree.
    await expect(page.getByTitle(/Worktree of/)).toBeVisible({ timeout: 10_000 })
  } finally {
    await shutdown(harness)
  }
})

test('MCP settings: chain rows, disable toggle, add project server', async () => {
  // Seed a global server in the isolated agent dir (pi-global scope).
  await writeFile(
    join(agentDir, 'mcp.json'),
    JSON.stringify({ mcpServers: { linear: { url: 'https://mcp.linear.app/sse' } } }),
  )
  // Dedicated prefs dir: project-scope writes target the ACTIVE workspace, so
  // a `lastSessionPath` left by an earlier test could restore a different
  // workspace and send the write there.
  const harness = await launch({ userDataDir: await mkdtemp(join(tmpdir(), 'pidex-e2e-mcp-')) })
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
        const raw = await readFile(join(agentDir, 'mcp.json'), 'utf8')
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
      // which is exactly how this test failed on (slower) Linux CI. Wait for
      // the sidebar row, which only appears once the session is on disk.
      await expect(first.page.getByTestId('session-row').first()).toBeVisible({
        timeout: 20_000,
      })
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

test('home composer: grey focus border, chip popovers, and model picker', async () => {
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
    // pidex only ever runs pi as a local subprocess.)
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
    const collapsedHeight = await page.evaluate(
      () =>
        document.querySelector('[data-testid="activity-group"]')?.getBoundingClientRect().height ??
        0,
    )
    expect(collapsedHeight).toBeLessThan(44)

    await summary.click()
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

test('resource monitor reports real per-session process usage', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)
    // A live session means a real pi (stub) subprocess to attribute usage to.
    await page.getByPlaceholder('Describe a task or ask a question').fill('hello')
    await page.getByRole('button', { name: /Start session/i }).click()
    await expect(page.getByTestId('session-row').first()).toBeVisible({ timeout: 60_000 })

    await page.getByRole('button', { name: 'Resources', exact: true }).click()

    // Sampling starts on open, so a row must appear with a real measurement.
    const row = page.getByTestId('monitor-session-row').first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText(/\d+(\.\d+)?\s*(KB|MB|GB)/, { timeout: 30_000 })

    // The terminals toggle must actually change what is charged to a session.
    const toggle = page.getByTestId('monitor-include-terminals')
    await expect(toggle).toBeChecked()
    await toggle.uncheck()
    await expect(toggle).not.toBeChecked()
    await expect(row).toBeVisible()
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
