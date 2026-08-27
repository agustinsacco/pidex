import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  claudeProjectDirName,
  claudeProjectsRoot,
  claudeSessionFileForCwd,
  sessionDirNameForCwd,
} from './pi-paths'

/**
 * Both mangling rules are wire contracts with programs we do not control, and
 * both are load-bearing: get one wrong and we look for a session's ledger at a
 * path that cannot exist. The Claude Code cases below are transcribed from
 * real directories under ~/.claude/projects.
 */

describe('sessionDirNameForCwd (pi)', () => {
  it('joins segments with dashes and wraps in double dashes', () => {
    expect(sessionDirNameForCwd('/home/dev/proj')).toBe('--home-dev-proj--')
  })

  it('keeps dots, unlike the CLI', () => {
    expect(sessionDirNameForCwd('/home/dev/proj/.claude/worktrees/wt')).toBe(
      '--home-dev-proj-.claude-worktrees-wt--',
    )
  })
})

describe('claudeProjectDirName (Claude Code CLI)', () => {
  it('dashes every separator, with no wrapping', () => {
    expect(claudeProjectDirName('/home/dev/proj')).toBe('-home-dev-proj')
  })

  it('dashes dots too — which is where a separators-only rule breaks', () => {
    // The regression this guards: worktrees live under `.claude/`, so this is
    // the shape of nearly every session that has a CLI ledger at all.
    expect(claudeProjectDirName('/home/dev/proj/.claude/worktrees/wt')).toBe(
      '-home-dev-proj--claude-worktrees-wt',
    )
  })

  it('dashes every other non-alphanumeric, including underscores and colons', () => {
    expect(claudeProjectDirName('/home/dev/my_proj')).toBe('-home-dev-my-proj')
    expect(claudeProjectDirName('C:\\Users\\dev\\proj')).toBe('C--Users-dev-proj')
  })

  it('leaves a name of exactly the 200-character limit alone', () => {
    const cwd = '/' + 'a'.repeat(199)
    expect(claudeProjectDirName(cwd)).toHaveLength(200)
    expect(claudeProjectDirName(cwd)).toBe('-' + 'a'.repeat(199))
  })

  it('truncates past the limit and appends the CLI hash of the unmangled cwd', () => {
    // Verbatim from a real ~/.claude/projects directory: the source cwd
    // mangles to 201 characters, one over, so the CLI kept the first 200 and
    // appended `-81g7h6`. Reproducing that suffix is the whole point of the
    // hash — a prefix match alone would find the wrong project.
    const cwd =
      '/tmp/claude-1000/-home-agustinsacco-src-agustinsacco-pidex--claude-worktrees-pi-agent-cli-integration-b2e20a/aafae7b3-f013-473d-b384-bc1f3676c36b/scratchpad/matrix-thinking/claude-sonnet-5-websearch/ws'
    expect(claudeProjectDirName(cwd)).toBe(
      '-tmp-claude-1000--home-agustinsacco-src-agustinsacco-pidex--claude-worktrees-pi-agent-cli-integration-b2e20a-aafae7b3-f013-473d-b384-bc1f3676c36b-scratchpad-matrix-thinking-claude-sonnet-5-websearch-w-81g7h6',
    )
  })

  it('distinguishes two cwds that share a 200-character prefix', () => {
    const a = claudeProjectDirName('/' + 'a'.repeat(220) + '/one')
    const b = claudeProjectDirName('/' + 'a'.repeat(220) + '/two')
    expect(a.slice(0, 200)).toBe(b.slice(0, 200))
    expect(a).not.toBe(b)
  })
})

describe('claudeSessionFileForCwd', () => {
  const original = process.env.CLAUDE_CONFIG_DIR

  afterEach(() => {
    if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = original
  })

  it('names the file by the session id pi passes through to the CLI', () => {
    process.env.CLAUDE_CONFIG_DIR = '/cfg/claude'
    expect(claudeSessionFileForCwd('/home/dev/proj', 'sess-uuid-1')).toBe(
      join('/cfg/claude', 'projects', '-home-dev-proj', 'sess-uuid-1.jsonl'),
    )
  })

  it('honours the CLI\u2019s own CLAUDE_CONFIG_DIR override', () => {
    process.env.CLAUDE_CONFIG_DIR = '/elsewhere'
    expect(claudeProjectsRoot()).toBe(join('/elsewhere', 'projects'))
  })
})
