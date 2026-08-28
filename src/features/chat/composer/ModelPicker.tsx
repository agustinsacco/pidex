import { useState } from 'react'
import clsx from 'clsx'
import type { Model, ThinkingLevel } from '@shared/rpc'
import { supportedThinkingLevels } from '@shared/thinking'
import { useChatStore } from '@/stores/chat'
import { piCall, piCallOk } from '@/lib/rpc'
import { refreshThinkingLevels } from '@/stores/sessions'
import { ModelMenu } from './ModelMenu'
import { ThinkingMenu, thinkingLabel } from './ThinkingMenu'

/**
 * Model + thinking-level pickers in the composer footer.
 *
 * The thinking chip only appears when the model has more than one level to
 * choose from. The levels rendered are:
 *   - pi's authoritative answer (`get_available_thinking_levels`) when available
 *   - local derivation (`supportedThinkingLevels`) otherwise — same algorithm,
 *     just computed client-side to match rather than a hardcoded list that was
 *     wrong for most models.
 */
/**
 * Providers shipped by pi itself. Anything else is a package the user
 * installed, and worth naming in the UI.
 */
const NATIVE_PROVIDERS = new Set([
  'anthropic',
  'openai',
  'google',
  'azure',
  'bedrock',
  'vertex',
  'groq',
  'mistral',
  'cerebras',
  'xai',
  'openrouter',
  'zai',
  'baseten',
  'fireworks',
  'together',
])

export function ModelPicker({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const meta = useChatStore((s) => s.sessions[sessionId]?.meta)
  const models = useChatStore((s) => s.sessions[sessionId]?.models) ?? []
  const thinkingLevels = useChatStore((s) => s.sessions[sessionId]?.thinkingLevels)
  const [open, setOpen] = useState<'model' | 'thinking' | null>(null)

  if (!meta) return null
  const currentModel = meta.model

  /**
   * Levels to render. Prefer pi's answer; derive locally when missing.
   */
  const levelsToRender: ThinkingLevel[] =
    thinkingLevels ?? (currentModel ? supportedThinkingLevels(currentModel) : [])

  const setModel = async (model: Model): Promise<void> => {
    setOpen(null)
    const selected = await piCall(sessionId, {
      type: 'set_model',
      provider: model.provider,
      modelId: model.id,
    })
    if (selected) {
      const chat = useChatStore.getState()
      // A provider quota failure is recorded on the session-wide error surface.
      // Once pi confirms a different model, that error is no longer actionable;
      // leaving it set makes a successful Claude → Bedrock recovery look broken.
      chat.setError(sessionId, null)
      // Use pi's response rather than the menu row: pi may normalize or enrich
      // the model record, and it is the authority for the live session.
      chat.patchMeta(sessionId, { model: selected })
      // Supported levels are per-model. Clear the previous model's list
      // synchronously so the ?? fallback derives from the NEW model during
      // the refresh gap (and permanently, if the refresh fails) — a stale
      // list offered levels the new model silently clamps away.
      chat.setThinkingLevels(sessionId, null)
      void refreshThinkingLevels(sessionId)
      // pi's set_model re-clamps the session's thinking level (e.g. max →
      // high on a 5-level model). Re-read state so the chip reports the
      // level the session actually runs at, not the pre-switch setting.
      void piCall(sessionId, { type: 'get_state' }).then((state) => {
        if (state?.thinkingLevel) {
          useChatStore.getState().patchMeta(sessionId, { thinkingLevel: state.thinkingLevel })
        }
      })
    }
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
          'rounded-md px-2 py-1 text-base font-medium transition-colors',
          open === 'model'
            ? 'bg-bg-secondary text-text'
            : 'text-text-secondary hover:bg-bg-secondary hover:text-text',
        )}
      >
        {currentModel?.name ?? 'No model'}
        {/* Two providers can expose the same model name (native anthropic
            and the Claude Code CLI provider both offer "Claude Opus 5"), so
            the name alone cannot answer "what is actually serving this
            session". Show the provider whenever it is not pi's own. */}
        {currentModel && !NATIVE_PROVIDERS.has(currentModel.provider) && (
          <span className="text-text-tertiary ml-1.5 font-mono text-sm">
            via {currentModel.provider}
          </span>
        )}
      </button>

      {/* Gate on what the menu will actually render (pi's answer when
          present), not the local guess — if the two ever disagree, a chip
          opening a one-item menu (or a hidden chip over real choices) is the
          bug this avoids. */}
      {levelsToRender.length > 1 && (
        <button
          onClick={() => setOpen(open === 'thinking' ? null : 'thinking')}
          className={clsx(
            'rounded-md px-2 py-1 text-base transition-colors',
            open === 'thinking'
              ? 'bg-bg-secondary text-text'
              : 'text-text-secondary hover:bg-bg-secondary hover:text-text',
          )}
        >
          {thinkingLabel(meta.thinkingLevel)}
        </button>
      )}

      {open === 'model' && (
        <ModelMenu
          models={models}
          isCurrent={(m) => currentModel?.id === m.id && currentModel.provider === m.provider}
          onPick={(m) => {
            const model = models.find((x) => x.id === m.id && x.provider === m.provider)
            if (model) void setModel(model)
          }}
          onClose={() => setOpen(null)}
          emptyText="No models configured — sign in via the terminal (`pi /login`) or add API keys."
          className="absolute bottom-full right-0 mb-2 w-[30rem] max-w-[90vw]"
        />
      )}

      {open === 'thinking' && (
        <ThinkingMenu
          levels={levelsToRender}
          current={meta.thinkingLevel}
          onPick={(level) => void setThinking(level)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
