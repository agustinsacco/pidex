import type { ITheme } from '@xterm/xterm'

/** xterm themes derived from pidex tokens (warm light / warm dark). */
export function xtermTheme(resolved: 'light' | 'dark'): ITheme {
  if (resolved === 'dark') {
    return {
      background: '#262624',
      foreground: '#e8e6df',
      cursor: '#d97757',
      cursorAccent: '#262624',
      selectionBackground: '#45383266',
      black: '#3e3e3a',
      red: '#d3766c',
      green: '#7fae83',
      yellow: '#cfa75e',
      blue: '#7aa3c0',
      magenta: '#b58ab0',
      cyan: '#7fb0a8',
      white: '#e8e6df',
      brightBlack: '#737169',
      brightRed: '#e08a80',
      brightGreen: '#93c297',
      brightYellow: '#e0b972',
      brightBlue: '#8eb7d4',
      brightMagenta: '#c99ec4',
      brightCyan: '#93c4bc',
      brightWhite: '#ffffff',
    }
  }
  return {
    background: '#ffffff',
    foreground: '#3d3d3a',
    cursor: '#c96442',
    cursorAccent: '#ffffff',
    selectionBackground: '#f6e8e2',
    black: '#3d3d3a',
    red: '#b5483d',
    green: '#5a8a5e',
    yellow: '#b58a3d',
    blue: '#4a7a9b',
    magenta: '#96608f',
    cyan: '#4f8d84',
    white: '#e5e2d7',
    brightBlack: '#73726c',
    brightRed: '#cc5a4e',
    brightGreen: '#6da172',
    brightYellow: '#cc9d4a',
    brightBlue: '#5c8fb3',
    brightMagenta: '#ab74a3',
    brightCyan: '#61a198',
    brightWhite: '#faf9f5',
  }
}
