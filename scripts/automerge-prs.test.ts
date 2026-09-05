// @vitest-environment node
import { describe, expect, it } from 'vitest'
// @ts-expect-error - plain-JS script, no declarations
import { decide, isWithinWindow, parseWindow } from './automerge-prs.mjs'

/**
 * The shape `gh pr view --json` returns for a PR that qualifies: mine, green,
 * unreviewed, no conflicts, up to date. Each test below spoils exactly one
 * field, so a gate that stops working shows up as one failure and not twelve.
 */
function greenPr(overrides: Record<string, unknown> = {}) {
  return {
    number: 169,
    title: 'feat: a thing',
    baseRefName: 'main',
    headRefName: 'pidex/a-thing',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: '',
    isCrossRepository: false,
    comments: [],
    reviews: [],
    statusCheckRollup: [
      { __typename: 'CheckRun', name: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
    behindBy: 0,
    ...overrides,
  }
}

describe('automerge decide', () => {
  it('merges a PR with no comments, green CI, no conflicts and no drift', () => {
    expect(decide(greenPr())).toEqual({
      action: 'merge',
      reason: 'no comments, CI green, no conflicts, up to date',
    })
  })

  describe('holds', () => {
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ['a draft', { isDraft: true }, /draft/],
      ['a conflicting branch', { mergeable: 'CONFLICTING' }, /conflicts/],
      ['mergeability still computing', { mergeable: 'UNKNOWN' }, /unknown/],
      ['a blocked merge state', { mergeStateStatus: 'BLOCKED' }, /merge state BLOCKED/],
      ['an unstable merge state', { mergeStateStatus: 'UNSTABLE' }, /merge state UNSTABLE/],
      ['changes requested', { reviewDecision: 'CHANGES_REQUESTED' }, /changes requested/],
      ['a required review', { reviewDecision: 'REVIEW_REQUIRED' }, /review required/],
      [
        'a human comment',
        { comments: [{ author: { login: 'someone', is_bot: false } }] },
        /1 comment/,
      ],
      [
        'a non-approving review',
        { reviews: [{ state: 'COMMENTED', author: { login: 'someone' } }] },
        /1 review/,
      ],
      ['no CI at all', { statusCheckRollup: [] }, /no CI has reported/],
      [
        'a check still running',
        {
          statusCheckRollup: [
            { __typename: 'CheckRun', name: 'CI', status: 'IN_PROGRESS', conclusion: null },
          ],
        },
        /still running/,
      ],
      [
        'a failing check',
        {
          statusCheckRollup: [
            { __typename: 'CheckRun', name: 'E2E', status: 'COMPLETED', conclusion: 'FAILURE' },
          ],
        },
        /CI failing: E2E/,
      ],
      [
        'a pending legacy status',
        {
          statusCheckRollup: [{ __typename: 'StatusContext', context: 'vercel', state: 'PENDING' }],
        },
        /still running/,
      ],
      [
        'a failing legacy status',
        {
          statusCheckRollup: [{ __typename: 'StatusContext', context: 'vercel', state: 'FAILURE' }],
        },
        /CI failing: vercel/,
      ],
      ['a fork branch', { isCrossRepository: true }, /on a fork/],
      ['a missing cross-repository field', { isCrossRepository: undefined }, /on a fork/],
      // The compare call failed. Without it we cannot tell tested-against-main
      // from tested-against-something-else, so nothing merges.
      ['an unknown base comparison', { behindBy: undefined }, /base comparison unavailable/],
    ]

    for (const [label, overrides, reason] of cases) {
      it(label, () => {
        const verdict = decide(greenPr(overrides))
        expect(verdict.action).toBe('hold')
        expect(verdict.reason).toMatch(reason)
      })
    }
  })

  describe('updates the branch instead of merging', () => {
    it('when green but behind the base', () => {
      expect(decide(greenPr({ behindBy: 3 }))).toEqual({
        action: 'update',
        reason: '3 commit(s) behind main',
      })
    })

    // The failure is what a person needs to know, so it must not be masked by
    // a branch update that would rerun the same red CI.
    it('but reports a real problem first', () => {
      const verdict = decide(
        greenPr({
          behindBy: 3,
          statusCheckRollup: [
            { __typename: 'CheckRun', name: 'E2E', status: 'COMPLETED', conclusion: 'FAILURE' },
          ],
        }),
      )
      expect(verdict).toEqual({ action: 'hold', reason: 'CI failing: E2E' })
    })
  })

  describe('does not hold', () => {
    it('a bot comment', () => {
      const pr = greenPr({ comments: [{ author: { login: 'github-actions[bot]', is_bot: true } }] })
      expect(decide(pr).action).toBe('merge')
    })

    it('an approval with nothing to act on', () => {
      const pr = greenPr({
        reviewDecision: 'APPROVED',
        reviews: [{ state: 'APPROVED', author: { login: 'someone' } }],
      })
      expect(decide(pr).action).toBe('merge')
    })

    it('a skipped or neutral check', () => {
      const pr = greenPr({
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'release', status: 'COMPLETED', conclusion: 'SKIPPED' },
          { __typename: 'CheckRun', name: 'label', status: 'COMPLETED', conclusion: 'NEUTRAL' },
        ],
      })
      expect(decide(pr).action).toBe('merge')
    })
  })
})

describe('automerge window', () => {
  const TORONTO = 'America/Toronto'
  const at = (iso: string) => isWithinWindow(new Date(iso), { timeZone: TORONTO })

  it('parses HH:MM-HH:MM into minutes from midnight', () => {
    expect(parseWindow('10:00-22:00')).toEqual({ start: 600, end: 1320 })
  })

  describe('refuses a window it cannot trust', () => {
    for (const bad of ['22:00-02:00', '9:00-22:00', '10:00-25:00', '22:00-22:00', '', undefined]) {
      it(`${bad === undefined ? 'nothing' : JSON.stringify(bad)}`, () => {
        expect(parseWindow(bad as string | undefined)).toBeNull()
      })
    }
  })

  it('is half-open on local wall-clock time', () => {
    // 14:00Z is 10:00 EDT: the window opens here and not a minute earlier.
    expect(at('2026-07-01T14:00:00Z')).toBe(true)
    expect(at('2026-07-01T13:59:00Z')).toBe(false)
    // 02:00Z is 22:00 EDT: closed at the end, same as it opens at the start.
    expect(at('2026-07-01T01:59:00Z')).toBe(true)
    expect(at('2026-07-01T02:00:00Z')).toBe(false)
  })

  it('follows the DST shift, which a UTC cron cannot', () => {
    // The same UTC hour on both sides of the shift: 14:00Z is 10:00 EDT in
    // July (inside) and 09:00 EST in January (outside). This is why the cron
    // band is only an approximation and the script holds the real rule.
    expect(at('2026-07-01T14:00:00Z')).toBe(true)
    expect(at('2026-01-01T14:00:00Z')).toBe(false)
    expect(at('2026-01-01T15:00:00Z')).toBe(true)
    // ...and the winter window still runs to 22:00 EST, i.e. 03:00Z.
    expect(at('2026-01-01T02:59:00Z')).toBe(true)
    expect(at('2026-01-01T03:00:00Z')).toBe(false)
  })

  it('holds every PR when the window or zone cannot be read', () => {
    const now = new Date('2026-07-01T16:00:00Z')
    expect(isWithinWindow(now, { window: 'all-day', timeZone: TORONTO })).toBe(false)
    expect(isWithinWindow(now, { timeZone: 'Mars/Phobos' })).toBe(false)
  })
})
