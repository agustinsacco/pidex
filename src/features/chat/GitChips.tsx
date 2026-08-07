import { useEffect, useState } from 'react'
import type { GitInfo } from '@shared/models'
import { BranchIcon } from '@/components/icons'

/** Branch and dirty-count chips in the chat header, refreshed on fs changes. */

export function GitChips({ workspacePath }: { workspacePath: string }): React.JSX.Element | null {
  const [info, setInfo] = useState<GitInfo | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = (): void => {
      void window.pidex.invoke('git:info', workspacePath).then(setInfo)
    }
    refresh()
    void window.pidex.invoke('fs:watchWorkspace', workspacePath)
    const unsubscribe = window.pidex.onFsChanged((payload) => {
      if (payload.workspacePath !== workspacePath) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(refresh, 500)
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [workspacePath])

  if (!info?.isRepo || !info.branch) return null
  return (
    <span className="bg-bg-secondary text-text-secondary flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px]">
      <BranchIcon size={10} />
      <span className="max-w-36 truncate">{info.branch}</span>
      {(info.ahead ?? 0) > 0 && <span className="text-success">↑{info.ahead}</span>}
      {(info.behind ?? 0) > 0 && <span className="text-info">↓{info.behind}</span>}
      {(info.dirtyCount ?? 0) > 0 && <span className="text-warning">·{info.dirtyCount}</span>}
    </span>
  )
}

/** pi crashed: inline banner with one-click resume (session file survives). */
