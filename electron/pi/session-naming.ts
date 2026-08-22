/**
 * Session auto-naming: prompt construction and output sanitizing for the
 * one-shot `pi -p` call that titles a session after its first user message.
 *
 * Pure functions — the subprocess plumbing lives in the IPC handler
 * (electron/ipc/pi-session-handlers.ts), which is not unit-testable without
 * spawning processes. Everything with decisions in it is here, tested in
 * __tests__/session-naming.test.ts.
 */

const MAX_TITLE_LENGTH = 60
const MAX_MESSAGE_LENGTH = 1200
const MAX_EXISTING_NAMES = 40

/** The naming request sent to `pi -p --no-session --no-tools`. */
export function titlePrompt(message: string, existingNames: string[]): string {
  const names = existingNames
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, MAX_EXISTING_NAMES)
  const existing =
    names.length > 0
      ? `\nExisting session names in this workspace (yours must not duplicate or be easily confused with any of them):\n${names.map((n) => `- ${n}`).join('\n')}\n`
      : ''
  return (
    'You name coding sessions. Reply with ONLY the name: a short capitalized phrase of 2-5 words ' +
    'summarizing the request below. No quotes, no trailing period, no explanation.\n' +
    existing +
    '\nThe request:\n' +
    message.slice(0, MAX_MESSAGE_LENGTH)
  )
}

/**
 * Distill model stdout into a usable title, or null.
 *
 * Takes the LAST non-empty line: when a model prefaces despite instructions
 * ("Here is the name:"), the name is the tail, never the head. Strips
 * wrapping quotes and trailing periods, collapses whitespace, caps length.
 */
export function sanitizeTitle(stdout: string): string | null {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1)
  if (!line) return null
  const cleaned = line
    .replace(/^["'“”]+|["'“”.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
    .trim()
  return cleaned.length > 0 ? cleaned : null
}

/**
 * Last line of defense against duplicates: the prompt asks the model to
 * avoid existing names, but nothing guarantees it listened. Collisions get a
 * numeric suffix ("Fix Sidebar Resize 2"), case-insensitively.
 */
export function dedupeTitle(title: string, existingNames: string[]): string {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()))
  if (!taken.has(title.toLowerCase())) return title
  for (let n = 2; n < 100; n++) {
    const candidate = `${title} ${n}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return title
}
