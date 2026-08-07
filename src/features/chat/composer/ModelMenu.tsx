import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyFilter } from '@/lib/fuzzy'
import { PopupMenu, MenuRow } from '@/components/PopupMenu'
import { CheckIcon } from '@/components/icons'

/** Minimal shape both pickers share (session RPC models / catalogue models). */
export interface ModelMenuEntry {
  id: string
  name: string
  provider: string
}

/**
 * Searchable model list shared by the session composer picker and the home
 * screen picker. A search field sits at the top (the catalogue easily runs to
 * dozens of models across providers); while the query is empty the list keeps
 * its provider grouping, and a non-empty query switches to one flat
 * relevance-ranked list. ↑/↓/Enter/Esc work from the search field.
 */
export function ModelMenu({
  models,
  isCurrent,
  onPick,
  onClose,
  emptyText,
  className,
}: {
  models: ModelMenuEntry[]
  isCurrent: (model: ModelMenuEntry) => boolean
  onPick: (model: ModelMenuEntry) => void
  onClose: () => void
  emptyText: string
  className?: string
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const matches = useMemo(
    () => (query ? fuzzyFilter(query, models, (m) => `${m.name} ${m.id} ${m.provider}`) : models),
    [query, models],
  )

  // Group only the unfiltered list; search results read best ranked flat.
  const grouped = useMemo(() => {
    if (query) return null
    const byProvider = new Map<string, ModelMenuEntry[]>()
    for (const model of matches) {
      const list = byProvider.get(model.provider) ?? []
      list.push(model)
      byProvider.set(model.provider, list)
    }
    return [...byProvider.entries()]
  }, [query, matches])

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => (matches.length ? (i + 1) % matches.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const model = matches[activeIndex]
      if (model) onPick(model)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  const row = (model: ModelMenuEntry): React.JSX.Element => {
    const index = matches.indexOf(model)
    return (
      <MenuRow
        key={`${model.provider}/${model.id}`}
        active={index === activeIndex}
        onHover={() => setActiveIndex(index)}
        onClick={() => onPick(model)}
      >
        <span className="flex-1 truncate">{model.name || model.id}</span>
        {isCurrent(model) && <CheckIcon className="text-text" />}
      </MenuRow>
    )
  }

  return (
    <PopupMenu onClose={onClose} className={className}>
      <div className="border-border border-b">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search models…"
          // composer-field: opt out of the global accent focus outline — the
          // popup frame already signals where focus lives.
          className="composer-field text-text placeholder:text-text-tertiary w-full bg-transparent px-3 py-2 text-[13px] outline-none"
        />
      </div>

      <div className="max-h-64 overflow-y-auto py-1.5">
        {grouped
          ? grouped.map(([provider, providerModels]) => (
              <div key={provider}>
                {grouped.length > 1 && (
                  <div className="text-text-tertiary px-3 pb-0.5 pt-2 text-[10.5px] font-mono uppercase tracking-wide">
                    {provider}
                  </div>
                )}
                {providerModels.map(row)}
              </div>
            ))
          : matches.map(row)}

        {models.length === 0 && (
          <div className="text-text-tertiary px-3 py-2 text-[12px]">{emptyText}</div>
        )}
        {models.length > 0 && matches.length === 0 && (
          <div className="text-text-tertiary px-3 py-2 text-[12px]">No models match “{query}”.</div>
        )}
      </div>
    </PopupMenu>
  )
}
