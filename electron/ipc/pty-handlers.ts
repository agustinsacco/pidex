import { handle } from './handle'
import { ptyManager } from '../pty/pty-manager'

/** Terminal PTY lifecycle. */
export function registerPtyHandlers(): void {
  handle('pty:create', (_event, workspacePath, cols, rows) =>
    ptyManager.create(workspacePath, cols, rows),
  )

  handle('pty:write', (_event, ptyId, data) => {
    ptyManager.write(ptyId, data)
  })

  handle('pty:resize', (_event, ptyId, cols, rows) => {
    ptyManager.resize(ptyId, cols, rows)
  })

  handle('pty:kill', (_event, ptyId) => {
    ptyManager.kill(ptyId)
  })
}
