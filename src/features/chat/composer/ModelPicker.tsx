import { useState } from 'react'
import clsx from 'clsx'
import type { Model, ThinkingLevel } from '@shared/rpc'
import { hasThinkingChoice, supportedThinkingLevels } from '@shared/thinking'
import { useChatStore } from '@/stores/chat'
import { PopupMenu, MenuRow } from '@/components/PopupMenu'
import { CheckIcon } from '@/components/icons'
import { piCallOk } from '@/lib/rpc'
import { refreshThinkingLevels } from '@/stores/sessions'
import { ModelMenu } from './ModelMenu'

/** Real title-case text (not a CSS transform) so labels are accessible. */
function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

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
    const ok = await piCallOk(sessionId, {
      type: 'set_model',
      provider: model.provider,
      modelId: model.id,
    })
    if (ok) {
      useChatStore.getState().patchMeta(sessionId, { model })
      // Supported levels are per-model — re-ask pi after a switch.
      void refreshThinkingLevels(sessionId)
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
          'rounded-md px-2 py-1 text-[12px] font-medium transition-colors',
          open === 'model'
            ? 'bg-bg-secondary text-text'
            : 'text-text-secondary hover:bg-bg-secondary hover:text-text',
        )}
      >
        {currentModel?.name ?? 'No model'}
      </button>

      {currentModel && hasThinkingChoice(currentModel) && (
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
        <ModelMenu
          models={models}
          isCurrent={(m) => currentModel?.id === m.id && currentModel.provider === m.provider}
          onPick={(m) => {
            const model = models.find((x) => x.id === m.id && x.provider === m.provider)
            if (model) void setModel(model)
          }}
          onClose={() => setOpen(null)}
          emptyText="No models configured — sign in via the terminal (`pi /login`) or add API keys."
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
