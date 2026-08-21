import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  ClaudeAuthStatus,
  ClaudeStatus,
  PiPackageEntry,
  PiPackageResources,
} from '@shared/models'
import { piAgentDir } from './pi-paths'
import { getLoginShellPath, piProcessEnv } from './shell-env'

const execFileAsync = promisify(execFile)

/**
 * Reading the `packages` arrays of pi's settings files and resolving each
 * entry to its install directory on disk.
 *
 * Mutations go through pi's own CLI (`pi install` / `pi remove` /
 * `pi update`), spawned by the job runner below — pi owns pinning, git-ref
 * reconciliation and `npmCommand` wrappers, so pidex never re-implements
 * install semantics. This module only *displays* state.
 */

/** A settings `packages` entry: plain spec or the filtered object form. */
type RawPackageEntry = string | { source: string; [key: string]: unknown }

interface ScopeDirs {
  /** Directory holding settings.json — relative path specs resolve here. */
  settingsDir: string
  scope: 'global' | 'project'
}

export function classifySpec(spec: string): 'npm' | 'git' | 'path' {
  if (spec.startsWith('npm:')) return 'npm'
  if (spec.startsWith('git:')) return 'git'
  if (/^(https?|ssh|git):\/\//.test(spec)) return 'git'
  return 'path'
}

/** `npm:@scope/name@1.2.3` → `@scope/name` (version suffix stripped). */
export function npmNameFromSpec(spec: string): string {
  const withoutPrefix = spec.slice('npm:'.length)
  const at = withoutPrefix.lastIndexOf('@')
  return at > 0 ? withoutPrefix.slice(0, at) : withoutPrefix
}

/**
 * Best-effort `<host>/<path>` for a git spec, mirroring pi's clone layout
 * (`<base>/git/<host>/<path>`). Handles `git:host/path`, `git@host:path`,
 * and protocol URLs; strips `.git` and `@ref` suffixes.
 */
export function gitDirFromSpec(spec: string): string | null {
  let rest = spec.startsWith('git:') ? spec.slice(4) : spec
  const protocol = /^(https?|ssh|git):\/\//.exec(rest)
  if (protocol) rest = rest.slice(protocol[0].length)
  // git@github.com:user/repo → github.com/user/repo
  const scpLike = /^[\w.-]+@([\w.-]+):(.+)$/.exec(rest)
  if (scpLike) rest = `${scpLike[1]}/${scpLike[2]}`
  // ssh://git@github.com/user/repo → github.com/user/repo
  else rest = rest.replace(/^[\w.-]+@/, '')
  // Strip a pinned ref, then .git
  const at = rest.lastIndexOf('@')
  if (at > rest.indexOf('/')) rest = rest.slice(0, at)
  if (rest.endsWith('.git')) rest = rest.slice(0, -4)
  return rest.includes('/') ? rest : null
}

export function resolveInstallPath(
  spec: string,
  kind: 'npm' | 'git' | 'path',
  dirs: ScopeDirs,
): string | null {
  // Global packages install beside `~/.pi/agent`; project packages under
  // `<ws>/.pi` — both are exactly the settings file's directory.
  const base = dirs.settingsDir
  if (kind === 'npm') return join(base, 'npm', 'node_modules', npmNameFromSpec(spec))
  if (kind === 'git') {
    const dir = gitDirFromSpec(spec)
    return dir ? join(base, 'git', dir) : null
  }
  return isAbsolute(spec) ? spec : resolve(base, spec)
}

function readPackagesArray(settingsPath: string): RawPackageEntry[] {
  let raw: string
  try {
    raw = readFileSync(settingsPath, 'utf8')
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as { packages?: unknown }
    if (!Array.isArray(parsed.packages)) return []
    return parsed.packages.filter(
      (entry): entry is RawPackageEntry =>
        typeof entry === 'string' ||
        (typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as { source?: unknown }).source === 'string'),
    )
  } catch {
    // Malformed settings are surfaced by pi:checkAgentSettings; here we
    // simply have nothing to list.
    return []
  }
}

