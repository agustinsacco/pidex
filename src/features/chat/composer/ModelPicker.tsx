import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { Model, ThinkingLevel } from '@shared/rpc'
import { useChatStore } from '@/stores/chat'
import { PopupMenu, MenuRow } from '@/components/PopupMenu'
import { CheckIcon } from '@/components/icons'
import { piCallOk } from '@/lib/rpc'

const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']

/** Real title-case text (not a CSS transform) so labels are accessible. */
function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Model + thinking-level pickers, screenshot-style: chips in the composer footer. */
export function ModelPicker({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const meta = useChatStore((s) => s.sessions[sessionId]?.meta)
  const models = useChatStore((s) => s.sessions[sessionId]?.models) ?? []
  const [open, setOpen] = useState<'model' | 'thinking' | null>(null)

  const grouped = useMemo(() => {
    const byProvider = new Map<string, Model[]>()
    for (const model of models) {
      const list = byProvider.get(model.provider) ?? []
      list.push(model)
      byProvider.set(model.provider, list)
    }
    return [...byProvider.entries()]
  }, [models])

  if (!meta) return null
  const currentModel = meta.model

  const setModel = async (model: Model): Promise<void> => {
    setOpen(null)
    const ok = await piCallOk(sessionId, {
      type: 'set_model',
      provider: model.provider,
      modelId: model.id,
    })
    if (ok) useChatStore.getState().patchMeta(sessionId, { model })
  }

  const setThinking = async (level: ThinkingLevel): Promise<void> => {
    setOpen(null)
    const ok = await piCallOk(sessionId, { type: 'set_thinking_level', level })
    if (ok) useChatStore.getState().patchMeta(sessionId, { thinkingLevel: level })
  }

  return (
    <div className="relative flex items-center gap-1">
      <button
        onClick={() => setOpen(open === 'model' ? null : 'model')}
        className={clsx(
          'rounded-md px-2 py-1 text-[12px] font-medium transition-colors',
          open === 'model'
            ? 'bg-bg-secondary text-text'
            : 'text-text-secondary hover:bg-bg-secondary hover:text-text',
        )}
      >
        {currentModel?.name ?? 'No model'}
      </button>

      {currentModel?.reasoning && (
        <button
          onClick={() => setOpen(open === 'thinking' ? null : 'thinking')}
          className={clsx(
            'rounded-md px-2 py-1 text-[12px] transition-colors',
            open === 'thinking'
              ? 'bg-bg-secondary text-text'
              : 'text-text-secondary hover:bg-bg-secondary hover:text-text',
          )}
        >
          {meta.thinkingLevel === 'off' ? 'No thinking' : titleCase(meta.thinkingLevel)}
        </button>
      )}

      {open === 'model' && (
        <PopupMenu
          onClose={() => setOpen(null)}
          className="absolute bottom-full right-0 mb-2 max-h-80 w-72 overflow-y-auto py-1.5"
        >
          <div className="text-text-tertiary px-3 pb-1 pt-1.5 text-[11px] font-medium">Models</div>
          {grouped.map(([provider, providerModels]) => (
            <div key={provider}>
              {grouped.length > 1 && (
                <div className="text-text-tertiary px-3 pt-2 pb-0.5 text-[10.5px] uppercase tracking-wide">
                  {provider}
                </div>
              )}
              {providerModels.map((model) => {
                const active =
                  currentModel?.id === model.id && currentModel.provider === model.provider
                return (
                  <MenuRow
                    key={`${model.provider}/${model.id}`}
                    active={false}
                    onClick={() => void setModel(model)}
                  >
                    <span className="flex-1 truncate">{model.name || model.id}</span>
                    {active && <CheckIcon className="text-text" />}
                  </MenuRow>
                )
              })}
            </div>
          ))}
          {models.length === 0 && (
            <div className="text-text-tertiary px-3 py-2 text-[12px]">
              No models configured — sign in via the terminal (`pi /login`) or add API keys.
            </div>
          )}
        </PopupMenu>
      )}

      {open === 'thinking' && (
        <PopupMenu
          onClose={() => setOpen(null)}
          className="absolute bottom-full right-0 mb-2 w-44 py-1.5"
        >
          <div className="text-text-tertiary px-3 pb-1 pt-1.5 text-[11px] font-medium">
            Thinking
          </div>
          {THINKING_LEVELS.map((level) => (
            <MenuRow key={level} active={false} onClick={() => void setThinking(level)}>
              <span className="flex-1">{titleCase(level)}</span>
              {meta.thinkingLevel === level && <CheckIcon className="text-text" />}
            </MenuRow>
          ))}
        </PopupMenu>
      )}
    </div>
  )
}
