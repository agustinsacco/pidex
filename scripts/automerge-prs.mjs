#!/usr/bin/env node
// Merge open PRs that nobody has commented on, whose CI is green, and that
// have no conflicts. Everything else is left alone, with a printed reason.
//
// The decision is a pure function (`decide`) over one `gh pr view --json`
// object, so the rules are unit-tested without touching the network — see
// `automerge-prs.test.ts`. Only `main()` talks to GitHub.
//
// Every gate fails CLOSED: an unknown value, a missing field, or a check
// still running holds the PR. A held PR costs a ten-minute wait; a wrongly
// merged one costs a revert on main.
//
// Usage:
//   scripts/automerge-prs.mjs              # merge what qualifies
//   scripts/automerge-prs.mjs --dry-run    # print the verdicts, merge nothing
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
  'url',
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
 * @param {object} pr one PR, with at least PR_FIELDS populated
 * @returns {{ merge: boolean, reason: string }}
 */
export function decide(pr) {
  const hold = (reason) => ({ merge: false, reason })

  if (pr.isDraft) return hold('draft')

  // A fork PR can be green and silent and still be from a stranger. `gh` has
  // no authorAssociation field, but a branch inside this repo already implies
  // push access, so cross-repository is the trust gate.
  if (pr.isCrossRepository !== false) return hold('branch is on a fork')

  // MERGEABLE | CONFLICTING | UNKNOWN. UNKNOWN means GitHub is still computing
  // the merge commit; the next run gets a real answer.
  if (pr.mergeable !== 'MERGEABLE') {
    return hold(
      pr.mergeable === 'CONFLICTING' ? 'conflicts with the base branch' : 'mergeability unknown',
    )
  }

  // CLEAN is the only state that means "GitHub would let this merge right
  // now". BLOCKED covers branch protection, BEHIND an out-of-date branch,
  // UNSTABLE a failing or pending check.
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

  return { merge: true, reason: 'no comments, CI green, no conflicts' }
}

async function gh(args) {
  const { stdout } = await exec('gh', args, { maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run')
  const onlyIndex = argv.indexOf('--pr')
  const only = onlyIndex >= 0 ? argv[onlyIndex + 1] : null

  const numbers = only
    ? [Number(only)]
    : JSON.parse(
        await gh(['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number']),
      ).map((p) => p.number)

  if (numbers.length === 0) {
    console.log('no open PRs')
    return 0
  }

  let merged = 0
  for (const number of numbers) {
    // Per-PR, because `gh pr list` cannot return mergeStateStatus.
    const pr = JSON.parse(await gh(['pr', 'view', String(number), '--json', PR_FIELDS.join(',')]))
    const { merge, reason } = decide(pr)

    if (!merge) {
      console.log(`#${number} hold — ${reason}  (${pr.title})`)
      continue
    }
    if (dryRun) {
      console.log(`#${number} WOULD MERGE — ${reason}  (${pr.title})`)
      continue
    }

    try {
      await gh(['pr', 'merge', String(number), '--squash', '--delete-branch'])
      console.log(`#${number} merged — ${reason}  (${pr.title})`)
      merged += 1
    } catch (error) {
      // A PR that became stale between the read and the merge is expected;
      // report it and keep going rather than failing the whole run.
      console.log(`#${number} merge failed — ${String(error.stderr || error.message).trim()}`)
    }
  }

  if (merged > 0) console.log(`merged ${merged} PR(s)`)
  return 0
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
