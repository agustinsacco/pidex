import { describe, expect, it } from 'vitest'
import { classifyToolServer } from './context-breakdown'

/**
 * The adapter renames MCP tools four different ways depending on its
 * `toolPrefix` setting, and the default is not the one this code used to
 * assume. Every mode below was read out of `pi-mcp-adapter/types.ts`
 * (`getServerPrefix` / `formatToolName`) and `namespace-tools.ts`.
 */
describe('classifyToolServer', () => {
  const servers = ['linear', 'braintrust', 'search-mcp']

  it('attributes the default prefix mode ("server": <server>_<tool>)', () => {
    expect(classifyToolServer('linear_create_issue', servers)).toBe('linear')
    expect(classifyToolServer('braintrust_list_experiments', servers)).toBe('braintrust')
  })

  it('attributes the "mcp" prefix mode (mcp__<server>_<tool>)', () => {
    expect(classifyToolServer('mcp__linear_create_issue', servers)).toBe('linear')
  })

  it('attributes a namespace-proxy tool, which is the whole server', () => {
    expect(classifyToolServer('mcp__linear', servers)).toBe('linear')
    expect(classifyToolServer('mcp__search_mcp', servers)).toBe('search-mcp')
  })

  it('attributes the "short" mode, which strips a trailing -mcp', () => {
    expect(classifyToolServer('search_web_search', servers)).toBe('search-mcp')
  })

  it('leaves pi built-ins alone', () => {
    for (const name of ['read', 'write', 'edit', 'bash', 'mcp', 'web_search']) {
      expect(classifyToolServer(name, servers), name).toBeNull()
    }
  })

  it('does not let a shorter server name claim a longer one', () => {
    expect(classifyToolServer('linear-readonly_list', ['linear', 'linear-readonly'])).toBe(
      'linear-readonly',
    )
  })

  it('still recognises a namespaced tool from a server it has not been told about', () => {
    expect(classifyToolServer('mcp__fellow_get_action_items', [])).toBe('fellow')
    expect(classifyToolServer('mcp__fellow', [])).toBe('fellow')
  })

  it('reports an unattributable name as built-in rather than guessing', () => {
    // toolPrefix "none" does not rename at all; nothing in the name says MCP.
    expect(classifyToolServer('create_issue', servers)).toBeNull()
  })
})
