import { spawn, type IPty } from 'node-pty'
import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'

interface PtySession {
  ptyId: string
  pty: IPty
  workspacePath: string
}

/** Real PTYs (user shell), independent from the agent's bash tool. */
class PtyManager {
  private readonly sessions = new Map<string, PtySession>()

  create(workspacePath: string, cols: number, rows: number): { ptyId: string } {
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
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(`pty:data:${ptyId}`, data)
      }
    })

    pty.onExit(({ exitCode }) => {
      this.sessions.delete(ptyId)
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(`pty:exit:${ptyId}`, exitCode)
      }
    })

    this.sessions.set(ptyId, { ptyId, pty, workspacePath })
    return { ptyId }
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
    try {
      session.pty.kill()
    } catch {
      // already dead
    }
  }

  killAll(): void {
    for (const ptyId of [...this.sessions.keys()]) this.kill(ptyId)
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
