import { describe, expect, it } from 'vitest'
import { summarizeChecks } from './gh-cli'

describe('summarizeChecks', () => {
  it('is undefined when there are no checks at all', () => {
    expect(summarizeChecks(undefined)).toBeUndefined()
    expect(summarizeChecks([])).toBeUndefined()
  })

  it('counts CheckRun conclusions', () => {
    expect(
      summarizeChecks([
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' },
        { __typename: 'CheckRun', status: 'IN_PROGRESS' },
      ]),
    ).toEqual({ passed: 1, failed: 1, pending: 1, total: 3 })
  })

  it('understands StatusContext entries, which use `state` not `conclusion`', () => {
    // A repo mixing Actions with an external reporter (e.g. Vercel) returns
    // both shapes in one rollup; counting only `conclusion` would call the
    // external ones pending forever.
    expect(
      summarizeChecks([
        { __typename: 'StatusContext', state: 'SUCCESS' },
        { __typename: 'StatusContext', state: 'ERROR' },
        { __typename: 'StatusContext', state: 'PENDING' },
      ]),
    ).toEqual({ passed: 1, failed: 1, pending: 1, total: 3 })
  })

  it('treats neutral and skipped as passing, not failing', () => {
    expect(
      summarizeChecks([
        { conclusion: 'NEUTRAL', status: 'COMPLETED' },
        { conclusion: 'SKIPPED', status: 'COMPLETED' },
      ]),
    ).toEqual({ passed: 2, failed: 0, pending: 0, total: 2 })
  })

  it('counts queued and pending work as pending', () => {
    expect(
      summarizeChecks([
        { status: 'QUEUED' },
        { status: 'PENDING' },
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
      ]),
    ).toEqual({ passed: 1, failed: 0, pending: 2, total: 3 })
  })

  it('counts cancelled and timed_out as failures', () => {
    expect(
      summarizeChecks([
        { status: 'COMPLETED', conclusion: 'CANCELLED' },
        { status: 'COMPLETED', conclusion: 'TIMED_OUT' },
      ]),
    ).toEqual({ passed: 0, failed: 2, pending: 0, total: 2 })
  })
})
