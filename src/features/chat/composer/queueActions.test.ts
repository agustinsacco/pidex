import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcCommand } from '@shared/rpc'
import { useChatStore } from '@/stores/chat'
import { dropQueuedEntry, unqueueMessage } from './queueActions'

const piCommand = vi.fn()

/** Queue state pi reports when `clear_queue` drains it. */
function drains(steering: string[], followUp: string[]): void {
  piCommand.mockImplementation((_id: string, command: RpcCommand) =>
    command.type === 'clear_queue'
      ? Promise.resolve({ success: true, data: { steering, followUp } })
      : Promise.resolve({ success: true }),
  )
}

function sentAfterDrain(): RpcCommand[] {
  return piCommand.mock.calls
    .map(([, command]) => command as RpcCommand)
    .filter((command) => command.type !== 'clear_queue')
}

beforeEach(() => {
  piCommand.mockReset()
  vi.stubGlobal('window', { pidex: { piCommand } })
  useChatStore.setState({ sessions: {} }, false)
})

describe('dropQueuedEntry', () => {
  it('drops the indexed entry when its text still matches', () => {
    expect(dropQueuedEntry(['a', 'b', 'c'], 1, 'b')).toEqual(['a', 'c'])
  })

  it('falls back to the first equal text when the index shifted', () => {
    expect(dropQueuedEntry(['b', 'c'], 2, 'b')).toEqual(['c'])
  })

  it('reports the entry as gone when it is no longer queued', () => {
    expect(dropQueuedEntry(['a'], 0, 'b')).toBeNull()
  })

  it('drops only one of two identical entries', () => {
    expect(dropQueuedEntry(['a', 'a'], 1, 'a')).toEqual(['a'])
  })
})

describe('unqueueMessage', () => {
  it('re-queues every survivor, in order, across both queues', async () => {
    drains(['keep me', 'drop me', 'me too'], ['later'])
    await unqueueMessage('s1', 'steer', 1, 'drop me')
    expect(sentAfterDrain()).toEqual([
      { type: 'steer', message: 'keep me' },
      { type: 'steer', message: 'me too' },
      { type: 'follow_up', message: 'later' },
    ])
    expect(useChatStore.getState().sessions.s1?.error).toBeUndefined()
  })

  it('removes a follow-up without touching the steering queue', async () => {
    drains(['steer'], ['a', 'b'])
    await unqueueMessage('s1', 'follow-up', 0, 'a')
    expect(sentAfterDrain()).toEqual([
      { type: 'steer', message: 'steer' },
      { type: 'follow_up', message: 'b' },
    ])
  })

  it('restores the whole queue and says so when pi already read the message', async () => {
    drains(['other'], [])
    await unqueueMessage('s1', 'steer', 0, 'already gone')
    expect(sentAfterDrain()).toEqual([{ type: 'steer', message: 'other' }])
    expect(useChatStore.getState().sessions.s1?.error).toMatch(/already delivered/)
  })

  it('leaves the queue alone and names the version when the drain is unsupported', async () => {
    piCommand.mockResolvedValue({ success: false, error: 'Unknown command: clear_queue' })
    await unqueueMessage('s1', 'steer', 0, 'drop me')
    expect(sentAfterDrain()).toEqual([])
    expect(useChatStore.getState().sessions.s1?.error).toMatch(/pi 0\.84\.4/)
  })

  it('names the messages it could not put back', async () => {
    piCommand.mockImplementation((_id: string, command: RpcCommand) =>
      command.type === 'clear_queue'
        ? Promise.resolve({
            success: true,
            data: { steering: ['keep me', 'drop me'], followUp: [] },
          })
        : Promise.resolve({ success: false, error: 'not streaming' }),
    )
    await unqueueMessage('s1', 'steer', 1, 'drop me')
    expect(useChatStore.getState().sessions.s1?.error).toMatch(/keep me/)
  })
})
