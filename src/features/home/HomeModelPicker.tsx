import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { ModelCost, ThinkingLevel, ThinkingLevelMap } from '@shared/rpc'
import { ALL_THINKING_LEVELS, clampThinkingLevel, supportedThinkingLevels } from '@shared/thinking'
import { ModelMenu } from '@/features/chat/composer/ModelMenu'
import { ThinkingMenu, thinkingLabel } from '@/features/chat/composer/ThinkingMenu'

/**
 * One selectable model as returned by `pi:catalogueModels` (home screen only).
 * Same source as the session composer in substance: main asks a throwaway pi
 * RPC process `get_available_models`, so this carries the real display name
 * and `thinkingLevelMap` — home derives levels with the same rules as a live
 * session instead of guessing.
 */
interface CatalogueModel {
  id: string
  name: string
  provider: string
  reasoning: boolean
  thinkingLevelMap?: ThinkingLevelMap | null
  /** Comparison metadata for the menu rows; absent when pi could not be run. */
  contextWindow?: number
  cost?: ModelCost
  input?: string[]
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
 * Supported thinking levels are derived locally via `supportedThinkingLevels`
 * (shared/thinking.ts), which implements pi's per-model rules over the
 * `thinkingLevelMap` the catalogue now carries. A live session still prefers
 * pi's own `get_available_thinking_levels` answer; this derivation is what a
 * new session will get, computed from the same data pi computes it from.
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

  /** Levels to render, derived per-model — including xhigh/max when mapped. */
  const levelsToRender: ThinkingLevel[] = useMemo(
    () => (current ? supportedThinkingLevels(current) : []),
    [current],
  )

  /**
   * The chip shows what the next session will RUN at, not the raw persisted
   * value: pi writes defaultThinkingLevel on every in-session change, so a
   * 'max' persisted from another model must display as this model's clamp
   * (pi applies the same clamp on startup).
   */
  const displayedThinking = current ? clampThinkingLevel(current, thinking) : thinking

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
          'cursor-pointer rounded-md px-2 py-1 text-base font-medium transition-colors',
          open === 'model'
            ? 'bg-bg-secondary text-text'
            : 'text-text-secondary hover:bg-bg-secondary hover:text-text',
        )}
      >
        {current?.name ?? modelId ?? 'Select model'}
      </button>

      {levelsToRender.length > 1 && (
        <button
          onClick={() => setOpen(open === 'thinking' ? null : 'thinking')}
          data-testid="home-thinking-picker"
          className={clsx(
            'cursor-pointer rounded-md px-2 py-1 text-base transition-colors',
            open === 'thinking'
              ? 'bg-bg-secondary text-text'
              : 'text-text-secondary hover:bg-bg-secondary hover:text-text',
          )}
        >
          {thinkingLabel(displayedThinking)}
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
          className="absolute bottom-full right-0 mb-2 w-[30rem] max-w-[90vw]"
        />
      )}

      {open === 'thinking' && (
        <ThinkingMenu
          levels={levelsToRender}
          current={displayedThinking}
          onPick={chooseThinking}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
