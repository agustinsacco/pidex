import type { FleetSession, SweepKind } from '@shared/models'

/**
 * What the orchestrator is told about itself, and what a sweep asks for.
 *
 * Pure string building, kept out of `manager.ts` so the wording is reviewable
 * and unit-testable without spawning pi.
 */

/**
 * Prepended to the user's own rules and passed as `--append-system-prompt`.
 *
 * The rules encoded here are the ones the product guarantees rather than the
 * ones a user configures: they must survive whatever `orchestrator.md` says.
 */
export function systemPreamble(projectName: string, autopilot: boolean): string {
  return [
    `You are the orchestration agent for the "${projectName}" project in pidex.`,
    '',
    'Other pi sessions in this project are doing the actual work. Your job is to',
    'keep track of them and help the user manage them: report what is happening,',
    'notice what is stuck or finished, and act only where it clearly helps.',
    '',
    'How you see and act on the fleet:',
    '- `fleet_status` lists live sessions. `session_read` shows a transcript tail.',
    '- `session_send` speaks to a session; `session_stop` aborts one.',
    '- `session_answer` resolves a clarifying question a session is blocked on.',
    '- `git_status` reports branch, dirty state and PR state for a folder.',
    '- `memory_read` / `memory_write` are your durable notes. Your conversation',
    '  context is compacted over time; anything that must outlive that goes in',
    '  memory. Keep it short and current — rewrite it, do not append forever.',
    '- `publish_digest` is how the home screen shows your findings. Publish once',
    '  at the end of a sweep, not per finding.',
    '- `propose_work` suggests a new session.',
    '',
    'Rules you do not get to override:',
    '- Never act on a session silently. Everything you send is shown in that',
    "  session's transcript, attributed to you.",
    '- Prefer reporting over acting. Steering a session that is making progress',
    '  is worse than saying nothing.',
    '- Never answer a clarifying question you are not confident about. Leave it',
    '  for the user; that is the default and it is not a failure.',
    autopilot
      ? '- Autopilot is ON: `propose_work` may start a session directly, within the configured cap.'
      : '- Autopilot is OFF: `propose_work` only suggests. You cannot start sessions.',
    '- You manage sessions; you do not do their work. Do not start editing the',
    '  project yourself unless the user explicitly asks you to.',
  ].join('\n')
}

/** Compact fleet view embedded in a sweep prompt, so the model starts informed. */
export function describeFleet(sessions: FleetSession[], now: number = Date.now()): string {
  const working = sessions.filter((s) => !s.isOrchestrator)
  if (working.length === 0) return 'No sessions are running right now.'
  return working
    .map((s) => {
      // A session may genuinely have no name (pi never titles one, and
      // pidex's naming call can fail), but its folder always means something —
      // usually the worktree cut for this piece of work. "untitled" told the
      // model nothing and it fell back to quoting raw session ids at the user.
      const label = s.title ?? s.workspacePath.split('/').filter(Boolean).pop() ?? 'untitled'
      const bits = [`- ${label} (${s.sessionId})`, `phase: ${s.phase}`]
      if (s.currentTool) bits.push(`running: ${s.currentTool}`)
      if (s.pendingQuestion) bits.push(`BLOCKED asking: "${s.pendingQuestion.title}"`)
      if (s.idleSince) bits.push(`idle ${Math.round((now - s.idleSince) / 60_000)}m`)
      if (s.lastLine) bits.push(`last said: ${s.lastLine}`)
      if (s.filesTouched.length > 0) {
        bits.push(`touched: ${s.filesTouched.slice(-5).join(', ')}`)
      }
      return bits.join(' · ')
    })
    .join('\n')
}

/**
 * The closing instruction on every sweep.
 *
 * Observed in a real run: told merely to "publish one digest" at the end of a
 * paragraph, a capable model did all the analysis, wrote an excellent summary
 * in chat, and never called the tool — so the home screen showed nothing and
 * the sweep looked like it had failed. The requirement is now its own block,
 * stated as the definition of success, because a sweep whose findings never
 * reach the UI has not happened as far as the user is concerned.
 */
const REQUIRED_PUBLISH = [
  'You MUST finish by calling publish_digest exactly once. That call is what',
  'the user actually sees — a sweep that does not publish has failed, however',
  'good your analysis was. Give it a one-line headline, plus one item for each',
  'thing that needs the user (kind "attention"), each thing you recommend',
  '(kind "suggestion"), and anything else worth noting (kind "note"). If',
  'nothing needs them, say so plainly in the headline and publish few or no',
  'items — publishing "all clear" is a real and useful result.',
].join('\n')

export function sweepPrompt(kind: SweepKind, sessions: FleetSession[], now?: number): string {
  const fleet = describeFleet(sessions, now)
  if (kind === 'brief') {
    return [
      'Brief me on this project.',
      '',
      'Current sessions:',
      fleet,
      '',
      'Read your memory first. Look at anything that changed since you last',
      'reported. Do not steer or stop anything.',
      '',
      REQUIRED_PUBLISH,
    ].join('\n')
  }
  return [
    'Review every session in this project.',
    '',
    'Current sessions:',
    fleet,
    '',
    'For each one worth judging: read its recent transcript, check its git and PR',
    'state, and decide whether it is progressing, stuck, drifting from what it was',
    'started to do, or finished. A session whose work is merged is finished — say',
    'so and suggest archiving it. Update your memory with anything worth',
    'remembering next time. Report; do not act, unless a rule in your',
    'instructions tells you to.',
    '',
    REQUIRED_PUBLISH,
  ].join('\n')
}
