import { describe, it, expect } from 'vitest'
import type { FleetSession } from '@shared/models'
import { emptySession } from '../fleetReducer'
import { describeFleet, sweepPrompt, systemPreamble } from '../prompt'

const NOW = 10_000_000

function session(overrides: Partial<FleetSession>): FleetSession {
  return { ...emptySession('s1', '/repo', { now: NOW }), ...overrides }
}

describe('systemPreamble', () => {
  it('states the autopilot posture explicitly in both modes', () => {
    expect(systemPreamble('pidex', false)).toContain('Autopilot is OFF')
    expect(systemPreamble('pidex', true)).toContain('Autopilot is ON')
  })

  it('carries the guarantees that user rules must not override', () => {
    const prompt = systemPreamble('pidex', true)
    expect(prompt).toContain('Never act on a session silently')
    expect(prompt).toContain('Prefer reporting over acting')
    expect(prompt).toContain('Never answer a clarifying question you are not confident about')
  })
})

describe('describeFleet', () => {
  it('says so plainly when nothing is running', () => {
    expect(describeFleet([])).toBe('No sessions are running right now.')
  })

  it('leads with what is blocked, and reports idle time in minutes', () => {
    const text = describeFleet(
      [
        session({
          sessionId: 'a',
          title: 'session-writer locks',
          phase: 'awaiting-input',
          idleSince: NOW - 14 * 60_000,
          pendingQuestion: {
            requestId: 'q',
            method: 'select',
            title: 'Where should the lock live?',
            askedAt: NOW,
          },
        }),
      ],
      NOW,
    )
    expect(text).toContain('BLOCKED asking: "Where should the lock live?"')
    expect(text).toContain('idle 14m')
  })

  it('excludes the orchestrator itself', () => {
    const text = describeFleet(
      [session({ sessionId: 'orc', title: 'me', isOrchestrator: true })],
      NOW,
    )
    expect(text).toBe('No sessions are running right now.')
  })
})

describe('sweepPrompt', () => {
  const fleet = [session({ sessionId: 'a', title: 'auth refactor', phase: 'streaming' })]

  it('brief asks for a digest and forbids acting', () => {
    const prompt = sweepPrompt('brief', fleet, NOW)
    expect(prompt).toContain('auth refactor')
    expect(prompt).toContain('Do not steer or stop anything.')
  })

  /**
   * Regression from a real run: a capable model did the whole analysis, wrote
   * a good summary in chat, and never called the tool — so the home screen
   * stayed empty and the sweep looked broken. Both kinds must state the
   * requirement as the definition of success, not as a trailing aside.
   */
  it.each(['brief', 'review'] as const)('%s demands publish_digest explicitly', (kind) => {
    const prompt = sweepPrompt(kind, fleet, NOW)
    expect(prompt).toContain('MUST finish by calling publish_digest exactly once')
    expect(prompt).toContain('a sweep that does not publish has failed')
  })

  it('review asks for the finished-work judgement that motivated it', () => {
    const prompt = sweepPrompt('review', fleet, NOW)
    expect(prompt).toContain('whose work is merged is finished')
    expect(prompt).toContain('suggest archiving')
  })
})
