// @vitest-environment node
import { describe, expect, it } from 'vitest'
// @ts-expect-error - plain-JS script, no declarations
import { decide } from './automerge-prs.mjs'

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