const EMPTY_RESOURCES: PiPackageResources = {
  extensions: [],
  skills: [],
  prompts: [],
  themes: [],
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

/**
 * Resources a package directory provides: the `pi` manifest arrays when
 * declared (shown as written, exclusions dropped), else pi's convention
 * directories.
 */
function discoverResources(installPath: string): PiPackageResources {
  let stats
  try {
    stats = statSync(installPath)
  } catch {
    return EMPTY_RESOURCES
  }
  // A single-file package is one extension.
  if (stats.isFile()) {
    return { ...EMPTY_RESOURCES, extensions: [basename(installPath)] }
  }

  const manifest = readPackageJson(installPath)?.pi
  if (manifest && typeof manifest === 'object') {
    const fromManifest = (key: string): string[] => {
      const value = (manifest as Record<string, unknown>)[key]
      if (!Array.isArray(value)) return []
      return value.filter((v): v is string => typeof v === 'string' && !v.startsWith('!'))
    }
    return {
      extensions: fromManifest('extensions'),
      skills: fromManifest('skills'),
      prompts: fromManifest('prompts'),
      themes: fromManifest('themes'),
    }
  }

  const byExt = (dir: string, exts: string[]): string[] =>
    listDir(join(installPath, dir)).filter((f) => exts.some((ext) => f.endsWith(ext)))
  const skills = listDir(join(installPath, 'skills')).filter(
    (entry) => entry.endsWith('.md') || existsSync(join(installPath, 'skills', entry, 'SKILL.md')),
  )
  return {
    extensions: byExt('extensions', ['.ts', '.js']),
    skills,
    prompts: byExt('prompts', ['.md']),
    themes: byExt('themes', ['.json']),
  }
}

interface PackageJsonBits {
  name?: string
  version?: string
  description?: string
  pi?: unknown
}

function readPackageJson(dir: string): PackageJsonBits | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJsonBits
  } catch {
    return null
  }
}

function toEntry(raw: RawPackageEntry, dirs: ScopeDirs): PiPackageEntry {
  const spec = typeof raw === 'string' ? raw : raw.source
  const filtered = typeof raw !== 'string'
  const kind = classifySpec(spec)
  const installPath = resolveInstallPath(spec, kind, dirs)
  const installed = installPath !== null && existsSync(installPath)

  const pkg = installed && installPath ? readPackageJson(installPath) : null
  const fallbackName =
    kind === 'npm'
      ? npmNameFromSpec(spec)
      : kind === 'git'
        ? (gitDirFromSpec(spec) ?? spec)
        : basename(spec)

  return {
    spec,
    scope: dirs.scope,
    kind,
    filtered,
    name: pkg?.name ?? fallbackName,
    version: pkg?.version,
    description: pkg?.description,
    installed,
    installPath: installPath ?? undefined,
    resources: installed && installPath ? discoverResources(installPath) : EMPTY_RESOURCES,
  }
}

/** All packages declared in the global and (when given) project settings. */
export function listPackages(workspacePath?: string): PiPackageEntry[] {
  const scopes: ScopeDirs[] = [{ settingsDir: piAgentDir(), scope: 'global' }]
  if (workspacePath) scopes.push({ settingsDir: join(workspacePath, '.pi'), scope: 'project' })

  return scopes.flatMap((dirs) =>
    readPackagesArray(join(dirs.settingsDir, 'settings.json')).map((raw) => toEntry(raw, dirs)),
  )
}

// ---------- job runner ----------

