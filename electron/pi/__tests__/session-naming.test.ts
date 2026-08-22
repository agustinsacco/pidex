import { describe, expect, it } from 'vitest'
import { dedupeTitle, sanitizeTitle, titlePrompt } from '../session-naming'

describe('titlePrompt', () => {
  it('carries the message and the existing names', () => {
    const prompt = titlePrompt('fix the sidebar resize handle', ['Sidebar Polish', 'Auth Bug'])
    expect(prompt).toContain('fix the sidebar resize handle')
    expect(prompt).toContain('- Sidebar Polish')
    expect(prompt).toContain('- Auth Bug')
  })

  it('omits the existing-names section when there are none', () => {
    expect(titlePrompt('hello', [])).not.toContain('Existing session names')
    expect(titlePrompt('hello', ['  '])).not.toContain('Existing session names')
  })

  it('caps a pathological first message', () => {
    const prompt = titlePrompt('x'.repeat(50_000), [])
    expect(prompt.length).toBeLessThan(2500)
  })
})

describe('sanitizeTitle', () => {
  it('takes the last non-empty line and strips wrapping', () => {
    expect(sanitizeTitle('Here is the name:\n\n"Sidebar Resize Fix."\n')).toBe('Sidebar Resize Fix')
  })

  it('passes a clean single line through', () => {
    expect(sanitizeTitle('Composer Autogrow Bug')).toBe('Composer Autogrow Bug')
  })

  it('collapses internal whitespace and caps length', () => {
    expect(sanitizeTitle('A   Very\tSpaced   Name')).toBe('A Very Spaced Name')
    expect(sanitizeTitle('B'.repeat(200))!.length).toBeLessThanOrEqual(60)
  })

  it('returns null for empty or quote-only output', () => {
    expect(sanitizeTitle('')).toBeNull()
    expect(sanitizeTitle('\n  \n')).toBeNull()
    expect(sanitizeTitle('""')).toBeNull()
  })
})

describe('dedupeTitle', () => {
  it('returns the title untouched when free', () => {
    expect(dedupeTitle('Sidebar Fix', ['Auth Bug'])).toBe('Sidebar Fix')
  })

  it('suffixes on a case-insensitive collision', () => {
    expect(dedupeTitle('Sidebar Fix', ['sidebar fix'])).toBe('Sidebar Fix 2')
    expect(dedupeTitle('Sidebar Fix', ['Sidebar Fix', 'Sidebar Fix 2'])).toBe('Sidebar Fix 3')
  })
})
