import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ORCHESTRATOR_PREFS,
  ORCHESTRATOR_MODES,
  ORCHESTRATOR_MODE_INFO,
  modeAllowsSessionControl,
  modeAllowsStartingWork,
  orchestratorModeOf,
} from '../models'

describe('orchestratorModeOf', () => {
  it('uses an explicit mode when present', () => {
    expect(orchestratorModeOf({ mode: 'observe' })).toBe('observe')
    expect(orchestratorModeOf({ mode: 'autopilot' })).toBe('autopilot')
  })

  it('defaults to supervise for prefs that have never been set', () => {
    expect(orchestratorModeOf({})).toBe('supervise')
    expect(DEFAULT_ORCHESTRATOR_PREFS.mode).toBe('supervise')
  })

  // Prefs are persisted JSON: installs from before modes carry `autopilot`.
  it('migrates the pre-modes boolean rather than silently downgrading', () => {
    expect(orchestratorModeOf({ autopilot: true })).toBe('autopilot')
    expect(orchestratorModeOf({ autopilot: false })).toBe('supervise')
  })

  it('prefers an explicit mode over a stale boolean', () => {
    expect(orchestratorModeOf({ mode: 'observe', autopilot: true })).toBe('observe')
  })

  it('falls back for a mode string that is no longer valid', () => {
    expect(orchestratorModeOf({ mode: 'yolo' as never })).toBe('supervise')
  })
})

describe('mode capabilities', () => {
  it('observe is read-only', () => {
    expect(modeAllowsSessionControl('observe')).toBe(false)
    expect(modeAllowsStartingWork('observe')).toBe(false)
  })

  it('supervise may act on sessions but not start them', () => {
    expect(modeAllowsSessionControl('supervise')).toBe(true)
    expect(modeAllowsStartingWork('supervise')).toBe(false)
  })

  it('autopilot may do both', () => {
    expect(modeAllowsSessionControl('autopilot')).toBe(true)
    expect(modeAllowsStartingWork('autopilot')).toBe(true)
  })

  it('capability is monotonic across the declared order', () => {
    // The picker presents these as a single axis; if that stops being true the
    // UI is lying about what switching does.
    const control = ORCHESTRATOR_MODES.map(modeAllowsSessionControl)
    const start = ORCHESTRATOR_MODES.map(modeAllowsStartingWork)
    expect(control).toEqual([false, true, true])
    expect(start).toEqual([false, false, true])
  })

  it('every mode has a label and a summary for the picker', () => {
    for (const mode of ORCHESTRATOR_MODES) {
      expect(ORCHESTRATOR_MODE_INFO[mode].label.length).toBeGreaterThan(0)
      expect(ORCHESTRATOR_MODE_INFO[mode].summary.length).toBeGreaterThan(0)
    }
  })
})
