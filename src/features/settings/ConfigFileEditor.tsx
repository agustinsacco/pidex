import { useEffect, useState } from 'react'
import { MonacoEditor } from '@/features/files/MonacoEditor'
import { ModalOverlay } from '@/components/Modal'
import { useExtensionUiStore } from '@/stores/extensionUi'
import { errorText } from '@shared/errors'

/**
 * Nested modal for editing a raw pi config file (settings.json / models.json).
 *
 * Rendered above the settings modal, so it relies on ModalOverlay's
 * depth-aware Escape handling: Escape closes only this editor, leaving the
 * settings modal (and any unsaved JSON) alone.
 */

export function ConfigFileEditor({
  name,
  onClose,
}: {
  name: 'settings' | 'models' | 'web-search'
  onClose: () => void
}): React.JSX.Element {
  const [content, setContent] = useState<string | null>(null)
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.pidex.invoke('pi:readConfigFile', name).then((file) => {
      setContent(file.content || '{\n}\n')
      setPath(file.path)
    })
  }, [name])

  const save = async (): Promise<void> => {
    if (content === null) return
    try {
      await window.pidex.invoke('pi:writeConfigFile', name, content)
      useExtensionUiStore
        .getState()
        .pushToast(`${name}.json saved — restart sessions to apply`, 'info')
      onClose()
    } catch (err) {
      setError(`Invalid JSON: ${errorText(err)}`)
    }
  }

  return (
    <ModalOverlay onClose={onClose} backdrop="strong" z={50}>
      <div className="border-border bg-bg flex h-[70vh] w-[720px] max-w-[92vw] flex-col overflow-hidden rounded-xl border shadow-2xl">
        <div className="border-border flex items-center gap-2 border-b px-4 py-2.5">
          <span className="flex-1 truncate font-mono text-base">{path}</span>
          {error && <span className="text-danger text-sm">{error}</span>}
          <button
            onClick={onClose}
            className="border-border hover:bg-bg-secondary rounded-md border px-2.5 py-1 text-base font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            className="bg-accent hover:bg-accent-hover text-accent-text rounded-md px-3 py-1 text-base font-medium transition-colors"
          >
            Save
          </button>
        </div>
        <div className="min-h-0 flex-1">
          {content !== null && (
            <MonacoEditor
              path={`pi-config://${name}.json`}
              language="json"
              value={content}
              onChange={setContent}
              onSave={() => void save()}
            />
          )}
        </div>
      </div>
    </ModalOverlay>
  )
}
