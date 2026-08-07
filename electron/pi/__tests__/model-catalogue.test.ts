import { describe, it, expect } from 'vitest'
import { parseModelTable, resolveCatalogueModels, type CatalogueModel } from '../model-catalogue'

/** Real `pi --list-models` output, trimmed to the interesting rows. */
const SAMPLE = [
  'provider        model                                       context  max-out  thinking  images',
  'amazon-bedrock  amazon.nova-2-lite-v1:0                     128K     4.1K     yes       yes   ',
  'amazon-bedrock  anthropic.claude-opus-4-8                   1M       128K     yes       yes   ',
  'amazon-bedrock  us.anthropic.claude-opus-5                  1M       128K     yes       yes   ',
  'amazon-bedrock  amazon.nova-micro-v1:0                      128K     8.2K     no        no    ',
  'local-stark     Qwen 3.5 122b                               128K     16.4K    no        no    ',
].join('\n')

describe('parseModelTable', () => {
  it('parses every data row, skipping the header', () => {
    const models = parseModelTable(SAMPLE)
    expect(models).toHaveLength(5)
    expect(models.map((m) => m.id)).not.toContain('model')
  })

  it('includes pi built-in providers, not just user config', () => {
    const providers = new Set(parseModelTable(SAMPLE).map((m) => m.provider))
    expect(providers).toEqual(new Set(['amazon-bedrock', 'local-stark']))
  })

  it('keeps single spaces inside a model id', () => {
    // The bug this guards: splitting on generic whitespace shears
    // "Qwen 3.5 122b" into three columns and loses the model.
    const qwen = parseModelTable(SAMPLE).find((m) => m.provider === 'local-stark')
    expect(qwen).toEqual({
      id: 'Qwen 3.5 122b',
      name: 'Qwen 3.5 122b',
      provider: 'local-stark',
      reasoning: false,
    })
  })

  it('maps the thinking column to reasoning', () => {
    const models = parseModelTable(SAMPLE)
    expect(models.find((m) => m.id === 'us.anthropic.claude-opus-5')?.reasoning).toBe(true)
    expect(models.find((m) => m.id === 'amazon.nova-micro-v1:0')?.reasoning).toBe(false)
  })

  it('exposes the model the home picker was previously missing', () => {
    const ids = parseModelTable(SAMPLE).map((m) => m.id)
    expect(ids).toContain('us.anthropic.claude-opus-5')
  })

  it('ignores blank lines and banner chatter above the table', () => {
    const noisy = 'Refreshing catalogues...\n\n' + SAMPLE + '\n\n'
    expect(parseModelTable(noisy)).toHaveLength(5)
  })

  it('drops rows with too few columns', () => {
    expect(parseModelTable('amazon-bedrock  only-two-columns')).toEqual([])
  })

  it('de-duplicates repeated provider+id rows', () => {
    const doubled = SAMPLE + '\n' + SAMPLE.split('\n')[5]
    expect(parseModelTable(doubled)).toHaveLength(5)
  })

  it('returns an empty list for empty output', () => {
    expect(parseModelTable('')).toEqual([])
    expect(parseModelTable('\n  \n')).toEqual([])
  })

  it('does not treat a single-space-separated line as columns', () => {
    expect(parseModelTable('this is a prose sentence about models')).toEqual([])
  })
})

describe('resolveCatalogueModels', () => {
  const configModels: CatalogueModel[] = [
    { id: 'Qwen 3.5 122b', name: 'Qwen 3.5 122b', provider: 'local-stark', reasoning: false },
  ]

  it('falls back to config when no pi binary is found', async () => {
    const models = await resolveCatalogueModels(
      async () => null,
      async () => configModels,
    )
    expect(models).toEqual(configModels)
  })

  it('falls back to config when the CLI throws', async () => {
    const models = await resolveCatalogueModels(
      async () => '/nonexistent/pi-binary-that-cannot-run',
      async () => configModels,
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