/** Sender surface the runner needs (subset of Electron.WebContents). */
export interface JobSender {
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

const activeJobs = new Map<string, ReturnType<typeof spawn>>()

/**
 * Spawn a command and stream its output to the renderer on
 * `packages:output:<jobId>` / `packages:exit:<jobId>`. Output and exit are
 * fire-and-forget: a closed window simply stops receiving.
 */
function startJob(
  sender: JobSender,
  command: string,
  args: string[],
  options: { cwd?: string; env: Record<string, string> },
): { jobId: string } {
  const jobId = randomUUID()
  const outputChannel = `packages:output:${jobId}`
  const exitChannel = `packages:exit:${jobId}`
  const emit = (channel: string, payload: unknown): void => {
    if (!sender.isDestroyed()) sender.send(channel, payload)
  }

  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  activeJobs.set(jobId, child)

  child.stdout?.on('data', (chunk: Buffer) => emit(outputChannel, chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => emit(outputChannel, chunk.toString()))
  child.on('error', (error) => {
    emit(outputChannel, `${error.message}\n`)
    emit(exitChannel, 127)
    activeJobs.delete(jobId)
  })
  child.on('close', (code) => {
    emit(exitChannel, code ?? 1)
    activeJobs.delete(jobId)
  })

  return { jobId }
}

/** Resolve a binary on the login-shell PATH (GUI launches lack it). */
async function resolveBinary(name: string): Promise<string | null> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('where', [name], { timeout: 15_000 })
      return stdout.trim().split(/\r?\n/)[0]?.trim() || null
    } catch {
      return null
    }
  }
  const shellPath = await getLoginShellPath()
  for (const env of [shellPath ? { ...process.env, PATH: shellPath } : null, { ...process.env }]) {
    if (!env) continue
    try {
      const { stdout } = await execFileAsync('/bin/sh', ['-c', `command -v ${name}`], {
        timeout: 15_000,
        env,
      })
      const found = stdout.trim().split('\n').pop()?.trim()
      if (found) return found
    } catch {
      // try the next env
    }
  }
  return null
}

/** Report a spawn-precondition failure through the job channels. */
function failedJob(sender: JobSender, message: string): { jobId: string } {
  const jobId = randomUUID()
  // Delay so the renderer can subscribe with the returned jobId first.
  setTimeout(() => {
    if (sender.isDestroyed()) return
    sender.send(`packages:output:${jobId}`, `${message}\n`)
    sender.send(`packages:exit:${jobId}`, 127)
  }, 0)
  return { jobId }
}

/**
 * How to invoke pi for package jobs. The e2e stub is a Node script, so it
 * runs through Electron-as-Node exactly like the session spawner does
 * (pi-session-handlers computes and passes the override; this module stays
 * Electron-free for unit tests).
 */
export interface PiInvoker {
  command: string
  prefixArgs: string[]
  env: Record<string, string>
}

async function resolvePiInvoker(stubPath?: string): Promise<PiInvoker | null> {
  if (stubPath) {
    return {
      command: process.execPath,
      prefixArgs: [stubPath],
      env: { ...(process.env as Record<string, string>), ELECTRON_RUN_AS_NODE: '1' },
    }
  }
  const pi = await resolveBinary('pi')
  return pi ? { command: pi, prefixArgs: [], env: await piProcessEnv() } : null
}

/** `pi install|remove|update` through pi's own package manager. */
export async function runPackageAction(
  sender: JobSender,
  action: 'install' | 'remove' | 'update',
  spec: string | undefined,
  scope: 'global' | 'project',
  workspacePath?: string,
  stubPath?: string,
): Promise<{ jobId: string }> {
  const invoker = await resolvePiInvoker(stubPath)
  if (!invoker) return failedJob(sender, 'pi binary not found on PATH')
  if (scope === 'project' && !workspacePath) {
    return failedJob(sender, 'project scope requires a workspace')
  }

  const args: string[] = [...invoker.prefixArgs, action]
  if (action === 'update' && !spec) args.push('--extensions')
  if (spec) args.push(spec)
  if (scope === 'project') args.push('-l')

  return startJob(sender, invoker.command, args, {
    cwd: scope === 'project' ? workspacePath : undefined,
    env: invoker.env,
  })
}

