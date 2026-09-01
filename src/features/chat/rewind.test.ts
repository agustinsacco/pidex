import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcCommand, RpcSessionState } from '@shared/rpc'
import { useChatStore } from '@/stores/chat'
import { useSessionsStore } from '@/stores/sessions'
import { useChatUiStore } from './uiState'
import { rewindToEntry } from './rewind'

const invoke = vi.fn()
const piCommand = vi.fn()

function sessionState(sessionFile: string): RpcSessionState {
  return {
    thinkingLevel: 'medium',
    isStreaming: false,
    isCompacting: false,
    steeringMode: 'all',
    followUpMode: 'all',
    sessionFile,
    sessionId: 'pi-session',
    autoCompactionEnabled: true,
    messageCount: 2,
    pendingMessageCount: 0,
  }
}

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined)
  piCommand.mockReset()
  vi.stubGlobal('window', { pidex: { invoke, piCommand } })
  useChatStore.setState({ sessions: {} }, false)
  useChatUiStore.setState({ prefill: {}, forkPickerFor: null, verbose: {} }, false)
  useSessionsStore.setState({
    live: {
      s1: { pidexId: 's1', workspacePath: '/repo', diskPath: '/repo/.pi/sessions/old.jsonl' },
    },
    activeSessionId: 's1',
  })
})

/**
 * `fork` always branches pi's live session onto a brand-new file — verified
 * against the installed pi core (`SessionManager.createBranchedSession`),
 * which never truncates the current file in place. So a successful rewind
 * must relearn `sessionFile` via `get_state`, or `live.diskPath` keeps
 * pointing at the file pi just abandoned and the sidebar shows the stale
 * pre-fork session as if it were still the live one.
 */
describe('rewindToEntry', () => {
  it('relearns the new session file so the sidebar stops tracking the abandoned one', async () => {
    piCommand.mockImplementation((_sessionId: string, command: RpcCommand) => {
      switch (command.type) {
        case 'fork':
          expect(command.entryId).toBe('entry-2')
          return Promise.resolve({
            success: true,
            data: { text: 'edited message', cancelled: false },
          })
        case 'get_messages':
          return Promise.resolve({ success: true, data: { messages: [] } })
        case 'get_state':
          return Promise.resolve({
            success: true,
            data: sessionState('/repo/.pi/sessions/new-branch.jsonl'),
          })
        default:
          return Promise.resolve({ success: false })
      }
    })

    await rewindToEntry('s1', 'entry-2')

    expect(useSessionsStore.getState().live.s1?.diskPath).toBe(
      '/repo/.pi/sessions/new-branch.jsonl',
    )
    expect(useChatUiStore.getState().prefill.s1).toBe('edited message')
  })

  it('does not touch diskPath or the transcript when an extension cancels the fork', async () => {
    piCommand.mockImplementation((_sessionId: string, command: RpcCommand) => {
      if (command.type === 'fork') {
        return Promise.resolve({ success: true, data: { text: '', cancelled: true } })
      }
      return Promise.resolve({ success: false })
    })

    await rewindToEntry('s1', 'entry-2')

    expect(useSessionsStore.getState().live.s1?.diskPath).toBe('/repo/.pi/sessions/old.jsonl')
    expect(useChatStore.getState().sessions.s1?.error).toBe('Rewind was cancelled by an extension.')
    expect(piCommand).toHaveBeenCalledTimes(1)
  })

  it('does nothing further when the fork RPC call itself fails', async () => {
    piCommand.mockResolvedValue({ success: false, error: 'session gone' })

    await rewindToEntry('s1', 'entry-2')

    expect(useSessionsStore.getState().live.s1?.diskPath).toBe('/repo/.pi/sessions/old.jsonl')
    expect(piCommand).toHaveBeenCalledTimes(1)
  })
})
