/**
 * Monaco singleton: bundled workers (no CDN — strict CSP), theme definitions
 * bound to pidex tokens, lazy loading as an async chunk.
 */
import type * as MonacoTypes from 'monaco-editor'

let monacoPromise: Promise<typeof MonacoTypes> | null = null

export function getMonaco(): Promise<typeof MonacoTypes> {
  if (!monacoPromise) {
    monacoPromise = loadMonaco()
  }
  return monacoPromise
}

async function loadMonaco(): Promise<typeof MonacoTypes> {
  const [monaco, { default: EditorWorker }, { default: JsonWorker }, { default: CssWorker }, { default: HtmlWorker }, { default: TsWorker }] =
    await Promise.all([
      import('monaco-editor'),
      import('monaco-editor/esm/vs/editor/editor.worker?worker'),
      import('monaco-editor/esm/vs/language/json/json.worker?worker'),
      import('monaco-editor/esm/vs/language/css/css.worker?worker'),
      import('monaco-editor/esm/vs/language/html/html.worker?worker'),
      import('monaco-editor/esm/vs/language/typescript/ts.worker?worker'),
    ])

  ;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case 'json':
          return new JsonWorker()
        case 'css':
        case 'scss':
        case 'less':
          return new CssWorker()
        case 'html':
        case 'handlebars':
        case 'razor':
          return new HtmlWorker()
        case 'typescript':
        case 'javascript':
          return new TsWorker()
        default:
          return new EditorWorker()
      }
    },
  }

  monaco.editor.defineTheme('pidex-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#3d3d3a',
      'editorLineNumber.foreground': '#a3a29a',
      'editorLineNumber.activeForeground': '#73726c',
      'editor.selectionBackground': '#f6e8e2',
      'editor.lineHighlightBackground': '#faf9f5',
      'editorCursor.foreground': '#c96442',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#e5e2d7',
      'diffEditor.insertedTextBackground': '#5a8a5e26',
      'diffEditor.removedTextBackground': '#b5483d21',
      'diffEditor.insertedLineBackground': '#5a8a5e14',
      'diffEditor.removedLineBackground': '#b5483d10',
    },
  })

  monaco.editor.defineTheme('pidex-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#262624',
      'editor.foreground': '#e8e6df',
      'editorLineNumber.foreground': '#737169',
      'editorLineNumber.activeForeground': '#a6a49c',
      'editor.selectionBackground': '#453832',
      'editor.lineHighlightBackground': '#2d2d2b',
      'editorCursor.foreground': '#d97757',
      'editorWidget.background': '#30302e',
      'editorWidget.border': '#3e3e3a',
      'diffEditor.insertedTextBackground': '#7fae8330',
      'diffEditor.removedTextBackground': '#d3766c28',
      'diffEditor.insertedLineBackground': '#7fae831a',
      'diffEditor.removedLineBackground': '#d3766c15',
    },
  })

  // Keep TS service quiet on random project files (no tsconfig context).
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  })
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  })

  return monaco
}

export function monacoThemeFor(resolved: 'light' | 'dark'): string {
  return resolved === 'dark' ? 'pidex-dark' : 'pidex-light'
}

const EXT_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  swift: 'swift',
  php: 'php',
  xml: 'xml',
  svg: 'xml',
  vue: 'html',
  graphql: 'graphql',
  proto: 'protobuf',
  dockerfile: 'dockerfile',
}

export function languageForPath(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? ''
  if (/^dockerfile$/i.test(base)) return 'dockerfile'
  if (/^makefile$/i.test(base)) return 'makefile'
  const ext = base.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANGUAGE[ext] ?? 'plaintext'
}
