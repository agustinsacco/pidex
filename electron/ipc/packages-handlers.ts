import { handle } from './handle'
import { detectBinaries, listPackages, runPackageAction, runPiInstall } from '../pi/packages'

/** pi package listing + mutations via pi's own CLI (streamed jobs). */
export function registerPackagesHandlers(): void {
  handle('packages:list', (_event, workspacePath?: string) => listPackages(workspacePath))

  handle('packages:run', (event, action, spec, scope, workspacePath) =>
    runPackageAction(event.sender, action, spec, scope, workspacePath),
  )

  handle('packages:installPi', (event) => runPiInstall(event.sender))

  handle('packages:detect', () => detectBinaries())
}