/** One-click pi install/update via the user's own npm. */
export async function runPiInstall(sender: JobSender): Promise<{ jobId: string }> {
  const npm = await resolveBinary('npm')
  if (!npm) {
    return failedJob(
      sender,
      'npm was not found on your PATH. Install Node.js 22+ first (https://nodejs.org), then retry.',
    )
  }
  return startJob(sender, npm, ['install', '-g', '@earendil-works/pi-coding-agent'], {
    env: await piProcessEnv(),
  })
}

/** Binary presence for catalogue recommendations. */
export async function detectBinaries(claudeOverride?: string): Promise<{ claude: boolean }> {
  const path = claudeOverride ?? (await resolveBinary('claude'))
  return { claude: path !== null }
}

// ---------- Claude Code provider support (per-extension tab) ----------

/**
 * Parse `claude auth status` output (JSON on Claude Code 2.x). Tolerates
 * leading noise before the JSON object and non-JSON output from older CLIs.
 */
export function parseClaudeAuthStatus(stdout: string): ClaudeAuthStatus {
  const start = stdout.indexOf('{')
  if (start === -1) return { ok: false, error: stdout.trim().slice(0, 200) || 'no output' }
  try {
    const parsed = JSON.parse(stdout.slice(start)) as {
      loggedIn?: unknown
      authMethod?: unknown
      email?: unknown
    }
    return {
      ok: true,
      loggedIn: parsed.loggedIn === true,
      method: typeof parsed.authMethod === 'string' ? parsed.authMethod : undefined,
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
    }
  } catch {
    return { ok: false, error: 'unparseable auth status output' }
  }
}

/** Extract a version like "2.1.219" from mixed CLI output. */
function versionFrom(output: string): string | undefined {
  return /(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(output)?.[1]
}

/**
 * Claude Code CLI health for the provider tab: binary presence + version and
 * local auth state. `claude auth status` reads local credentials only (no
 * network round-trip), so probing on tab mount is fine.
 */
export async function claudeStatus(claudeOverride?: string): Promise<ClaudeStatus> {
  const path = claudeOverride ?? (await resolveBinary('claude'))
  if (!path) return { binary: { found: false }, auth: { ok: false, error: 'claude not found' } }

  const env = await piProcessEnv()
  let version: string | undefined
  try {
    const { stdout } = await execFileAsync(path, ['--version'], { timeout: 10_000, env })
    version = versionFrom(stdout)
  } catch {
    // Version is cosmetic; auth state below is the load-bearing part.
  }

  try {
    const { stdout } = await execFileAsync(path, ['auth', 'status'], { timeout: 10_000, env })
    return { binary: { found: true, path, version }, auth: parseClaudeAuthStatus(stdout) }
  } catch (error) {
    const failure = error as { stdout?: string; message: string }
    // Non-zero exit still prints the status JSON when logged out.
    const auth = failure.stdout
      ? parseClaudeAuthStatus(failure.stdout)
      : { ok: false, error: failure.message }
    return { binary: { found: true, path, version }, auth }
  }
}

/**
 * One-click provider proof: a single print-mode turn through the
 * pi-claude-cli provider, streamed like any package job. Runs from the OS
 * temp dir so no workspace is touched; spends one tiny prompt of plan usage.
 */
export async function runClaudeProviderTest(
  sender: JobSender,
  stubPath?: string,
): Promise<{ jobId: string }> {
  const invoker = await resolvePiInvoker(stubPath)
  if (!invoker) return failedJob(sender, 'pi binary not found on PATH')
  return startJob(
    sender,
    invoker.command,
    [
      ...invoker.prefixArgs,
      '-p',
      '--model',
      'pi-claude-cli/claude-haiku-4-5',
      'Reply with exactly: pidex-provider-ok',
    ],
    { cwd: tmpdir(), env: invoker.env },
  )
}
