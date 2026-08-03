import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
async function launch(): Promise<Harness> {
  const workspace = await mkdtemp(join(tmpdir(), 'pidex-e2e-'))
  await writeFile(join(workspace, 'hello.ts'), 'export function hello() {\n  return "new"\n}\n')

  const app = await electron.launch({
    args: [repoRoot],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PIDEX_PI_STUB: piStub,
      PIDEX_E2E_WORKSPACE: workspace,
      PIDEX_TEST_USER_DATA: '1',
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

/** Get from the greeting screen into the workspace home. */
async function openWorkspace(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /Open Folder/i })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: /Open Folder/i }).click()
  await expect(page.getByPlaceholder('Describe a task or ask a question')).toBeVisible({
    timeout: 20_000,
  })
}

test('workspace → session → streamed answer, diff and artifact render', async () => {
  const harness = await launch()
  const { page } = harness
  try {
    await openWorkspace(page)

    await page.getByPlaceholder('Describe a task or ask a question').fill('Update hello.ts')
    await page.getByRole('button', { name: /Start session/i }).click()

    // Streamed assistant text.
    await expect(page.getByText('Done: hello.ts updated.')).toBeVisible({ timeout: 30_000 })

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
    await expect(page.getByText('Done: hello.ts updated.')).toBeVisible({ timeout: 30_000 })

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+`' : 'Control+`')
    await expect(page.getByText('Terminal', { exact: true })).toBeVisible({ timeout: 15_000 })
    // xterm renders into a canvas/rows container once the PTY is attached.
    await expect(page.locator('.xterm').first()).toBeVisible({ timeout: 15_000 })
  } finally {
    await shutdown(harness)
  }
})
