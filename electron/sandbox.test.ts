import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxFolder, nextSandboxName } from './sandbox'

describe('nextSandboxName', () => {
  it('starts at sandbox-1 for an empty base', () => {
    expect(nextSandboxName([])).toBe('sandbox-1')
  })

  it('continues past the highest existing number', () => {
    expect(nextSandboxName(['sandbox-1', 'sandbox-3'])).toBe('sandbox-4')
  })

  it('ignores names that are not exactly sandbox-N', () => {
    expect(nextSandboxName(['sandbox-abc', 'sandbox-2x', 'other', '.DS_Store'])).toBe('sandbox-1')
  })
})

describe('createSandboxFolder', () => {
  it('creates the base and a fresh numbered folder inside it', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'pidex-sandbox-test-'))
    try {
      const base = join(scratch, 'sandboxes')
      const first = createSandboxFolder(base)
      const second = createSandboxFolder(base)
      expect(first).toBe(join(base, 'sandbox-1'))
      expect(second).toBe(join(base, 'sandbox-2'))
      expect(existsSync(first)).toBe(true)
      expect(existsSync(second)).toBe(true)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})
