import { useState } from 'react'
import clsx from 'clsx'
import { ModalOverlay } from '@/components/Modal'
import { prChip } from './prChip'
import { describeWarnings, type PreflightSummary } from './deletePreflight'

/**
 * Confirm for deleting several lanes at once.
 *
 * The single-lane equivalent is `RemoveWorktreeModal`, and the two must agree
 * about what "dirty" blocks — two confirms with different refusal rules is the
 * likely bug in this feature. Both refuse a dirty worktree unless the user
 * opts into discarding, and both offer only `git branch -d`.
 *
 * "Delete a lane" is three resources, and only the first two default on:
 * the session transcript (to the OS Trash, recoverable), the worktree
 * directory (gone), and the branch (safe-delete only). Remote branches are
 * deliberately not offered — pidex has no channel for it, and a bulk flow is
 * the worst place to introduce the least reversible operation.
 */
export function BulkDeleteModal({
  summary,
  onCancel,
  onConfirm,
}: {
  summary: PreflightSummary
  onCancel: () => void
  onConfirm: (options: {
    removeWorktree: boolean
    deleteBranch: boolean
    discardChanges: boolean
  }) => void
}): React.JSX.Element {
  const [removeWorktree, setRemoveWorktree] = useState(true)
  const [deleteBranch, setDeleteBranch] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  const count = summary.deletable.length
  const hasDirty = summary.deletable.some((lane) => lane.dirtyCount > 0)
  const blocked = summary.needsAcknowledgement && !acknowledged
  const canDelete = count > 0 && !blocked

  return (
    <ModalOverlay onClose={onCancel}>
      <div className="bg-surface-raised border-border w-[min(38rem,94vw)] rounded-lg border shadow-2xl">
        <div className="border-border border-b px-5 py-4">
          <h2 className="text-base font-semibold">
            Delete {count} lane{count === 1 ? '' : 's'}
            {summary.blocked.length > 0 && (
              <span className="text-danger font-normal"> · {summary.blocked.length} refused</span>
            )}
          </h2>
          <p className="text-text-secondary mt-1 text-sm">
            Removing a lane can touch three things. Only the first two are on by default.
          </p>
        </div>

        <div className="max-h-64 overflow-y-auto px-5 py-3">
          <div className="border-border divide-border divide-y overflow-hidden rounded-md border">
            {summary.lanes.map((lane) => (
              <div
                key={lane.path}
                className={clsx(
                  'flex items-center gap-2 px-3 py-2 text-sm',
                  lane.blocker && 'bg-danger-soft',
                )}
              >
                <span className="w-[18px] shrink-0 text-center">{lane.marker || '•'}</span>
                <span
                  className={clsx(
                    'min-w-0 flex-1 truncate',
                    lane.blocker && 'line-through opacity-75',
                  )}
                >
                  {lane.title}
                </span>
                {lane.blocker && <Badge tone="bad">turn in progress</Badge>}
                {lane.dirtyCount > 0 && <Badge tone="warn">±{lane.dirtyCount}</Badge>}
                {lane.warnings.includes('unpushed') && <Badge tone="warn">unpushed</Badge>}
                {lane.pr ? (
                  <Badge tone={prBadgeTone(lane)}>
                    {prChip(lane.pr).label} {lane.pr.state.toLowerCase()}
                  </Badge>
                ) : (
                  <Badge tone="info">no PR</Badge>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1 px-5 pb-2">
          <Option checked disabled label="Move the session to Trash">
            The pi transcript and its paired Claude Code transcript. Recoverable from the OS Trash.
          </Option>
          <Option
            checked={removeWorktree}
            onChange={setRemoveWorktree}
            label={`Remove the git worktree${
              summary.worktreeCount ? ` (${summary.worktreeCount})` : ''
            }`}
            disabled={summary.worktreeCount === 0}
          >
            {summary.worktreeCount === 0
              ? 'No selected lane runs in its own worktree.'
              : 'Deletes the working directory on disk. Not undoable.'}
          </Option>
          <Option
            checked={deleteBranch}
            onChange={setDeleteBranch}
            label="Also delete the branch"
            disabled={!removeWorktree || summary.worktreeCount === 0}
          >
            <code>git branch -d</code> — safe delete. An unmerged branch is kept and reported, never
            forced.
          </Option>
        </div>

        {summary.needsAcknowledgement && (
          <div className="px-5 pb-3">
            <label className="border-danger bg-danger-soft flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="accent-accent mt-0.5"
              />
              <span>
                {summary.deletable.length === 1 ? 'This lane' : 'Some of these lanes'} would lose
                work ({describeWarnings(summary.warnings)}). I understand.
              </span>
            </label>
          </div>
        )}

        <div className="border-border bg-bg-secondary flex items-center gap-2 rounded-b-lg border-t px-5 py-3">
          <span className="text-text-tertiary text-xs">
            {removeWorktree && summary.worktreeCount > 0
              ? 'Worktree removal cannot be undone.'
              : 'Transcripts go to the Trash.'}
          </span>
          <span className="flex-1" />
          <button
            onClick={onCancel}
            className="border-border text-text-secondary hover:text-text rounded-md border px-3 py-1 text-sm"
          >
            Cancel
          </button>
          <button
            disabled={!canDelete}
            onClick={() =>
              onConfirm({ removeWorktree, deleteBranch, discardChanges: hasDirty && acknowledged })
            }
            className="bg-danger rounded-md px-3 py-1 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Delete {count} lane{count === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function prBadgeTone(lane: PreflightSummary['lanes'][number]): 'ok' | 'info' | 'warn' {
  if (lane.pr?.state === 'MERGED') return 'ok'
  if (lane.pr?.state === 'CLOSED') return 'info'
  return 'warn'
}

const TONES = {
  ok: 'bg-success/12 text-success',
  warn: 'bg-warning/12 text-warning',
  bad: 'bg-danger-soft text-danger',
  info: 'bg-info/12 text-info',
} as const

function Badge({
  tone,
  children,
}: {
  tone: keyof typeof TONES
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span className={clsx('shrink-0 rounded-full px-2 text-2xs font-semibold', TONES[tone])}>
      {children}
    </span>
  )
}

function Option({
  checked,
  onChange,
  disabled,
  label,
  children,
}: {
  checked: boolean
  onChange?: (next: boolean) => void
  disabled?: boolean
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label
      className={clsx(
        'flex items-start gap-2 py-1.5 text-sm',
        disabled ? 'cursor-default opacity-55' : 'cursor-pointer',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="accent-accent mt-0.5"
      />
      <span>
        {label}
        <span className="text-text-tertiary mt-0.5 block text-xs">{children}</span>
      </span>
    </label>
  )
}
