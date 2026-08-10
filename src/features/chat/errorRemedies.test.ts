import { describe, expect, it } from 'vitest'
import { matchErrorRemedy } from './errorRemedies'

describe('matchErrorRemedy', () => {
  it('matches the real Bedrock SSO expiry message', () => {
    const remedy = matchErrorRemedy(
      "Token is expired. To refresh this SSO session run 'aws sso login' with the corresponding profile.",
    )
    expect(remedy?.command).toBe('aws sso login')
    expect(remedy?.retryAfter).toBe(true)
    expect(remedy?.hint).toMatch(/--profile/)
  })

  it('targets the active AWS profile when one is set', () => {
    const remedy = matchErrorRemedy('Token is expired, run aws sso login', { awsProfile: 'prod' })
    expect(remedy?.command).toBe('aws sso login --profile prod')
    expect(remedy?.hint).toContain('"prod"')
  })

  it('matches expired STS credentials', () => {
    expect(matchErrorRemedy('ExpiredTokenException: the token has expired')?.command).toMatch(
      /aws sso login/,
    )
    expect(
      matchErrorRemedy('The security token included in the request is invalid')?.command,
    ).toMatch(/aws sso login/)
  })

  it('suggests pi /login for OAuth failures', () => {
    const remedy = matchErrorRemedy('OAuth refresh token rejected')
    expect(remedy?.command).toBe('pi')
    expect(remedy?.label).toBe('Run pi /login')
  })

  it('returns null for unknown errors rather than guessing a command', () => {
    expect(matchErrorRemedy('The model request failed.')).toBeNull()
    expect(matchErrorRemedy('rate limit exceeded, please slow down')).toBeNull()
    expect(matchErrorRemedy('overloaded_error: upstream capacity')).toBeNull()
    expect(matchErrorRemedy(undefined)).toBeNull()
    expect(matchErrorRemedy('')).toBeNull()
  })

  it('does not fire on a plain 401 with no login hint', () => {
    expect(matchErrorRemedy('401 Unauthorized')).toBeNull()
  })
})
