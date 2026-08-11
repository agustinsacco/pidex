import { describe, expect, it } from 'vitest'
import { IGNORED_DIR_PATTERN, MAX_WATCH_DEPTH } from '../workspace-watcher'

/**
 * Guards the fix for the monorepo freeze: chokidar opens one fd per watched
 * directory, and on augment-services (2.7M entries) an unbounded walk with the
 * original short ignore list reached 47,060 directories and threw EMFILE from
 * inside the main process. Both the prune list and the depth cap are what keep
 * that bounded, so both are pinned here.
 */
describe('workspace watcher bounds', () => {
  it('prunes the heavy directories that made the walk unbounded', () => {
    for (const dir of ['node_modules', '.git', 'dist', 'build', 'target', 'vendor', '.venv']) {
      expect(IGNORED_DIR_PATTERN.test(`/repo/${dir}`)).toBe(true)
      expect(IGNORED_DIR_PATTERN.test(`/repo/${dir}/nested/deep.ts`)).toBe(true)
    }
  })

  it('prunes nested occurrences, not just top-level ones', () => {
    // The monorepo's cost was 767 nested node_modules, not the root one.
    expect(IGNORED_DIR_PATTERN.test('/repo/packages/api/node_modules/lodash/index.js')).toBe(true)
  })

  it('does not prune ordinary source paths', () => {
    for (const path of [
      '/repo/src/features/chat/MessageList.tsx',
      '/repo/electron/fs/git-info.ts',
      '/repo/distribution/service.ts', // substring of "dist", must NOT match
      '/repo/src/outbound/client.ts', // substring of "out", must NOT match
    ]) {
      expect(IGNORED_DIR_PATTERN.test(path)).toBe(false)
    }
  })

  it('keeps the depth cap shallow enough to stay responsive', () => {
    // At depth 4 the same repo cost 3,354 dirs / 523ms; at 6, over two minutes.
    expect(MAX_WATCH_DEPTH).toBeLessThanOrEqual(4)
  })
})
