// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = resolve(import.meta.dirname, '../should-skip-release.sh')

/** True when the script says "skip publishing" (exit 0). */
function skips(message: string): boolean {
  try {
    execFileSync(script, [message], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * The release pipeline reads this to decide whether a merge ships.
 *
 * It exists because the first version matched the WHOLE commit message: the
 * commit that introduced the feature described `[skip release]` in its body,
 * the guard matched its own documentation, and v0.1.37 silently never
 * published. Subject-only is the fix, and these lock it in.
 */
describe('should-skip-release', () => {
  it('skips when the marker is in the subject', () => {
    expect(skips('chore: tweak readme [skip release]')).toBe(true)
    expect(skips('[skip release] docs only')).toBe(true)
  })

  it('does NOT skip when the marker only appears in the body', () => {
    // The exact regression: a commit that documents the feature must still ship.
    const message = [
      'feat: publish a release on every green main build',
      '',
      '`[skip release]` skips publishing; an existing tag skips rather than',
      'fails, so re-runs are safe.',
    ].join('\n')
    expect(skips(message)).toBe(false)
  })

  it('does not skip an ordinary commit', () => {
    expect(skips('fix: correct the sidebar overflow')).toBe(false)
    expect(skips('feat: add a thing\n\nWith a longer body.')).toBe(false)
  })

  it('handles an empty or whitespace-only message', () => {
    expect(skips('')).toBe(false)
    expect(skips('\n\n')).toBe(false)
  })

  it('is literal, not a pattern — related words do not trigger it', () => {
    expect(skips('chore: skip release notes for now')).toBe(false)
    expect(skips('chore: [skip ci] but still release')).toBe(false)
  })
})
