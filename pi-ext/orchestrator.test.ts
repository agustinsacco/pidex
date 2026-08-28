import { describe, it, expect, vi } from 'vitest'

/**
 * `typebox` resolves against pi's runtime, not this repo, so the test supplies
 * the three constructors the extension uses. They return plain JSON-Schema
 * shapes, which is all this file asserts about.
 */
vi.mock('typebox', () => {
  const Type = {
    Object: (properties: Record<string, unknown>) => ({
      type: 'object',
      properties,
      required: Object.entries(properties)
        .filter(([, value]) => !(value as { optional?: boolean }).optional)
        .map(([key]) => key),
    }),
    String: (options: Record<string, unknown> = {}) => ({ type: 'string', ...options }),
    Number: (options: Record<string, unknown> = {}) => ({ type: 'number', ...options }),
    Array: (items: unknown) => ({ type: 'array', items }),
    Union: (anyOf: unknown[]) => ({ anyOf }),
    Optional: (schema: object) => ({ ...schema, optional: true }),
  }
  return { Type }
})

const orchestratorExtension = (await import('./orchestrator')).default

interface Registered {
  name: string
  parameters: { required?: string[] }
}

function registeredTools(): Registered[] {
  const tools: Registered[] = []
  orchestratorExtension({ registerTool: (t) => tools.push(t as unknown as Registered) })
  return tools
}

describe('tool schemas', () => {
  it('registers the fleet toolkit', () => {
    expect(registeredTools().map((t) => t.name)).toEqual([
      'fleet_status',
      'session_read',
      'session_send',
      'session_stop',
      'session_answer',
      'git_status',
      'memory_read',
      'memory_write',
      'propose_work',
      'publish_digest',
    ])
  })

  /**
   * The regression this file exists for. On the Claude Code provider a tool
   * call with no arguments arrives as `arguments: ""`, and pi validates before
   * `execute` runs — so a tool whose fields are all optional fails every call
   * with `root: must be object` and never reaches the extension. `fleet_status`
   * and `memory_read` both shipped that way and both were dead on that
   * provider. One required field forces the model to emit an object.
   */
  it('gives every tool at least one required parameter', () => {
    for (const tool of registeredTools()) {
      expect(tool.parameters.required, `${tool.name} takes no required argument`).not.toHaveLength(
        0,
      )
    }
  })
})
