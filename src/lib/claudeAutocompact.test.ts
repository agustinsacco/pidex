import { describe, it, expect } from 'vitest'
import { isValidAutocompactValue } from './claudeAutocompact'

describe('isValidAutocompactValue', () => {
  it('accepts keywords', () => {
    expect(isValidAutocompactValue('auto')).toBe(true)
    expect(isValidAutocompactValue('AUTO')).toBe(true)
    expect(isValidAutocompactValue('off')).toBe(true)
  })

  it('accepts windows from 100k to 1M in every accepted form', () => {
    expect(isValidAutocompactValue('100k')).toBe(true)
    expect(isValidAutocompactValue('300k')).toBe(true)
    expect(isValidAutocompactValue('0.5M')).toBe(true)
    expect(isValidAutocompactValue('1m')).toBe(true)
    expect(isValidAutocompactValue('400000')).toBe(true)
    // Bare numbers are thousands — the CLI's own shorthand.
    expect(isValidAutocompactValue('400')).toBe(true)
    expect(isValidAutocompactValue('100')).toBe(true)
  })

  it('rejects well-formed values outside the range — the provider would silently fall back', () => {
    expect(isValidAutocompactValue('77k')).toBe(false)
    expect(isValidAutocompactValue('99')).toBe(false)
    expect(isValidAutocompactValue('2M')).toBe(false)
    expect(isValidAutocompactValue('1000001')).toBe(false)
  })

  it('rejects junk', () => {
    expect(isValidAutocompactValue('')).toBe(false)
    expect(isValidAutocompactValue('lots')).toBe(false)
    expect(isValidAutocompactValue('40%')).toBe(false)
    expect(isValidAutocompactValue('-200k')).toBe(false)
    expect(isValidAutocompactValue('0')).toBe(false)
  })
})
