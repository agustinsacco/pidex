import { DEFAULT_DIFF_BUDGET, DEFAULT_LANE_RUNGS } from '@shared/models'
import type { LaneLoop, LaneRung, LaneRungState } from '@shared/models'

/**
 * Parsing and reading the lane loop, as published by `pi-ext/lane-loop.ts`
 * over pi's status channel.
 *
 * Pure on purpose: this is the one thing on the fleet surface the user is
 * meant to trust, so it must be testable without a subprocess, and a
 * malformed payload must degrade to "no ladder" rather than throw. Same rules
 * as every other status payload in this app: JSON in a string, the parser
 * returns null on garbage, a missing key renders nothing.
 */

export const LANE_LOOP_STATUS_KEY = 'pidex-lane-loop'

const STATES = new Set<LaneRungState>(['stale', 'pass', 'fail', 'running', 'unconfigured'])

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asText(value: unknown, max = 200): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  // Bounded: `detail` is the first line of a failure, never a whole log, and
  // an unbounded string here would land in a fixed-height banner.
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/**
 * Parse the status payload into a ladder.
 *
 * Unknown rung keys are dropped rather than appended: the ladder's order is
 * fixed per project, and an extension publishing a surprise rung must not be
 * able to reorder a surface the user reads by position.
 */
