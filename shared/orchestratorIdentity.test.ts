import { describe, it, expect } from 'vitest'
import { ORCHESTRATOR_NAME_PREFIX } from './models'
import { isOrchestratorSession, orchestratorSessionName } from './orchestratorIdentity'

const meta = (path: string, name?: string) => ({ path, name })

describe('isOrchestratorSession', () => {
  it('matches the prefs pointer', () => {
    expect(isOrchestratorSession(meta('/s/orc.jsonl'), ['/s/orc.jsonl'])).toBe(true)
    expect(isOrchestratorSession(meta('/s/work.jsonl'), ['/s/orc.jsonl'])).toBe(false)
  })

  /** Prefs can be wiped or the file moved between machines; the name cannot. */
  it('falls back to the name sentinel when prefs know nothing', () => {
    expect(isOrchestratorSession(meta('/s/orc.jsonl', orchestratorSessionName('pidex')))).toBe(true)
    expect(isOrchestratorSession(meta('/s/orc.jsonl', `${ORCHESTRATOR_NAME_PREFIX}`))).toBe(true)
  })

  it('does not match ordinary sessions', () => {
    expect(isOrchestratorSession(meta('/s/a.jsonl'))).toBe(false)
    expect(isOrchestratorSession(meta('/s/a.jsonl', 'orchestrate the build'))).toBe(false)
    expect(isOrchestratorSession(meta('/s/a.jsonl', 'Orchestrator notes'))).toBe(false)
  })

  it('names a project thread readably', () => {
    expect(orchestratorSessionName('pidex')).toBe('✳ Orchestrator · pidex')
  })
})
