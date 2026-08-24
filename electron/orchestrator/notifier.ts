import { app, BrowserWindow, Notification } from 'electron'
import type { OrchestratorDigest } from '@shared/models'
import { getPrefs } from '../store'
import type { FleetHub } from './fleet'
import {
  badgeCount,
  decideDigestNotification,
  decideNotification,
  questionKey,
} from './notifications'

/**
 * Desktop notifications for a fleet the user is not watching.
 *
 * The whole premise of orchestration is that agents work while you are
 * elsewhere, so "a session is blocked and nothing told you" is the failure
 * this exists to prevent. All the coalescing rules live in
 * `notifications.ts`, which is pure and tested; this file only does the
 * Electron parts.
 */
export function startNotifier(hub: FleetHub): void {
  /** Questions already announced, so a pending one is not re-announced. */
  const announced = new Set<string>()

  const focused = (): boolean =>
    BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isFocused())

  hub.onChange((snapshot) => {
    const decision = decideNotification({
      sessions: snapshot.sessions,
      announced,
      windowFocused: focused(),
      muted: getPrefs().notificationsMuted,
    })

    if (decision && Notification.isSupported()) {
      new Notification({ title: decision.title, body: decision.body }).show()
    }
    // Remember even when muted or focused: the user has seen the state, so
    // announcing it later (once they tab away) would be noise about old news.
    for (const session of snapshot.sessions) {
      const key = questionKey(session)
      if (key) announced.add(key)
    }
    // Drop keys for questions that are no longer pending, so the same session
    // asking the same thing again is announced again.
    const live = new Set(
      snapshot.sessions
        .map((session) => questionKey(session))
        .filter((k): k is string => k !== null),
    )
    for (const key of announced) {
      if (!live.has(key)) announced.delete(key)
    }

    setBadge(badgeCount(snapshot.sessions))
  })
}

/** Called when a sweep publishes findings. */
export function notifyDigest(digest: OrchestratorDigest): void {
  const focused = BrowserWindow.getAllWindows().some(
    (window) => !window.isDestroyed() && window.isFocused(),
  )
  const decision = decideDigestNotification(digest, {
    windowFocused: focused,
    muted: getPrefs().notificationsMuted,
  })
  if (decision && Notification.isSupported()) {
    new Notification({ title: decision.title, body: decision.body }).show()
  }
}

/**
 * Badge on the dock/taskbar icon.
 *
 * `setBadgeCount` is macOS and Linux only; on Windows it is a no-op that
 * returns false, which is fine — there is no overlay icon worth inventing for
 * a count.
 */
function setBadge(count: number): void {
  try {
    app.setBadgeCount(count)
  } catch {
    // Unsupported platform or desktop environment.
  }
}
