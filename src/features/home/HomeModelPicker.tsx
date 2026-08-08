import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { ThinkingLevel } from '@shared/rpc'
import { ALL_THINKING_LEVELS, hasThinkingChoice } from '@shared/thinking'
import { PopupMenu, MenuRow } from '@/components/PopupMenu'
import { ModelMenu } from '@/features/chat/composer/ModelMenu'

/**
 * One selectable model as returned by `pi:catalogueModels` (home screen only).
 * The session composer's live picker uses the full `Model` type from
 * `get_available_models`, which carries `thinkingLevelMap`.
 *
 * Home can only derive levels from this shape because `pi --list-models`
 * streams a table, not the richer RPC payload.
 */
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
 *
 * Supported thinking levels are derived locally because `pi:catalogueModels`
 * does not carry `thinkingLevelMap`. The derivation matches pi's rules:
 *   - `reasoning: false` → only `off`
 *   - `reasoning: true`  → `off…max`, filtered by the `thinkingLevelMap`
 *     (key absent vs. `null`), which is not on this type, so we assume the
 *     standard five-level set `off…high` for reasoning models without the map.
 *     Pi's `get_available_models` is the source of truth for the map.
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
        ALL_THINKING_LEVELS.includes(defaultThinking as ThinkingLevel)
      ) {
        setThinking(defaultThinking as ThinkingLevel)
      }
    })
  }, [])

  const current = models.find((m) => m.id === modelId && m.provider === provider)

  /**
   * Levels to render. Without `thinkingLevelMap`, assume the standard five.
   * Users who need `xhigh`/`max` should start a session and use the live
   * picker, which receives the real map from pi.
   */
  const levelsToRender: ThinkingLevel[] = useMemo(() => {
    if (!current) return []
    if (!current.reasoning) return ['off']
    // Catalogue doesn't carry the map; default to the standard set.
    return ['off', 'minimal', 'low', 'medium', 'high']
  }, [current])

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

      {current && hasThinkingChoice(current) && (
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
        <ModelMenu
          models={models}
          isCurrent={(m) => m.id === modelId && m.provider === provider}
          onPick={(m) => {
            const model = models.find((x) => x.id === m.id && x.provider === m.provider)
            if (model) chooseModel(model)
          }}
          onClose={() => setOpen(null)}
          emptyText="No models found in pi's models.json. The next session starts with pi's default model — you can switch in the session composer once it's running."
          className="absolute bottom-full right-0 mb-2 w-72"
        />
      )}

      {open === 'thinking' && (
        <PopupMenu
          onClose={() => setOpen(null)}
          className="absolute bottom-full right-0 mb-2 w-44 py-1.5"
        >
          <div className="text-text-tertiary px-3 pb-1 pt-1.5 text-[11px] font-medium">
            Thinking
          </div>
          {levelsToRender.map((level) => (
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
