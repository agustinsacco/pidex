/**
 * pidex lane-loop extension — loaded into every pidex session via
 * `pi --mode rpc -e <this file>`.
 *
 * A lane is one unit of work: one charter, one branch, one worktree, one agent
 * process, one exit. This extension owns the lane's **state**, as distinct from
 * its transcript, which is only its history. It runs a fixed ladder of oracles
 * when a turn settles and publishes the result over `ctx.ui.setStatus`, which
 * pidex already routes per session.
 *
 * The load-bearing property is who is allowed to fill a rung.
 *
 *   **Only this file, executing a command, may set a rung result.**
 *
 * The model has no tool that writes a rung and cannot see this interface. Its
 * claims never touch the ladder. That constraint is the whole feature: an agent
 * writing code that prints PASS is a documented, measured behaviour, and a
 * "done" backed by prose is not evidence. So the surface renders exit codes.
 *
 * Two of the six rungs are oracles nothing in this market computes:
 *
 * - `diff` fails above the size where measured review effectiveness collapses.
 *   An unreviewable change is a failed acceptance test.
 * - `merge` is a `git merge-tree` dry run against the current base. It finds
 *   the conflict before the tokens are spent rather than after.
 *
 * `pr` is present and unfilled from turn one, because an agent that learns at
 * the end that its work needs a pull request has already made every decision
 * that makes one hard.
 *
 * Provider-agnostic by construction: this runs *processes*, it does not
 * intercept tool calls, so it works identically on a native provider and on
 * the Claude Code CLI bridge where tool interception does not reach.
 */

interface PiExtensionApi {
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void
  exec?(
    file: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ): Promise<{ code?: number | null; stdout?: string; stderr?: string }>
}

interface ExtensionContext {
  ui?: { setStatus?(key: string, text: string | undefined): void }
  cwd?: string
  signal?: { aborted?: boolean }
}

type RungState = 'stale' | 'pass' | 'fail' | 'running' | 'unconfigured'

interface Rung {
  key: string
  state: RungState
  command?: string
  exitCode?: number
  detail?: string
  at?: number
  durationMs?: number
}

const STATUS_KEY = 'pidex-lane-loop'

/** Wall-clock cap per rung. A slow suite must not hold a turn open forever. */
const RUNG_TIMEOUT_MS = 120_000

/** Review-capacity bounds. See the header note on the `diff` rung. */
const DIFF_BUDGET = { lines: 400, files: 20 }

/**
 * The command each rung runs, resolved from the project.
 *
 * Deliberately not configurable from inside the model's reach: the ladder is a
 * property of the project, read from `package.json` scripts, not something a
 * turn can redefine on its way past.
 */
interface RungSpec {
  key: string
  file: string
  args: string[]
  /** Skip entirely when this returns false — renders `unconfigured`. */
  available: (scripts: Record<string, unknown>) => boolean
}

const COMMAND_RUNGS: RungSpec[] = [
  {
    key: 'tsc',
    file: 'npm',
    args: ['run', '--silent', 'typecheck'],
    available: (s) => typeof s.typecheck === 'string',
  },
  {
    key: 'test',
    file: 'npm',
    args: ['run', '--silent', 'test'],
    available: (s) => typeof s.test === 'string',
  },
  {
    key: 'lint',
    file: 'npm',
    args: ['run', '--silent', 'lint'],
    available: (s) => typeof s.lint === 'string',
  },
]

/** First meaningful line of output, for the hint. Never the whole log. */
function firstProblemLine(stdout: string, stderr: string): string | undefined {
  const lines = `${stderr}\n${stdout}`
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const interesting = lines.find((l) => /error|fail|✕|×|✗/i.test(l)) ?? lines[0]
  if (!interesting) return undefined
  return interesting.length > 180 ? `${interesting.slice(0, 179)}…` : interesting
}

