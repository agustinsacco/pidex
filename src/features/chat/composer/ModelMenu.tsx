import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyFilter } from '@/lib/fuzzy'
import { PopupMenu, MenuRow } from '@/components/PopupMenu'
import { CheckIcon } from '@/components/icons'
import { availabilityKey, unavailableModels } from '@/lib/modelAvailability'

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
 *
 * Models the catalogue itself shows to be uninvocable (a bare Bedrock
 * foundation id that only exists as inference profiles — see
 * `lib/modelAvailability`) render dimmed and unselectable, with the working
 * variants named in the hint. They stay visible rather than hidden so that
 * searching "fable" still explains where Fable went, instead of silently
 * omitting the row the user typed.
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

  const unavailable = useMemo(() => unavailableModels(models), [models])

  /**
   * Indices into `matches` that Enter/↑/↓ may land on. Disabled rows are
   * skipped entirely, so arrowing never parks the highlight on a model that
   * cannot be picked.
   */
  const selectable = useMemo(
    () =>
      matches.map((m, i) => (unavailable.has(availabilityKey(m)) ? -1 : i)).filter((i) => i >= 0),
    [matches, unavailable],
  )

  // Keep the highlight on a selectable row as the query narrows the list.
  useEffect(() => {
    if (selectable.length === 0) return
    if (!selectable.includes(activeIndex)) setActiveIndex(selectable[0] as number)
  }, [selectable, activeIndex])

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

  /** Step through `selectable` only, wrapping at both ends. */
  const step = (delta: number): void => {
    if (selectable.length === 0) return
    setActiveIndex((current) => {
      const at = selectable.indexOf(current)
      // Highlight is on a disabled row (or nowhere): enter the ring at the end
      // that matches the direction of travel.
      if (at === -1) return selectable[delta > 0 ? 0 : selectable.length - 1] as number
      const next = (at + delta + selectable.length) % selectable.length
      return selectable[next] as number
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      step(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      step(-1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const model = matches[activeIndex]
      if (model && !unavailable.has(availabilityKey(model))) onPick(model)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  const row = (model: ModelMenuEntry): React.JSX.Element => {
    const index = matches.indexOf(model)
    const blocked = unavailable.get(availabilityKey(model))
    return (
      <MenuRow
        key={`${model.provider}/${model.id}`}
        active={index === activeIndex}
        disabled={blocked !== undefined}
        onHover={() => setActiveIndex(index)}
        onClick={() => onPick(model)}
        title={blocked ? `${model.id} — ${blocked.detail}` : model.id}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate">{model.name || model.id}</span>
          {/* Wraps rather than truncates: a clipped "pick a region-pr…" tells
              the user nothing, and this row is the only place the reason
              appears. */}
          {blocked && (
            <span className="text-text-tertiary block text-[11px] leading-snug">
              {blocked.detail}
            </span>
          )}
        </span>
        {isCurrent(model) && !blocked && <CheckIcon className="text-text" />}
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
