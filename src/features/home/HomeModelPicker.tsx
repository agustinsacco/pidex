import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { ThinkingLevel } from '@shared/rpc'
import { PopupMenu, MenuRow } from '@/components/PopupMenu'

const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']

interface CatalogueModel {
  id: string
  name: string
  provider: string
  reasoning: boolean
}

function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Model + thinking pickers for the home screen, where no session exists yet.
 *
 * The session composer's picker drives a live pi process over RPC. Here there
 * is nothing to talk to, so these read and write pi's own defaults
 * (`defaultProvider` / `defaultModel` / `defaultThinkingLevel` in
 * settings.json). That is the same surface pi itself uses to pick a model on
 * startup, so whatever is shown here is genuinely what the next session will
 * run with — not a pidex-local preference that silently disagrees.
 */
export function HomeModelPicker(): React.JSX.Element | null {
  const [models, setModels] = useState<CatalogueModel[]>([])
  const [provider, setProvider] = useState<string | null>(null)
  const [modelId, setModelId] = useState<string | null>(null)
  const [thinking, setThinking] = useState<ThinkingLevel>('off')
  const [open, setOpen] = useState<'model' | 'thinking' | null>(null)

  useEffect(() => {
    void window.pidex.invoke('pi:catalogueModels').then(setModels)
    void window.pidex.invoke('pi:agentSettings').then((settings) => {
      const defaultProvider = settings.defaultProvider
      const defaultModel = settings.defaultModel
      const defaultThinking = settings.defaultThinkingLevel
      if (typeof defaultProvider === 'string') setProvider(defaultProvider)
      if (typeof defaultModel === 'string') setModelId(defaultModel)
      if (
        typeof defaultThinking === 'string' &&
        THINKING_LEVELS.includes(defaultThinking as ThinkingLevel)
      ) {
        setThinking(defaultThinking as ThinkingLevel)
      }
    })
  }, [])

  const grouped = useMemo(() => {
    const byProvider = new Map<string, CatalogueModel[]>()
    for (const model of models) {
      const list = byProvider.get(model.provider) ?? []
      list.push(model)
      byProvider.set(model.provider, list)
    }
    return [...byProvider.entries()]
  }, [models])

  const current = models.find((m) => m.id === modelId && m.provider === provider)

  // No configured models means nothing meaningful to pick between; the chat
  // composer's picker still covers the live case.
  if (models.length === 0) return null

  const chooseModel = (model: CatalogueModel): void => {
    setOpen(null)
    setProvider(model.provider)
    setModelId(model.id)
    void window.pidex.invoke('pi:patchAgentSettings', 'global', undefined, {
      defaultProvider: model.provider,
      defaultModel: model.id,
    })
  }

  const chooseThinking = (level: ThinkingLevel): void => {
    setOpen(null)
    setThinking(level)
    void window.pidex.invoke('pi:patchAgentSettings', 'global', undefined, {
      defaultThinkingLevel: level,
    })
  }

  return (
    <div className="relative flex items-center gap-0.5">
      <button
        onClick={() => setOpen(open === 'model' ? null : 'model')}
        data-testid="home-model-picker"
        className={clsx(
          'cursor-pointer rounded-md px-2 py-1 text-[12px] font-medium transition-colors',
          open === 'model'
            ? 'bg-bg-secondary text-text'
            : 'text-text-secondary hover:bg-bg-secondary hover:text-text',
        )}
      >
        {current?.name ?? modelId ?? 'Select model'}
      </button>

      {current?.reasoning && (
        <button
          onClick={() => setOpen(open === 'thinking' ? null : 'thinking')}
          data-testid="home-thinking-picker"
          className={clsx(
            'cursor-pointer rounded-md px-2 py-1 text-[12px] transition-colors',
            open === 'thinking'
              ? 'bg-bg-secondary text-text'
              : 'text-text-secondary hover:bg-bg-secondary hover:text-text',
          )}
        >
          {thinking === 'off' ? 'No thinking' : titleCase(thinking)}
        </button>
      )}

      {open === 'model' && (
        <PopupMenu
          onClose={() => setOpen(null)}
          className="absolute bottom-full right-0 mb-2 max-h-80 w-72 overflow-y-auto py-1.5"
        >
          <div className="text-text-tertiary px-3 pb-1 pt-1.5 text-[11px] font-medium">Models</div>
          {grouped.map(([providerName, providerModels]) => (
            <div key={providerName}>
              {grouped.length > 1 && (
                <div className="text-text-tertiary px-3 pb-0.5 pt-2 text-[10.5px] uppercase tracking-wide">
                  {providerName}
                </div>
              )}
              {providerModels.map((model) => (
                <MenuRow
                  key={`${model.provider}/${model.id}`}
                  active={false}
                  onClick={() => chooseModel(model)}
                >
                  <span className="flex-1 truncate">{model.name}</span>
                  {model.id === modelId && model.provider === provider && <Check />}
                </MenuRow>
              ))}
            </div>
          ))}
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
            <MenuRow key={level} active={false} onClick={() => chooseThinking(level)}>
              <span className="flex-1">{titleCase(level)}</span>
              {thinking === level && <Check />}
            </MenuRow>
          ))}
        </PopupMenu>
      )}
    </div>
  )
}

function Check(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      className="text-text shrink-0"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
