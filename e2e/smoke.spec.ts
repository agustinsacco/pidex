import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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

async function launch(
  options: { workspace?: string; userDataDir?: string } = {},
): Promise<Harness> {
  const workspace = options.workspace ?? (await mkdtemp(join(tmpdir(), 'pidex-e2e-')))
  await writeFile(join(workspace, 'hello.ts'), 'export function hello() {\n  return "new"\n}\n')

  const app = await electron.launch({
    args: [repoRoot],
    env: {
      ...process.env,
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

    // Edit tool card with its diff.
    const editRow = page.getByRole('button', { name: /Edited\s+hello\.ts/ })
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

    await palette.fill('terminal')
    await expect(page.getByText('Toggle terminal')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden()
  } finally {
    await shutdown(harness)
  }
})

test('terminal pane spawns a real shell', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)

    // Start a session so the pane toggles are available.
    await page.getByPlaceholder('Describe a task or ask a question').fill('hello')
    await page.getByRole('button', { name: /Start session/i }).click()
    await expect(page.getByText(/Done:\s*hello\.ts\s*updated\./)).toBeVisible({ timeout: 30_000 })

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+`' : 'Control+`')
    await expect(page.getByText('Terminal', { exact: true })).toBeVisible({ timeout: 15_000 })
    // xterm renders into a canvas/rows container once the PTY is attached.
    await expect(page.locator('.xterm').first()).toBeVisible({ timeout: 15_000 })
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
    await page.evaluate(() => {
      const w = window as unknown as { __sawRunning?: boolean }
      w.__sawRunning = document.querySelector('.tool-running-dot') !== null
      new MutationObserver(() => {
        if (document.querySelector('.tool-running-dot')) w.__sawRunning = true
      }).observe(document.body, { childList: true, subtree: true, attributes: true })
    })

    await expect(page.getByText(/Done:\s*hello\.ts\s*updated\./)).toBeVisible({ timeout: 30_000 })

    // The running affordance appeared while tools were executing…
    expect(
      await page.evaluate(() => (window as unknown as { __sawRunning: boolean }).__sawRunning),
    ).toBe(true)
    // …and is gone now that the run finished.
    await expect(page.locator('.tool-running-dot')).toHaveCount(0)

    // All three calls from the run are present as rows.
    await expect(page.getByRole('button', { name: /Edited\s+hello\.ts/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Ran/ })).toBeVisible()

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

    // Every chip opens a popover.
    await page.getByRole('button', { name: 'Local' }).click()
    await expect(page.getByText(/pi runs as a subprocess/)).toBeVisible()
    // PopupMenu dismisses on outside mousedown.
    await page.mouse.click(20, 400)
    await expect(page.getByText(/pi runs as a subprocess/)).toBeHidden()

    // Attachment affordance is present next to the pickers.
    await expect(page.getByRole('button', { name: 'Attach images' })).toBeVisible()
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
    // generic "Used artifact_create" row.
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
    await expect(page.getByText('unknown', { exact: false })).toHaveCount(0)

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
    // The app agrees it is no longer following the tail.
    await expect(
      page.getByRole('button', { name: /Following stream|Jump to bottom/ }),
    ).toBeVisible()
  } finally {
    await shutdown(harness)
  }
})

test('transcript rows are dense and sit flush', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)
    // 40 tool-only turns: the shape a long agent run takes, and the only shape
    // where virtualization and per-row spacing actually show up.
    await page.getByPlaceholder('Describe a task or ask a question').fill('run manyitems now')
    await page.getByRole('button', { name: /Start session/i }).click()
    await expect(page.getByText('many items complete')).toBeVisible({ timeout: 60_000 })

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
      // Measure rows that actually contain a tool card. Filtering by "has no
      // markdown body" also caught the user bubble (plain pre-wrap text, not
      // markdown), whose padding + timestamp row is legitimately ~58px — the
      // assertion failed on a message it was never meant to measure.
      const toolRowHeights = rows
        .filter((el) => el.querySelector('.tool-card'))
        .map((el) => el.getBoundingClientRect().height)
      return {
        worstGap,
        tallestToolRow: Math.max(...toolRowHeights),
        toolRows: toolRowHeights.length,
        rows: sorted.length,
      }
    })

    expect(geometry.rows).toBeGreaterThan(5)
    expect(geometry.toolRows).toBeGreaterThan(3)
    // Density: one tool row used to occupy 63px for ~20px of text, because the
    // row's gap was owned in four places at once (pt-4 + pb-0.5 + my-2 + py-1).
    // With `spacingFor` as the single owner it is ~33px. 44px leaves headroom
    // for font-metric differences between platforms while still failing on a
    // regression to the old stacking.
    expect(geometry.tallestToolRow).toBeLessThan(44)
    // Spacing lives *inside* each measured wrapper, so measured rows are flush.
    expect(geometry.worstGap).toBeLessThan(8)
  } finally {
    await shutdown(harness)
  }
})