export function parseLaneLoop(statusText: string | undefined): LaneLoop | null {
  if (!statusText) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(statusText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const raw = parsed as Record<string, unknown>
  if (!Array.isArray(raw.rungs)) return null

  const byKey = new Map<string, Record<string, unknown>>()
  for (const item of raw.rungs) {
    if (!item || typeof item !== 'object') continue
    const rung = item as Record<string, unknown>
    if (typeof rung.key === 'string') byKey.set(rung.key, rung)
  }

  const rungs: LaneRung[] = DEFAULT_LANE_RUNGS.map(({ key, label }) => {
    const found = byKey.get(key)
    const state =
      found && STATES.has(found.state as LaneRungState) ? (found.state as LaneRungState) : 'stale'
    return {
      key,
      label,
      state,
      ...(asText(found?.command, 120) ? { command: asText(found?.command, 120)! } : {}),
      ...(asNumber(found?.exitCode) !== undefined ? { exitCode: asNumber(found?.exitCode)! } : {}),
      ...(asText(found?.detail) ? { detail: asText(found?.detail)! } : {}),
      ...(asNumber(found?.at) !== undefined ? { at: asNumber(found?.at)! } : {}),
      ...(asNumber(found?.durationMs) !== undefined
        ? { durationMs: asNumber(found?.durationMs)! }
        : {}),
    }
  })

  const diffRaw = raw.diff as Record<string, unknown> | undefined
  const diff =
    diffRaw && typeof diffRaw === 'object'
      ? {
          added: asNumber(diffRaw.added) ?? 0,
          removed: asNumber(diffRaw.removed) ?? 0,
          files: asNumber(diffRaw.files) ?? 0,
        }
      : undefined

  const budgetRaw = raw.diffBudget as Record<string, unknown> | undefined
  const diffBudget =
    budgetRaw && typeof budgetRaw === 'object'
      ? {
          lines: asNumber(budgetRaw.lines) ?? DEFAULT_DIFF_BUDGET.lines,
          files: asNumber(budgetRaw.files) ?? DEFAULT_DIFF_BUDGET.files,
        }
      : DEFAULT_DIFF_BUDGET

  return {
    rungs,
    ...(diff ? { diff } : {}),
    diffBudget,
    ...(asText(raw.branch, 120) ? { branch: asText(raw.branch, 120)! } : {}),
    updatedAt: asNumber(raw.updatedAt) ?? Date.now(),
  }
}

/**
 * Which rung the lane is standing on: the first that is not passing.
 *
 * `unconfigured` rungs are skipped rather than treated as blockers — a project
 * with no lint script has not failed lint. Returns null when every configured
 * rung passes, which is the only state that means "ready".
 */
export function currentRung(loop: LaneLoop): LaneRung | null {
  return loop.rungs.find((r) => r.state !== 'pass' && r.state !== 'unconfigured') ?? null
}

/** True when every configured rung passes. The only honest "ready to land". */
export function laneIsGreen(loop: LaneLoop): boolean {
  return currentRung(loop) === null
}

/**
 * One line naming the next thing that has to be true.
 *
 * Generated mechanically from rung state. No model runs to produce this, which
 * is what lets it sit above the composer permanently without costing anything
 * and without being able to lie.
 */
export function laneHint(loop: LaneLoop): string {
  const failed = loop.rungs.filter((r) => r.state === 'fail')
  const first = failed[0]
  if (first) {
    const detail = first.detail ? ` — ${first.detail}` : ''
    const rest = failed.length > 1 ? `, and ${failed.length - 1} more` : ''
    return `${first.label} failed${detail}${rest}.`
  }

  const running = loop.rungs.find((r) => r.state === 'running')
  if (running) return `Running ${running.label}…`

  const next = currentRung(loop)
  if (!next) return 'Every check passes. This lane can open its PR.'

  return `${next.label} has not run since the last edit.`
}

/**
 * The one thing the lane should do next, as an action rather than a sentence.
 *
 * The banner used to state a problem and stop. That leaves the operator to
 * retype an instruction the surface already knows, which is interaction time
 * spent on something a machine can compose. Every action here is a message
 * sent into the lane, so accepting one costs a keystroke rather than a
 * paragraph.
 *
 * Returns null when there is nothing mechanical to ask for — a passing ladder
 * needs no nudge, and inventing one would be exactly the alarm-without-a-
 * response the register exists to forbid.
 */
export interface LaneAction {
  /** Button text. */
  label: string
  /** The message delivered to the lane. */
  prompt: string
  /** Which rung this is about, for the tooltip. */
  rung: string
}

export function laneAction(loop: LaneLoop): LaneAction | null {
  const failed = loop.rungs.filter((r) => r.state === 'fail')

  const diff = failed.find((r) => r.key === 'diff')
  if (diff) {
    const budget = loop.diffBudget ?? DEFAULT_DIFF_BUDGET
    return {
      rung: 'diff',
      label: 'Ask for a split',
      prompt:
        `This lane is past its review budget of ${budget.lines} lines / ${budget.files} files. ` +
        `Do not add more code. Propose how to split the work already here into a stack of ` +
        `smaller pull requests, smallest first, and say which files go in each. ` +
        `If you believe the change genuinely cannot be split, say why in one paragraph.`,
    }
  }

  const other = failed[0]
  if (other) {
    return {
      rung: other.key,
      label: `Fix ${other.label}`,
      prompt:
        `The ${other.label} check is failing${other.detail ? `: ${other.detail}` : ''}. ` +
        `Reproduce it with \`${other.command ?? other.label}\`, fix the cause rather than the ` +
        `symptom, and re-run it. Do not change the check itself to make it pass.`,
    }
  }

  return null
}

/** The pending PR rung is its own compact CTA, not a second button below it. */
export function lanePrAction(loop: LaneLoop): LaneAction | null {
  const next = currentRung(loop)
  if (next?.key !== 'pr') return null
  return {
    rung: 'pr',
    label: 'Open a pull request for this lane',
    prompt:
      `Every check passes. Commit anything outstanding, push the branch, and open a pull ` +
      `request with \`gh pr create\`. Title it for the change, and in the body say what it ` +
      `does, how it was verified, and anything you deliberately left out.`,
  }
}

/** `+118 −22 · 4 files`, or undefined when there is nothing to say. */
export function diffLabel(loop: LaneLoop): string | undefined {
  if (!loop.diff) return undefined
  const { added, removed, files } = loop.diff
  if (added === 0 && removed === 0) return undefined
  return `+${added} −${removed} · ${files} file${files === 1 ? '' : 's'}`
}

/** True when the change has grown past the size where review stops working. */
export function overDiffBudget(loop: LaneLoop): boolean {
  const budget = loop.diffBudget ?? DEFAULT_DIFF_BUDGET
  if (!loop.diff) return false
  return loop.diff.added + loop.diff.removed > budget.lines || loop.diff.files > budget.files
}
