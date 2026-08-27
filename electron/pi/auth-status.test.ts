import { describe, expect, it } from 'vitest'
import { SUBSCRIPTION_PROVIDERS, parseAuthCheck } from './auth-status'

describe('parseAuthCheck', () => {
  it('reads the shapes pi actually emits', () => {
    // Captured from pi 0.84.2: `pi auth check --provider <id> --json --no-refresh`
    expect(parseAuthCheck('{"status":"ready","provider":"openai-codex"}')).toEqual({
      status: 'ready',
    })
    expect(
      parseAuthCheck(
        '{"status":"not_ready","provider":"anthropic","reason":"credentials_not_configured"}',
      ),
    ).toEqual({ status: 'not_ready', reason: 'credentials_not_configured' })
  })

  it('keeps the reason when pi does not know the provider', () => {
    expect(
      parseAuthCheck('{"status":"not_ready","provider":"nope","reason":"provider_not_found"}'),
    ).toEqual({ status: 'not_ready', reason: 'provider_not_found' })
  })

  it('reads the last line, so a warning above the JSON is survivable', () => {
    const stdout = 'warning: something on stderr-ish\n{"status":"ready","provider":"anthropic"}\n'
    expect(parseAuthCheck(stdout)).toEqual({ status: 'ready' })
  })

  it('degrades to unknown rather than throwing', () => {
    // This runs for every provider on every settings open; one malformed line
    // must not take the tab down.
    for (const bad of ['', '   ', 'not json at all', '{', '{"status":"weird"}', 'null', '[]']) {
      expect(parseAuthCheck(bad).status).toBe('unknown')
    }
  })

  it('never reports ready for anything but an explicit ready', () => {
    expect(parseAuthCheck('{"status":"READY"}').status).toBe('unknown')
    expect(parseAuthCheck('{"ready":true}').status).toBe('unknown')
  })
})

describe('SUBSCRIPTION_PROVIDERS', () => {
  it('uses ids pi accepts, and says what each one costs', () => {
    // These ids are the auth.json keys; a typo silently reports "unknown"
    // forever, so pin them.
    expect(SUBSCRIPTION_PROVIDERS.map((p) => p.id)).toEqual([
      'openai-codex',
      'anthropic',
      'github-copilot',
      'kimi-for-coding',
      'xai',
      'openrouter',
      'radius',
    ])
    for (const provider of SUBSCRIPTION_PROVIDERS) {
      expect(provider.name).toBeTruthy()
      expect(provider.requires).toBeTruthy()
    }
    // Subscriptions first — the Accounts tab renders in this order, and a
    // per-token provider sitting under "a plan you already pay for" would be
    // an outright lie about what signing in costs.
    const billing = SUBSCRIPTION_PROVIDERS.map((p) => p.billing)
    expect(billing.lastIndexOf('subscription')).toBeLessThan(billing.indexOf('balance'))
  })

  it('warns that Anthropic OAuth does not spend plan limits', () => {
    // The whole reason the Claude Code provider extension exists. If this
    // caveat ever disappears the tab starts quietly recommending the
    // more expensive path.
    const anthropic = SUBSCRIPTION_PROVIDERS.find((p) => p.id === 'anthropic')
    expect(anthropic?.caveat).toMatch(/not against your Claude plan limits/i)
  })
})
