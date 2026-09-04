// @vitest-environment node
import { describe, expect, it } from 'vitest'
// @ts-expect-error - plain-JS script, no declarations
import { decide } from './automerge-prs.mjs'

/**
 * The shape `gh pr view --json` returns for a PR that qualifies: mine, green,
 * unreviewed, no conflicts. Each test below spoils exactly one field, so a
 * gate that stops working shows up as one failure and not twelve.
 */
function greenPr(overrides: Record<string, unknown> = {}) {
  return {
    number: 169,
    title: 'feat: a thing',
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
    ...overrides,
  }
}

describe('automerge decide', () => {
  it('merges a PR with no comments, green CI and no conflicts', () => {
    expect(decide(greenPr())).toEqual({
      merge: true,
      reason: 'no comments, CI green, no conflicts',
    })
  })

  describe('holds', () => {
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ['a draft', { isDraft: true }, /draft/],
      ['a conflicting branch', { mergeable: 'CONFLICTING' }, /conflicts/],
      ['mergeability still computing', { mergeable: 'UNKNOWN' }, /unknown/],
      ['a blocked merge state', { mergeStateStatus: 'BLOCKED' }, /merge state BLOCKED/],
      ['an out-of-date branch', { mergeStateStatus: 'BEHIND' }, /merge state BEHIND/],
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
    ]

    for (const [label, overrides, reason] of cases) {
      it(label, () => {
        const verdict = decide(greenPr(overrides))
        expect(verdict.merge).toBe(false)
        expect(verdict.reason).toMatch(reason)
      })
    }
  })

  describe('does not hold', () => {
    it('a bot comment', () => {
      const pr = greenPr({ comments: [{ author: { login: 'github-actions[bot]', is_bot: true } }] })
      expect(decide(pr).merge).toBe(true)
    })

    it('an approval with nothing to act on', () => {
      const pr = greenPr({
        reviewDecision: 'APPROVED',
        reviews: [{ state: 'APPROVED', author: { login: 'someone' } }],
      })
      expect(decide(pr).merge).toBe(true)
    })

    it('a skipped or neutral check', () => {
      const pr = greenPr({
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'release', status: 'COMPLETED', conclusion: 'SKIPPED' },
          { __typename: 'CheckRun', name: 'label', status: 'COMPLETED', conclusion: 'NEUTRAL' },
        ],
      })
      expect(decide(pr).merge).toBe(true)
    })
  })
})
