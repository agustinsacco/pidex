#!/usr/bin/env node
// Merge open PRs that nobody has commented on, whose CI is green, and that
// have no conflicts. Everything else is left alone, with a printed reason.
//
// The driver is `.github/workflows/automerge.yml`, which runs this after CI
// finishes. It is not a poller: a merge lands on main, main's CI runs, that
// completion triggers the next evaluation, and the queue drains one PR at a
// time. `--dry-run` locally prints the verdicts and touches nothing.
//
// The decision is a pure function (`decide`) over one `gh pr view --json`
// object plus a `behindBy` count, so the rules are unit-tested without
// touching the network — see `automerge-prs.test.ts`. Only `main()` runs `gh`.
//
// Every gate fails CLOSED: an unknown value, a missing field, or a check
// still running holds the PR. A held PR costs one CI cycle; a wrongly merged
// one costs a revert on main.
//
// Usage:
//   scripts/automerge-prs.mjs              # merge/update what qualifies
//   scripts/automerge-prs.mjs --dry-run    # print the verdicts, change nothing
//   scripts/automerge-prs.mjs --pr 169     # consider one PR only

import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/** Fields `decide` reads. Requested for every PR. */
export const PR_FIELDS = [
  'number',
  'title',
  'baseRefName',
  'headRefName',
  'isDraft',
  'mergeable',
  'mergeStateStatus',
  'reviewDecision',
  'isCrossRepository',
  'comments',
  'reviews',
  'statusCheckRollup',
]

/** Comment authors whose noise must not stall a PR forever. */
function isBot(author) {
  return Boolean(author?.is_bot) || /\[bot\]$/.test(author?.login ?? '')
}

/** A check result that counts as "not a failure". */
const CHECK_OK = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL'])

/**
 * @param {object} pr one PR from `gh pr view --json`, plus `behindBy`: how
 *   many commits of the base branch its head is missing.
 * @returns {{ action: 'merge' | 'update' | 'hold', reason: string }}
 */
export function decide(pr) {
  const hold = (reason) => ({ action: 'hold', reason })

  if (pr.isDraft) return hold('draft')

  // A fork PR can be green and silent and still be from a stranger. `gh` has
  // no authorAssociation field, but a branch inside this repo already implies
  // push access, so cross-repository is the trust gate.
  if (pr.isCrossRepository !== false) return hold('branch is on a fork')

  // MERGEABLE | CONFLICTING | UNKNOWN. UNKNOWN means GitHub is still computing
  // the merge commit, which is normal for a few seconds after the base branch
  // moves; the next run gets a real answer.
  if (pr.mergeable !== 'MERGEABLE') {
    return hold(
      pr.mergeable === 'CONFLICTING' ? 'conflicts with the base branch' : 'mergeability unknown',
    )
  }

  // CLEAN is the only state that means "GitHub would let this merge right
  // now". BLOCKED covers branch protection, UNSTABLE a failing or pending
  // check, BEHIND an out-of-date branch that protection insists on.
  if (pr.mergeStateStatus !== 'CLEAN') {
    return hold(`merge state ${pr.mergeStateStatus || 'unknown'}`)
  }

  if (pr.reviewDecision === 'CHANGES_REQUESTED') return hold('changes requested')
  if (pr.reviewDecision === 'REVIEW_REQUIRED') return hold('review required')

  const humanComments = (pr.comments ?? []).filter((c) => !isBot(c.author))
  if (humanComments.length > 0) {
    return hold(`${humanComments.length} comment(s) to read`)
  }

  // An approval is not feedback to act on, so it does not hold. Any other
  // review state does, including a bare COMMENTED with an empty body.
  const openReviews = (pr.reviews ?? []).filter((r) => r.state !== 'APPROVED')
  if (openReviews.length > 0) {
    return hold(`${openReviews.length} review(s) to read`)
  }

  const checks = pr.statusCheckRollup ?? []
  if (checks.length === 0) return hold('no CI has reported')

  // Two shapes arrive in one array: CheckRun (Actions, `status`/`conclusion`)
  // and StatusContext (legacy commit statuses, `state` only).
  const pending = checks.filter((c) =>
    c.__typename === 'StatusContext'
      ? c.state === 'PENDING' || c.state === 'EXPECTED'
      : c.status !== 'COMPLETED',
  )
  if (pending.length > 0) return hold(`${pending.length} check(s) still running`)

  const failed = checks.filter(
    (c) => !CHECK_OK.has(c.__typename === 'StatusContext' ? c.state : c.conclusion),
  )
  if (failed.length > 0) {
    return hold(`CI failing: ${failed.map((c) => c.name || c.context).join(', ')}`)
  }

  // Green, but green against an older main. This repo has no branch
  // protection, so GitHub still calls it CLEAN and would happily merge a
  // combination no CI run ever saw. Update the branch instead: that push
  // reruns CI, and the completion brings us back here with behindBy 0.
  //
  // Checked LAST so a PR that is both behind and failing reports the failure,
  // which is the thing a person needs to know.
  if (pr.behindBy === undefined) return hold('base comparison unavailable')
  if (pr.behindBy > 0) {
    return { action: 'update', reason: `${pr.behindBy} commit(s) behind ${pr.baseRefName}` }
  }

  return { action: 'merge', reason: 'no comments, CI green, no conflicts, up to date' }
}

