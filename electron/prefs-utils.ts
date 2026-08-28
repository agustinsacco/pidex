/** Pure pref helpers, separate from electron-store so tests can import them. */
import { MAX_DRAFTS, type ComposerDraftRecord } from '@shared/models'

/**
 * Drop the oldest seen-markers once the map outgrows `max`, keeping the
 * `keep` newest. Hysteresis (500 → 400 by default) so the prune doesn't
 * rewrite the map on every mark.
 */
export function pruneSeenSessions(
  seen: Record<string, number>,
  max = 500,
  keep = 400,
): Record<string, number> {
  const entries = Object.entries(seen)
  if (entries.length <= max) return seen
  entries.sort((a, b) => b[1] - a[1])
  return Object.fromEntries(entries.slice(0, keep))
}

/**
 * Keep the newest `max` drafts and report which blob ids the prune dropped.
 *
 * Same shape as `pruneSeenSessions`, but the return has to carry the dropped
 * ids: a draft's images live as files under `userData/drafts/`, so forgetting
 * the record without unlinking them leaks the bytes permanently.
 */
export function pruneDrafts(
  drafts: Record<string, ComposerDraftRecord>,
  max = MAX_DRAFTS,
): { drafts: Record<string, ComposerDraftRecord>; dropped: string[] } {
  const entries = Object.entries(drafts)
  if (entries.length <= max) return { drafts, dropped: [] }
  entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  const kept = entries.slice(0, max)
  const dropped = blobIdsOf(entries.slice(max).map(([, draft]) => draft))
  return { drafts: Object.fromEntries(kept), dropped }
}

/** Every blob id referenced by these drafts. */
export function blobIdsOf(drafts: ComposerDraftRecord[]): string[] {
  const ids: string[] = []
  for (const draft of drafts) {
    for (const attachment of draft.attachments ?? []) {
      if (attachment.kind === 'image' && attachment.blobId) ids.push(attachment.blobId)
    }
  }
  return ids
}

/**
 * Drop drafts whose target no longer exists.
 *
 * `sessions:delete` clears its own draft, but a session file removed outside
 * pidex (or a workspace that has gone away) leaves one behind. Same
 * validate-then-drop shape the launch-time resume target uses.
 */
export function sweepDrafts(
  drafts: Record<string, ComposerDraftRecord>,
  exists: (path: string) => boolean,
): { drafts: Record<string, ComposerDraftRecord>; dropped: string[] } {
  const kept: Record<string, ComposerDraftRecord> = {}
  const gone: ComposerDraftRecord[] = []
  for (const [key, draft] of Object.entries(drafts)) {
    // A live session's key is its pidexId, which says nothing about disk; only
    // the home drafts name a folder we can check.
    const folder = key.startsWith('home:') ? key.slice('home:'.length) : null
    if (folder && !exists(folder)) gone.push(draft)
    else kept[key] = draft
  }
  return { drafts: kept, dropped: blobIdsOf(gone) }
}

/** Blob files with no draft referring to them. */
export function orphanBlobIds(
  drafts: Record<string, ComposerDraftRecord>,
  onDisk: string[],
): string[] {
  const referenced = new Set(blobIdsOf(Object.values(drafts)))
  return onDisk.filter((id) => !referenced.has(id))
}