export default function laneLoop(pi: PiExtensionApi): void {
  const exec = pi.exec?.bind(pi)
  if (!exec) return

  let inFlight = false

  async function run(
    cwd: string,
    file: string,
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const result = await exec!(file, args, { cwd, timeout: RUNG_TIMEOUT_MS })
    return {
      code: typeof result.code === 'number' ? result.code : 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    }
  }

  async function readScripts(cwd: string): Promise<Record<string, unknown>> {
    try {
      const { code, stdout } = await run(cwd, 'cat', ['package.json'])
      if (code !== 0) return {}
      const parsed = JSON.parse(stdout) as { scripts?: Record<string, unknown> }
      return parsed.scripts ?? {}
    } catch {
      return {}
    }
  }

  /** `+a −r · files` against the merge base, plus the conflict dry run. */
  /**
   * Does this lane have an open pull request?
   *
   * This rung used to be hardcoded to `stale`, so it could NEVER light up. A
   * lane that had committed, pushed AND opened a PR still rendered an empty
   * `pr` rung: observed on `pidex/adding-another-claude-account`, whose PR #90
   * was open while the banner said it still owed one. A rung that cannot
   * change state is worse than no rung, because it is a gauge that lies.
   *
   * `gh` may be absent, unauthenticated, or pointed at a non-GitHub remote.
   * None of that is a statement about the lane, so it reports `unconfigured`
   * ("not measured here") rather than `stale` ("you still owe a PR").
   */
  async function prRung(cwd: string): Promise<Rung> {
    const now = Date.now()
    try {
      const out = await run(cwd, 'gh', ['pr', 'view', '--json', 'number,state,isDraft'])
      if (out.code !== 0) {
        const text = `${out.stderr}\n${out.stdout}`
        // "no pull requests found" is a real answer: the lane owes one.
        if (/no (open )?pull requests?/i.test(text)) {
          return { key: 'pr', state: 'stale', command: 'gh pr view', at: now }
        }
        return { key: 'pr', state: 'unconfigured', at: now }
      }
      const parsed = JSON.parse(out.stdout) as {
        number?: number
        state?: string
        isDraft?: boolean
      }
      const state = (parsed.state ?? '').toUpperCase()
      if (state !== 'OPEN' && state !== 'MERGED') {
        return { key: 'pr', state: 'stale', command: 'gh pr view', at: now }
      }
      return {
        key: 'pr',
        state: 'pass',
        command: 'gh pr view',
        exitCode: 0,
        at: now,
        detail: `#${String(parsed.number ?? '?')}${parsed.isDraft ? ' draft' : ''} ${state.toLowerCase()}`,
      }
    } catch {
      return { key: 'pr', state: 'unconfigured', at: now }
    }
  }

  async function gitRungs(cwd: string): Promise<{
    diff: Rung
    merge: Rung
    pr: Rung
    stat?: { added: number; removed: number; files: number }
    branch?: string
  }> {
    const now = Date.now()
    const stale = (key: string): Rung => ({ key, state: 'stale', at: now })
    try {
      const branchOut = await run(cwd, 'git', ['rev-parse', '--abbrev-ref', 'HEAD'])
      const branch = branchOut.code === 0 ? branchOut.stdout.trim() : undefined

      // Base is the merge base with the default branch, so the stat measures
      // this lane's own work rather than everything trunk moved on by.
      // TWO refs, and conflating them was a bug. `base` is the merge base and
      // is the right thing to measure the DIFF against: it isolates this
      // lane's own work from everything trunk moved on by. `tip` is the
      // current default-branch head, and it is the only thing worth testing a
      // MERGE against.
      //
      // The first version merged HEAD against `base` using `base` as the merge
      // base, which is a fast-forward by construction and so returned exit 0
      // unconditionally: the merge rung could not fail. Verified against a
      // scratch repo with a genuine conflicting change on main, where the old
      // form exits 0 and the form below exits 1.
      let base = ''
      let tip = ''
      for (const candidate of ['origin/HEAD', 'origin/main', 'main', 'origin/master', 'master']) {
        const mb = await run(cwd, 'git', ['merge-base', 'HEAD', candidate])
        if (mb.code === 0 && mb.stdout.trim()) {
          base = mb.stdout.trim()
          tip = candidate
          break
        }
      }
      if (!base) {
        return { diff: stale('diff'), merge: stale('merge'), pr: await prRung(cwd), branch }
      }

      const stat = await run(cwd, 'git', ['diff', '--numstat', base])
      let added = 0
      let removed = 0
      let files = 0
      for (const line of stat.stdout.split('\n')) {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 3) continue
        files += 1
        added += Number(parts[0]) || 0
        removed += Number(parts[1]) || 0
      }

      const over = added + removed > DIFF_BUDGET.lines || files > DIFF_BUDGET.files
      const diff: Rung = {
        key: 'diff',
        state: over ? 'fail' : 'pass',
        command: `git diff --numstat ${base.slice(0, 8)}`,
        at: now,
        ...(over
          ? {
              detail:
                `${added + removed} lines across ${files} files is past the ` +
                `${DIFF_BUDGET.lines}-line / ${DIFF_BUDGET.files}-file review budget`,
            }
          : {}),
      }

      // `merge-tree --write-tree` reports conflicts without touching any
      // working directory: exit 0 gives a tree oid, exit 1 the conflict list.
      const merged = await run(cwd, 'git', [
        'merge-tree',
        '--write-tree',
        `--merge-base=${base}`,
        'HEAD',
        tip,
      ])
      const merge: Rung = {
        key: 'merge',
        state: merged.code === 0 ? 'pass' : 'fail',
        command: `git merge-tree --write-tree HEAD ${tip}`,
        exitCode: merged.code,
        at: now,
        ...(merged.code === 0
          ? {}
          : {
              detail: firstProblemLine(merged.stdout, merged.stderr) ?? 'conflicts with the base',
            }),
      }

      return { diff, merge, pr: await prRung(cwd), stat: { added, removed, files }, branch }
    } catch {
      return {
        diff: stale('diff'),
        merge: stale('merge'),
        pr: { key: 'pr', state: 'unconfigured' },
      }
    }
  }

  async function publish(ctx: ExtensionContext): Promise<void> {
    const setStatus = ctx.ui?.setStatus
    const cwd = ctx.cwd
    if (typeof setStatus !== 'function' || !cwd) return
    // One ladder run at a time. A settle that arrives while the previous run
    // is still going is dropped rather than queued: the next settle will
    // publish fresher numbers anyway, and two concurrent test runs in one
    // worktree is exactly the contention this whole design exists to avoid.
    if (inFlight) return
    inFlight = true

    try {
      const scripts = await readScripts(cwd)
      const rungs: Rung[] = []

      for (const spec of COMMAND_RUNGS) {
        if (ctx.signal?.aborted) return
        if (!spec.available(scripts)) {
          rungs.push({ key: spec.key, state: 'unconfigured' })
          continue
        }
        const startedAt = Date.now()
        const { code, stdout, stderr } = await run(cwd, spec.file, spec.args)
        rungs.push({
          key: spec.key,
          state: code === 0 ? 'pass' : 'fail',
          command: `${spec.file} ${spec.args.join(' ')}`,
          exitCode: code,
          at: Date.now(),
          durationMs: Date.now() - startedAt,
          ...(code === 0 ? {} : { detail: firstProblemLine(stdout, stderr) }),
        })
      }

      const git = await gitRungs(cwd)
      rungs.push(git.diff, git.merge, git.pr)

      setStatus.call(
        ctx.ui,
        STATUS_KEY,
        JSON.stringify({
          rungs,
          ...(git.stat ? { diff: git.stat } : {}),
          diffBudget: DIFF_BUDGET,
          ...(git.branch ? { branch: git.branch } : {}),
          updatedAt: Date.now(),
        }),
      )
    } catch {
      // A status push must never break a turn. Same rule as every other
      // extension in this repo.
    } finally {
      inFlight = false
    }
  }

  // At rest only. Running a test suite mid-stream would both contend with the
  // agent's own commands and burn wall-clock the user is waiting on.
  pi.on('agent_settled', (_event, ctx) => {
    void publish(ctx as ExtensionContext)
  })
}
