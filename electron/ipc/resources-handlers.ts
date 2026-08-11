import { handle } from './handle'
import { lastSnapshot, subscribe, unsubscribe } from '../resources/monitor'
import { closeMonitorWindow, openMonitorWindow } from '../resources/monitor-window'

/**
 * Resource monitor lifecycle.
 *
 * Subscription is reference-counted in `monitor.ts`: the `ps` tick only runs
 * while a view is actually watching, so an unopened monitor costs nothing.
 */
export function registerResourceHandlers(isDev: boolean): void {
  handle('resources:subscribe', () => {
    subscribe()
    // Hand back the last sample so a newly opened view paints immediately
    // instead of sitting on a spinner until the next tick.
    return lastSnapshot()
  })

  handle('resources:unsubscribe', () => {
    unsubscribe()
  })

  handle('resources:openWindow', () => {
    openMonitorWindow(isDev)
  })

  handle('resources:closeWindow', () => {
    closeMonitorWindow()
  })
}
