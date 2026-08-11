import { BrowserWindow } from 'electron'
import type { ResourceSnapshot } from '@shared/models'
import { sampleSnapshot, type SessionProcessInput } from './sampler'

/**
 * The resource monitor's tick loop.
 *
 * Reference-counted and OFF by default: sampling costs a `ps` spawn per tick,
 * so it runs only while a subscriber (the monitor modal or the floating
 * window) is actually watching. A monitor that polls when nobody is looking
 * would be its own resource bug.
 */

const TICK_MS = 2_000

let timer: NodeJS.Timeout | null = null
let subscribers = 0
let inFlight = false
/** Supplied by the composition root so this module imports no registries. */
let collectInputs: () => SessionProcessInput[] = () => []
let latest: ResourceSnapshot | null = null

export function configureMonitor(collect: () => SessionProcessInput[]): void {
  collectInputs = collect
}

async function tick(): Promise<void> {
  // Skip rather than queue: a slow `ps` must not build a backlog of samples.
  if (inFlight) return
  inFlight = true
  try {
    const snapshot = await sampleSnapshot(collectInputs(), Date.now())
    latest = snapshot
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('resources:sample', snapshot)
    }
  } finally {
    inFlight = false
  }
}

/** Begin (or join) sampling. Returns the current subscriber count. */
export function subscribe(): number {
  subscribers += 1
  if (timer === null) {
    // Fire once immediately so the UI paints real data instead of waiting a
    // full tick behind a spinner.
    void tick()
    timer = setInterval(() => void tick(), TICK_MS)
    // Telemetry must never be the reason the process stays alive.
    timer.unref()
  }
  return subscribers
}

/** Drop one subscriber; stops sampling when the last one leaves. */
export function unsubscribe(): number {
  subscribers = Math.max(0, subscribers - 1)
  if (subscribers === 0) stopMonitor()
  return subscribers
}

/** Last snapshot, so a newly opened view can paint before the next tick. */
export function lastSnapshot(): ResourceSnapshot | null {
  return latest
}

/** Hard stop, for shutdown. */
export function stopMonitor(): void {
  if (timer) clearInterval(timer)
  timer = null
  subscribers = 0
  latest = null
}

/** Test seam: is the loop currently running? */
export function isSampling(): boolean {
  return timer !== null
}
