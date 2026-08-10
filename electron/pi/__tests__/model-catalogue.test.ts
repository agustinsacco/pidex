import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PiRpcClient } from '../rpc-client'
import {
  requestAvailableModels,
  resolveCatalogueModels,
  toCatalogueModels,
  type CatalogueModel,
} from '../model-catalogue'
import type { Model } from '@shared/rpc'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fakePi = join(fixtureDir, 'fake-pi.cjs')

const clients: PiRpcClient[] = []
function makeFakeClient(env?: Record<string, string>): PiRpcClient {
  const client = new PiRpcClient({
    cwd: fixtureDir,
    binaryPath: process.execPath,
    prefixArgs: [fakePi],
    env,
  })
  clients.push(client)
  return client
}

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((c) => c.dispose()))
})

describe('toCatalogueModels', () => {
  it('narrows the full RPC Model to what pickers need, keeping the level map', () => {
    const model: Model = {
      id: 'us.anthropic.claude-opus-5',
      name: 'Claude Opus 5 (US)',
      api: 'bedrock-converse-stream',
      provider: 'amazon-bedrock',
      reasoning: true,
      thinkingLevelMap: { xhigh: 'xhigh', max: 'max' },
      input: ['text', 'image'],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      cost: { input: 5, output: 25, cacheRead: 0, cacheWrite: 0 },
    }
    expect(toCatalogueModels([model])).toEqual([
      {
        id: 'us.anthropic.claude-opus-5',
        name: 'Claude Opus 5 (US)',
        provider: 'amazon-bedrock',
        reasoning: true,
        thinkingLevelMap: { xhigh: 'xhigh', max: 'max' },
      },
    ])
  })
})

describe('requestAvailableModels', () => {
  it('returns the fixture catalogue with real display names, not ids', async () => {
    const client = makeFakeClient()
    client.spawn()
    const models = await requestAvailableModels(client)
    expect(models.map((m) => ({ id: m.id, name: m.name }))).toEqual([
      { id: 'us.anthropic.claude-opus-5', name: 'Claude Opus 5 (US)' },
      { id: 'Qwen 3.5 122b', name: 'Qwen 3.5 122b' },
    ])
    // The regression this design fixes: `pi --list-models` only ever prints
    // ids, so the home picker showed `us.anthropic.claude-opus-5` where a
    // live session showed "Claude Opus 5 (US)". The RPC carries the name.
    expect(models[0]?.name).not.toBe(models[0]?.id)
  })

  it('carries thinkingLevelMap so the home picker derives real levels', async () => {
    const client = makeFakeClient()
    client.spawn()
    const models = await requestAvailableModels(client)
    expect(models[0]?.thinkingLevelMap).toEqual({ xhigh: 'xhigh', max: 'max' })
    expect(models[1]?.thinkingLevelMap).toBeUndefined()
  })

  it('rejects when pi accepts the request but never answers', async () => {
    // FAKE_PI_HANG_MODELS simulates a genuine hang — the case the timeout
    // exists for, since a fast error already rejects on its own.
    const client = makeFakeClient({ FAKE_PI_HANG_MODELS: '1' })
    client.spawn()
    await expect(requestAvailableModels(client, 50)).rejects.toThrow(/timed out/)
  })
})

describe('resolveCatalogueModels', () => {
  const configModels: CatalogueModel[] = [
    { id: 'Qwen 3.5 122b', name: 'Qwen 3.5 122b', provider: 'local-stark', reasoning: false },
  ]

  it('uses the injected listModels function when a binary resolves', async () => {
    const rpcModels: CatalogueModel[] = [
      {
        id: 'us.anthropic.claude-opus-5',
        name: 'Claude Opus 5 (US)',
        provider: 'amazon-bedrock',
        reasoning: true,
      },
    ]
    const models = await resolveCatalogueModels(
      async () => '/fake/pi',
      async () => configModels,
      async (binaryPath) => {
        expect(binaryPath).toBe('/fake/pi')
        return rpcModels
      },
    )
    expect(models).toEqual(rpcModels)
  })

  it('falls back to config when listModels returns nothing', async () => {
    const models = await resolveCatalogueModels(
      async () => '/fake/pi',
      async () => configModels,
      async () => [],
    )
    expect(models).toEqual(configModels)
  })

  it('falls back to config when no pi binary is found', async () => {
    const models = await resolveCatalogueModels(
      async () => null,
      async () => configModels,
      async () => {
        throw new Error('should not be called without a binary')
      },
    )
    expect(models).toEqual(configModels)
  })

  it('falls back to config when listModels throws', async () => {
    const models = await resolveCatalogueModels(
      async () => '/fake/pi',
      async () => configModels,
      async () => {
        throw new Error('RPC exploded')
      },
    )
    expect(models).toEqual(configModels)
  })

  it('falls back to config when resolving the binary throws', async () => {
    const models = await resolveCatalogueModels(
      async () => {
        throw new Error('health check exploded')
      },
      async () => configModels,
    )
    expect(models).toEqual(configModels)
  })
})
