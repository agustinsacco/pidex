import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkAgentSettings, patchAgentSettings, readAgentSettings } from '../agent-settings'

/**
 * Regression guard: a malformed settings.json must never be overwritten by a
 * patch. Merging onto a failed parse silently dropped every existing key
 * (defaultProvider, defaultModel, packages[], …).
 */
describe('pi agent settings', () => {
  let dir: string
  let previousEnv: string | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pidex-settings-'))
    previousEnv = process.env.PI_CODING_AGENT_DIR
    process.env.PI_CODING_AGENT_DIR = dir
  })

  afterEach(async () => {
    if (previousEnv === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previousEnv
    await rm(dir, { recursive: true, force: true })
  })

  const settingsPath = (): string => join(dir, 'settings.json')

  it('creates a fresh file when none exists', async () => {
    await patchAgentSettings('global', undefined, { defaultThinkingLevel: 'high' })
    const written = JSON.parse(await readFile(settingsPath(), 'utf8'))
    expect(written).toEqual({ defaultThinkingLevel: 'high' })
  })

  it('merges into existing settings without dropping unrelated keys', async () => {
    await writeFile(
      settingsPath(),
      JSON.stringify({
        defaultProvider: 'local-stark',
        defaultModel: 'Qwen 3.5 122b',
        packages: ['pi-web-access'],
      }),
    )
    await patchAgentSettings('global', undefined, { hideThinkingBlock: true })
    const written = JSON.parse(await readFile(settingsPath(), 'utf8'))
    expect(written).toEqual({
      defaultProvider: 'local-stark',
      defaultModel: 'Qwen 3.5 122b',
      packages: ['pi-web-access'],
      hideThinkingBlock: true,
    })
  })

  it('merges nested compaction/retry one level deep', async () => {
    await writeFile(
      settingsPath(),
      JSON.stringify({ compaction: { enabled: true, reserveTokens: 50000 } }),
    )
    await patchAgentSettings('global', undefined, { compaction: { keepRecentTokens: 20000 } })
    const written = JSON.parse(await readFile(settingsPath(), 'utf8'))
    expect(written.compaction).toEqual({
      enabled: true,
      reserveTokens: 50000,
      keepRecentTokens: 20000,
    })
  })

  it('REFUSES to write when the existing file is malformed, leaving it untouched', async () => {
    // Exactly the shape of the real-world breakage: a stray character.
    const broken =
      '{\n  "defaultProvider": "local-stark",\n  "compaction": { "enabled": true,y }\n}'
    await writeFile(settingsPath(), broken)

    await expect(
      patchAgentSettings('global', undefined, { hideThinkingBlock: true }),
    ).rejects.toThrow(/not valid JSON/)

    // The user's file survives byte-for-byte.
    expect(await readFile(settingsPath(), 'utf8')).toBe(broken)
  })

  it('reports malformed state so the UI can block editing', async () => {
    await writeFile(settingsPath(), '{ "oops": true,, }')
    const health = await checkAgentSettings()
    expect(health.global.exists).toBe(true)
    expect(health.global.malformed).toBe(true)
    expect(health.global.error).toBeTruthy()
  })

  it('reports a missing file as absent but not malformed', async () => {
    const health = await checkAgentSettings()
    expect(health.global).toMatchObject({ exists: false, malformed: false })
  })

  it('treats an empty file as writable, not malformed', async () => {
    await writeFile(settingsPath(), '   \n')
    const health = await checkAgentSettings()
    expect(health.global.malformed).toBe(false)
    await patchAgentSettings('global', undefined, { theme: 'dark' })
    expect(JSON.parse(await readFile(settingsPath(), 'utf8'))).toEqual({ theme: 'dark' })
  })

  it('still degrades to empty settings for display when malformed', async () => {
    await writeFile(settingsPath(), '{ broken')
    await expect(readAgentSettings()).resolves.toEqual({})
  })

  it('project scope writes <workspace>/.pi/settings.json', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'pidex-ws-'))
    try {
      await patchAgentSettings('project', workspace, { defaultModel: 'project-model' })
      const written = JSON.parse(await readFile(join(workspace, '.pi', 'settings.json'), 'utf8'))
      expect(written).toEqual({ defaultModel: 'project-model' })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
