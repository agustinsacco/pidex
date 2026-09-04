import { describe, it, expect } from 'vitest'
import { isClaudeCliModel, usageUnavailableReason, windowTitle } from './claudeUsage'
import type { ClaudeUsageWindow } from '@shared/models'

const window = (over: Partial<ClaudeUsageWindow>): ClaudeUsageWindow => ({
  label: 'Current session',
  kind: 'five_hour',
  percentUsed: 12,
  resetsAt: null,
  ...over,
})

describe('windowTitle', () => {
  it('names the two windows pidex knows', () => {
    expect(windowTitle(window({}))).toBe('5-hour window')
    expect(windowTitle(window({ kind: 'weekly', label: 'Current week (all models)' }))).toBe(
      'Weekly window',
    )
  })

  it('passes an unknown label through rather than guessing', () => {
    const label = 'One-time credit · Expires Sep 30'
    expect(windowTitle(window({ kind: 'other', label }))).toBe(label)
  })
})

describe('usageUnavailableReason', () => {
  it('gives a distinct, actionable sentence per failure', () => {
    const reasons = (['claude-not-found', 'run-failed', 'no-usage'] as const).map(
      usageUnavailableReason,
    )
    expect(new Set(reasons).size).toBe(3)
    expect(reasons[0]).toContain('PATH')
    expect(reasons[2]).toContain('sign in')
  })
})

describe('isClaudeCliModel', () => {
  it('matches on either field pi may carry the provider in', () => {
    expect(isClaudeCliModel({ provider: 'pi-claude-cli', api: 'anthropic' })).toBe(true)
    expect(isClaudeCliModel({ provider: 'anthropic', api: 'pi-claude-cli' })).toBe(true)
  })

  it('leaves every other provider alone, including when the model is unknown', () => {
    // Plan usage governs nothing on these, so the section must not appear.
    expect(isClaudeCliModel({ provider: 'anthropic', api: 'anthropic' })).toBe(false)
    expect(isClaudeCliModel({ provider: 'amazon-bedrock', api: 'anthropic' })).toBe(false)
    expect(isClaudeCliModel(undefined)).toBe(false)
    expect(isClaudeCliModel(null)).toBe(false)
  })
})
