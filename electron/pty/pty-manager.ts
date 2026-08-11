import { spawn, type IPty } from 'node-pty'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { BrowserWindow } from 'electron'
import { isBusy } from './busy'

interface PtySession {
  ptyId: string
  pty: IPty
  workspacePath: string
  shellName: string
  busy: boolean
  /**
   * Owning chat session, when the caller knows it. Lets the resource monitor
   * charge a terminal's process tree (builds, tests, dev servers) to the right
   * session — that mapping otherwise lives only in the renderer's store.
   */
  sessionId?: string
}

/** Real PTYs (user shell), independent from the agent's bash tool. */
class PtyManager {
  private readonly sessions = new Map<string, PtySession>()
  private pollTimer: NodeJS.Timeout | null = null

  create(workspacePath: string, cols: number, rows: number, sessionId?: string): { ptyId: string } {
    const ptyId = randomUUID()
    const shell = defaultShell()

    const pty = spawn(shell.command, shell.args, {
      name: 'xterm-256color',
      cwd: workspacePath,
      cols,
      rows,
      env: { ...process.env, TERM_PROGRAM: 'pidex' } as Record<string, string>,
    })

    pty.onData((data) => {
      broadcast(`pty:data:${ptyId}`, data)
    })

    pty.onExit(({ exitCode }) => {
      this.sessions.delete(ptyId)
      this.syncPolling()
      broadcast(`pty:exit:${ptyId}`, exitCode)
    })

    this.sessions.set(ptyId, {
      ptyId,
      pty,
      workspacePath,
      shellName: basename(shell.command),
      busy: false,
      sessionId,
    })
    this.syncPolling()
    return { ptyId }
  }

  /** Live shell pids grouped by owning session, for the resource monitor. */
  pidsBySession(): Map<string, number[]> {
    const map = new Map<string, number[]>()
    for (const session of this.sessions.values()) {
      if (!session.sessionId) continue
      const pid = session.pty.pid
      if (pid === undefined) continue
      const pids = map.get(session.sessionId)
      if (pids) pids.push(pid)
      else map.set(session.sessionId, [pid])
    }
    return map
  }

  write(ptyId: string, data: string): void {
    this.sessions.get(ptyId)?.pty.write(data)
  }

  resize(ptyId: string, cols: number, rows: number): void {
    try {
      this.sessions.get(ptyId)?.pty.resize(Math.max(2, cols), Math.max(1, rows))
    } catch {
      // resizing a dying pty throws; ignore
    }
  }

  kill(ptyId: string): void {
    const session = this.sessions.get(ptyId)
    if (!session) return
    this.sessions.delete(ptyId)
    this.syncPolling()
    try {
      session.pty.kill()
    } catch {
      // already dead
    }
  }

  killAll(): void {
    for (const ptyId of [...this.sessions.keys()]) this.kill(ptyId)
  }

  /**
   * Poll foreground-process titles once a second (only while PTYs exist) and
   * broadcast the busy map when anything changes. Windows' title reporting is
   * unreliable, so it degrades to "never busy" there — the badge just stays
   * a plain count.
   */
  private syncPolling(): void {
    if (this.sessions.size === 0) {
      if (this.pollTimer) clearInterval(this.pollTimer)
      this.pollTimer = null
      return
    }
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
      let changed = false
      for (const session of this.sessions.values()) {
        let busy = false
        try {
          busy = process.platform !== 'win32' && isBusy(session.pty.process, session.shellName)
        } catch {
          // pty is winding down
        }
        if (busy !== session.busy) {
          session.busy = busy
          changed = true
        }
      }
      if (changed) {
        broadcast(
          'pty:status',
          Object.fromEntries([...this.sessions.values()].map((s) => [s.ptyId, s.busy])),
        )
      }
    }, 1000)
    // A status poll must never be the reason the process stays alive.
    this.pollTimer.unref()
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function defaultShell(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: 'powershell.exe', args: [] }
  }
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  // Login shell so the user's PATH/rc files load (pi lives there).
  return { command: shell, args: ['-l'] }
}

export const ptyManager = new PtyManager()
