import { memo, useEffect, useRef } from 'react'
import type * as MonacoTypes from 'monaco-editor'
import { getMonaco, monacoThemeFor } from '@/lib/monaco'
import { useSettingsStore } from '@/stores/settings'

type Monaco = typeof MonacoTypes
type Editor = MonacoTypes.editor.IStandaloneCodeEditor

const viewStates = new Map<string, MonacoTypes.editor.ICodeEditorViewState | null>()

interface MonacoEditorProps {
  path: string
  language: string
  value: string
  readOnly?: boolean
  revealLine?: number
  onChange?: (value: string) => void
  onSave?: () => void
}

/** Single Monaco editor with per-path models (undo stacks survive tab switches). */
export const MonacoEditor = memo(function MonacoEditor({
  path,
  language,
  value,
  readOnly = false,
  revealLine,
  onChange,
  onSave,
}: MonacoEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const currentPathRef = useRef<string>(path)
  const suppressChange = useRef(false)
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme)

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  // Mount once.
  useEffect(() => {
    let disposed = false
    let editor: Editor | null = null

    void getMonaco().then((monaco) => {
      if (disposed || !containerRef.current) return
      monacoRef.current = monaco
      editor = monaco.editor.create(containerRef.current, {
        theme: monacoThemeFor(useSettingsStore.getState().resolvedTheme),
        automaticLayout: true,
        fontSize: 12.5,
        fontFamily: 'JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 8 },
        renderWhitespace: 'selection',
        smoothScrolling: true,
        readOnly,
      })
      editorRef.current = editor

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSaveRef.current?.()
      })

      editor.onDidChangeModelContent(() => {
        if (suppressChange.current) return
        onChangeRef.current?.(editor!.getValue())
      })

      attachModel(monaco, editor, path, language, value, revealLine)
    })

    return () => {
      disposed = true
      if (editor) {
        viewStates.set(currentPathRef.current, editor.saveViewState())
        editor.dispose()
      }
      editorRef.current = null
    }
  }, [])

  // Path switch: swap model.
  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) return
    if (currentPathRef.current !== path) {
      viewStates.set(currentPathRef.current, editor.saveViewState())
      attachModel(monaco, editor, path, language, value, revealLine)
      currentPathRef.current = path
    }
  })

  // External value change (reload from disk) for the current model.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const model = editor.getModel()
    if (model && model.getValue() !== value && currentPathRef.current === path) {
      suppressChange.current = true
      // Preserve cursor where possible.
      const position = editor.getPosition()
      model.setValue(value)
      if (position) editor.setPosition(position)
      suppressChange.current = false
    }
  }, [value, path])

  // Reveal line requests.
  useEffect(() => {
    const editor = editorRef.current
    if (editor && revealLine !== undefined) {
      editor.revealLineInCenter(revealLine)
      editor.setPosition({ lineNumber: revealLine, column: 1 })
      editor.focus()
    }
  }, [revealLine, path])

  // Theme switching.
  useEffect(() => {
    monacoRef.current?.editor.setTheme(monacoThemeFor(resolvedTheme))
  }, [resolvedTheme])

  function attachModel(
    monaco: Monaco,
    editor: Editor,
    modelPath: string,
    modelLanguage: string,
    modelValue: string,
    reveal?: number,
  ): void {
    const uri = monaco.Uri.file(modelPath)
    let model = monaco.editor.getModel(uri)
    if (!model) {
      model = monaco.editor.createModel(modelValue, modelLanguage, uri)
    } else if (model.getValue() !== modelValue) {
      suppressChange.current = true
      model.setValue(modelValue)
      suppressChange.current = false
    }
    editor.setModel(model)
    const saved = viewStates.get(modelPath)
    if (saved) editor.restoreViewState(saved)
    if (reveal !== undefined) {
      editor.revealLineInCenter(reveal)
      editor.setPosition({ lineNumber: reveal, column: 1 })
    }
    editor.focus()
  }

  return <div ref={containerRef} className="h-full w-full" />
})

interface MonacoDiffProps {
  originalText: string
  modifiedText: string
  language: string
  renderSideBySide: boolean
}

export const MonacoDiff = memo(function MonacoDiff({
  originalText,
  modifiedText,
  language,
  renderSideBySide,
}: MonacoDiffProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<MonacoTypes.editor.IStandaloneDiffEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme)

  useEffect(() => {
    let disposed = false
    let editor: MonacoTypes.editor.IStandaloneDiffEditor | null = null
    let original: MonacoTypes.editor.ITextModel | null = null
    let modified: MonacoTypes.editor.ITextModel | null = null

    void getMonaco().then((monaco) => {
      if (disposed || !containerRef.current) return
      monacoRef.current = monaco
      editor = monaco.editor.createDiffEditor(containerRef.current, {
        theme: monacoThemeFor(useSettingsStore.getState().resolvedTheme),
        automaticLayout: true,
        fontSize: 12,
        fontFamily: 'JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace',
        minimap: { enabled: false },
        readOnly: true,
        renderSideBySide,
        scrollBeyondLastLine: false,
        hideUnchangedRegions: { enabled: true },
        renderOverviewRuler: false,
      })
      original = monaco.editor.createModel(originalText, language)
      modified = monaco.editor.createModel(modifiedText, language)
      editor.setModel({ original, modified })
      editorRef.current = editor
    })

    return () => {
      disposed = true
      editor?.dispose()
      original?.dispose()
      modified?.dispose()
    }
  }, [originalText, modifiedText, language])

  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide })
  }, [renderSideBySide])

  useEffect(() => {
    monacoRef.current?.editor.setTheme(monacoThemeFor(resolvedTheme))
  }, [resolvedTheme])

  return <div ref={containerRef} className="h-full w-full" />
})
