import { describe, expect, it } from 'vitest'
import { isPoisonedThreadError, modelRisksMalformedToolNames } from './threadHealth'

describe('isPoisonedThreadError', () => {
  // Verbatim from a bricked orchestrator thread (MiniMax M2 via Bedrock).
  const real =
    'Validation error: 1 validation error detected: Value at ' +
    "'messages.3.member.content.2.member.toolUse.name' failed to satisfy constraint: " +
    'Member must satisfy regular expression pattern: [a-zA-Z0-9_-]+'

  it('recognises the real bricked-thread error', () => {
    expect(isPoisonedThreadError(real)).toBe(true)
  })

  it('is false for no error at all', () => {
    expect(isPoisonedThreadError(null)).toBe(false)
    expect(isPoisonedThreadError(undefined)).toBe(false)
    expect(isPoisonedThreadError('')).toBe(false)
  })

  it('does not offer to throw away a thread over a transient failure', () => {
    // These are retryable; suggesting a reset here would destroy a working
    // conversation to fix a network blip.
    expect(isPoisonedThreadError('fetch failed')).toBe(false)
    expect(isPoisonedThreadError('429 Too Many Requests')).toBe(false)
    expect(isPoisonedThreadError('Request timed out after 60s')).toBe(false)
  })

  it('does not fire on an unrelated validation error', () => {
    // A validation error that is not about a tool name is not fixed by a reset.
    expect(
      isPoisonedThreadError(
        "Validation error: Value at 'messages.0.role' failed to satisfy constraint: " +
          'Member must satisfy enum value set: [user, assistant]',
      ),
    ).toBe(false)
  })

  it('needs both halves, so neither alone is enough', () => {
    expect(isPoisonedThreadError('regular expression pattern: [a-z]+')).toBe(false)
    expect(isPoisonedThreadError('the tool name was odd')).toBe(false)
  })
})

describe('modelRisksMalformedToolNames', () => {
  it('flags the model observed bricking threads, however its id is spelled', () => {
    expect(modelRisksMalformedToolNames('minimax-m2')).toBe(true)
    expect(modelRisksMalformedToolNames('MiniMax-M2')).toBe(true)
    expect(modelRisksMalformedToolNames('us.minimax.m2-v1:0')).toBe(true)
  })

  it('leaves everything else alone', () => {
    expect(modelRisksMalformedToolNames('claude-opus-5')).toBe(false)
    expect(modelRisksMalformedToolNames('gpt-5')).toBe(false)
    expect(modelRisksMalformedToolNames(null)).toBe(false)
    expect(modelRisksMalformedToolNames(undefined)).toBe(false)
  })
})