async function gh(args) {
  const { stdout } = await exec('gh', args, { maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

/** Commits of `base` that `head` is missing, or undefined if unknowable. */
async function behindBy(repo, base, head) {
  try {
    const out = await gh(['api', `repos/${repo}/compare/${base}...${head}`, '--jq', '.behind_by'])
    const value = Number(out.trim())
    return Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run')
  const onlyIndex = argv.indexOf('--pr')
  const only = onlyIndex >= 0 ? argv[onlyIndex + 1] : null

  const repo = (
    await gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
  ).trim()

  const numbers = only
    ? [Number(only)]
    : JSON.parse(
        await gh(['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number']),
      ).map((p) => p.number)

  if (numbers.length === 0) {
    console.log('no open PRs')
    return 0
  }

  let failures = 0
  for (const number of numbers) {
    // Per-PR, because `gh pr list` cannot return mergeStateStatus.
    const pr = JSON.parse(await gh(['pr', 'view', String(number), '--json', PR_FIELDS.join(',')]))
    pr.behindBy = await behindBy(repo, pr.baseRefName, pr.headRefName)

    const { action, reason } = decide(pr)
    const label = `#${number}`

    if (action === 'hold') {
      console.log(`${label} hold — ${reason}  (${pr.title})`)
      continue
    }
    if (dryRun) {
      console.log(`${label} WOULD ${action.toUpperCase()} — ${reason}  (${pr.title})`)
      continue
    }

    try {
      if (action === 'update') {
        await gh(['pr', 'update-branch', String(number)])
        console.log(`${label} branch updated — ${reason}  (${pr.title})`)
        continue
      }

      // The REST endpoint, not `gh pr merge`: that command also runs local
      // git (checkout base, delete local branch), which fails in a worktree
      // checkout and on a CI runner AFTER the merge already happened, so a
      // success reports as a failure. This touches nothing local.
      await gh([
        'api',
        '-X',
        'PUT',
        `repos/${repo}/pulls/${number}/merge`,
        '-f',
        'merge_method=squash',
      ])
      console.log(`${label} merged — ${reason}  (${pr.title})`)

      // Best-effort tidy-up. A left-behind branch is not worth a red run.
      await gh(['api', '-X', 'DELETE', `repos/${repo}/git/refs/heads/${pr.headRefName}`]).catch(
        () => {},
      )
    } catch (error) {
      // A PR that went stale between the read and the write is expected, but
      // a token without merge rights looks identical here, so it must be
      // loud: a non-zero exit turns the run red and GitHub emails about it.
      console.log(`${label} ${action} failed — ${String(error.stderr || error.message).trim()}`)
      failures += 1
    }
  }

  return failures > 0 ? 1 : 0
}

const invokedDirectly =
  Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error)
      process.exit(1)
    },
  )
}
