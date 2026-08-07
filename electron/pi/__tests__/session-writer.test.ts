import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { appendBranchJump, appendLabel, forkSessionAt } from '../session-writer'
import { readSessionTree } from '../session-tree'
import { parseSessionFile } from '../session-scanner'

/**
 * The writer appends to (and copies) pi's OWN session files — a malformed
 * entry or a clobbered byte corrupts the user's real history. Every test
 * therefore round-trips the result through the real readers (session-tree,
 * session-scanner) AND re-checks the raw file is still LF-terminated JSONL.
 */

const HEADER = {
  type: 'session',
  version: 3,
  id: 'sess-uuid-1',
  timestamp: '2026-08-01T10:00:00.000Z',
  cwd: '/work/proj',
}

function line(obj: unknown): string {
  return JSON.stringify(obj) + '\n'
}

const SESSION_CONTENT =
  line(HEADER) +
  line({
    type: 'message',
    id: 'aaaa0001',
    parentId: null,
    timestamp: '2026-08-01T10:00:01.000Z',
    message: { role: 'user', content: 'build the thing', timestamp: 1 },
  }) +
  line({
    type: 'message',
    id: 'aaaa0002',
    parentId: 'aaaa0001',
    timestamp: '2026-08-01T10:00:05.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Building.' }] },
  }) +
  line({
    type: 'session_info',
    id: 'aaaa0003',
    parentId: 'aaaa0002',
    timestamp: '2026-08-01T10:00:06.000Z',
    name: 'The Build Session',
  })

const LEAF_ID = 'aaaa0003'

const ENTRY_ID_RE = /^[0-9a-f]{8}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Parse every line, failing the test if the file is not LF-terminated JSONL. */
async function parsedLines(path: string): Promise<Record<string, unknown>[]> {
  const raw = await readFile(path, 'utf8')
  const lines = raw.split('\n')
  expect(lines.at(-1)).toBe('') // file ends with a newline
  return lines.slice(0, -1).map((l) => {
    expect(l.trim()).not.toBe('')
    return JSON.parse(l) as Record<string, unknown>
  })
}

function expectIsoTimestamp(value: unknown): void {
  expect(typeof value).toBe('string')
  expect(new Date(value as string).toISOString()).toBe(value)
}

describe('session writer', () => {
  let dir: string
  let sessionPath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pidex-writer-'))
    sessionPath = join(dir, '2026-08-01T10-00-00-000Z_sess-uuid-1.jsonl')
    await writeFile(sessionPath, SESSION_CONTENT, 'utf8')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  describe('appendLabel', () => {
    it('appends a well-formed label entry and preserves prior content byte-for-byte', async () => {
      await appendLabel(sessionPath, 'aaaa0001', 'checkpoint')

      const raw = await readFile(sessionPath, 'utf8')
      expect(raw.slice(0, SESSION_CONTENT.length)).toBe(SESSION_CONTENT)

      const lines = await parsedLines(sessionPath)
      expect(lines).toHaveLength(5)
      const label = lines.at(-1)!
      expect(label.type).toBe('label')
      expect(label.id).toMatch(ENTRY_ID_RE)
      expect(label.parentId).toBe(LEAF_ID)
      expect(label.targetId).toBe('aaaa0001')
      expect(label.label).toBe('checkpoint')
      expectIsoTimestamp(label.timestamp)

      // Round-trip: the real tree reader sees the label and the new leaf.
      const tree = await readSessionTree(sessionPath)
      expect(tree.leafId).toBe(label.id)
      const node = tree.entries.find((e) => e.id === label.id)!
      expect(node).toMatchObject({ type: 'label', targetId: 'aaaa0001', label: 'checkpoint' })
      // ...and the scanner still parses the whole file.
      expect(await parseSessionFile(sessionPath, 1)).toMatchObject({ sessionId: 'sess-uuid-1' })
    })

    it('omits the label key entirely when label is undefined', async () => {
      await appendLabel(sessionPath, 'aaaa0002', undefined)
      const entry = (await parsedLines(sessionPath)).at(-1)!
      expect(entry.targetId).toBe('aaaa0002')
      expect('label' in entry).toBe(false)

      const node = (await readSessionTree(sessionPath)).entries.at(-1)!
      expect(node.label).toBeUndefined()
    })

    it('parents each new label onto the previous one (the leaf moves)', async () => {
      await appendLabel(sessionPath, 'aaaa0001', 'first')
      await appendLabel(sessionPath, 'aaaa0002', 'second')
      const lines = await parsedLines(sessionPath)
      const [first, second] = lines.slice(-2)
      expect(second!.parentId).toBe(first!.id)
    })

    it('uses a null parent on a header-only session', async () => {
      const bare = join(dir, 'bare.jsonl')
      await writeFile(bare, line(HEADER), 'utf8')
      await appendLabel(bare, 'aaaa0001', 'orphan')
      const entry = (await parsedLines(bare)).at(-1)!
      expect(entry.parentId).toBeNull()
      expect((await readSessionTree(bare)).leafId).toBe(entry.id)
    })

    it('skips unparseable trailing lines when resolving the leaf', async () => {
      await appendFile(sessionPath, 'not json at all\n', 'utf8')
      await appendLabel(sessionPath, 'aaaa0001', 'after-garbage')
      const raw = await readFile(sessionPath, 'utf8')
      const entry = JSON.parse(raw.trim().split('\n').at(-1)!) as Record<string, unknown>
      expect(entry.parentId).toBe(LEAF_ID)
    })

    it('rejects when the session file is missing', async () => {
      await expect(appendLabel(join(dir, 'nope.jsonl'), 'aaaa0001', 'x')).rejects.toThrow(/ENOENT/)
    })
  })

  describe('appendBranchJump', () => {
    it('moves the leaf by appending a branch_summary parented at the target', async () => {
      await appendBranchJump(sessionPath, 'aaaa0001')

      const raw = await readFile(sessionPath, 'utf8')
      expect(raw.slice(0, SESSION_CONTENT.length)).toBe(SESSION_CONTENT)

      const jump = (await parsedLines(sessionPath)).at(-1)!
      expect(jump.type).toBe('branch_summary')
      expect(jump.id).toMatch(ENTRY_ID_RE)
      expect(jump.parentId).toBe('aaaa0001')
      expect(jump.fromId).toBe(LEAF_ID)
      expect(typeof jump.summary).toBe('string')
      expectIsoTimestamp(jump.timestamp)

      // Round-trip: the leaf is now the jump entry, hanging off the target.
      const tree = await readSessionTree(sessionPath)
      expect(tree.leafId).toBe(jump.id)
      const leaf = tree.entries.find((e) => e.id === jump.id)!
      expect(leaf.parentId).toBe('aaaa0001')
      // The scanner now counts a second child under aaaa0001 → a branch.
      const meta = await parseSessionFile(sessionPath, 1)
      expect(meta!.branchCount).toBe(1)
    })

    it('is a no-op when the target is already the leaf', async () => {
      await appendBranchJump(sessionPath, LEAF_ID)
      expect(await readFile(sessionPath, 'utf8')).toBe(SESSION_CONTENT)
    })

    it('does not validate the target id — jumping to a nonexistent id still appends', async () => {
      await appendBranchJump(sessionPath, 'ffffffff')
      const jump = (await parsedLines(sessionPath)).at(-1)!
      expect(jump.type).toBe('branch_summary')
      expect(jump.parentId).toBe('ffffffff')
      // The file remains readable even with the orphaned parent.
      expect((await readSessionTree(sessionPath)).leafId).toBe(jump.id)
    })

    it('rejects when the session file is missing', async () => {
      await expect(appendBranchJump(join(dir, 'nope.jsonl'), 'aaaa0001')).rejects.toThrow(/ENOENT/)
    })
  })

  describe('forkSessionAt', () => {
    it('copies into a sibling file with a fresh identity and jumps the leaf', async () => {
      const newPath = await forkSessionAt(sessionPath, 'aaaa0001')

      expect(dirname(newPath)).toBe(dirname(sessionPath))
      expect(basename(newPath)).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[0-9a-f-]{36}\.jsonl$/,
      )

      const lines = await parsedLines(newPath)
      const header = lines[0]!
      expect(header.type).toBe('session')
      expect(header.id).toMatch(UUID_RE)
      expect(header.id).not.toBe('sess-uuid-1')
      expect(header.parentSession).toBe(sessionPath)
      // Untouched header fields carry over from the source.
      expect(header.version).toBe(3)
      expect(header.cwd).toBe('/work/proj')
      expectIsoTimestamp(header.timestamp)
      expect(header.timestamp).not.toBe(HEADER.timestamp)

      // Body is the source body byte-for-byte, plus exactly one jump entry.
      const raw = await readFile(newPath, 'utf8')
      const sourceBody = SESSION_CONTENT.slice(SESSION_CONTENT.indexOf('\n') + 1)
      const body = raw.slice(raw.indexOf('\n') + 1)
      expect(body.slice(0, sourceBody.length)).toBe(sourceBody)
      const jump = lines.at(-1)!
      expect(jump.type).toBe('branch_summary')
      expect(jump.parentId).toBe('aaaa0001')
      expect(jump.fromId).toBe(LEAF_ID)
      expect(lines).toHaveLength(5)

      // The source is untouched.
      expect(await readFile(sessionPath, 'utf8')).toBe(SESSION_CONTENT)

      // Round-trip: tree adopts the new identity, scanner keeps name + lineage.
      const tree = await readSessionTree(newPath)
      expect(tree.sessionId).toBe(header.id)
      expect(tree.leafId).toBe(jump.id)
      const meta = await parseSessionFile(newPath, 1)
      expect(meta).toMatchObject({
        sessionId: header.id,
        parentSession: sessionPath,
        name: 'The Build Session',
      })
    })

    it('skips the jump when forking at the current leaf', async () => {
      const newPath = await forkSessionAt(sessionPath, LEAF_ID)
      const raw = await readFile(newPath, 'utf8')
      const sourceBody = SESSION_CONTENT.slice(SESSION_CONTENT.indexOf('\n') + 1)
      expect(raw.slice(raw.indexOf('\n') + 1)).toBe(sourceBody)
      expect((await parsedLines(newPath)).at(-1)!.type).toBe('session_info')
    })

    it('produces distinct files on repeated forks of the same session', async () => {
      const a = await forkSessionAt(sessionPath, 'aaaa0001')
      const b = await forkSessionAt(sessionPath, 'aaaa0001')
      expect(a).not.toBe(b)
      const [headerA, headerB] = [(await parsedLines(a))[0]!, (await parsedLines(b))[0]!]
      expect(headerA.id).not.toBe(headerB.id)
    })

    it('throws on a file without a header line', async () => {
      const empty = join(dir, 'empty.jsonl')
      await writeFile(empty, '', 'utf8')
      await expect(forkSessionAt(empty, 'aaaa0001')).rejects.toThrow(/no header line/)

      const unterminated = join(dir, 'one-line.jsonl')
      await writeFile(unterminated, JSON.stringify(HEADER), 'utf8') // no trailing \n
      await expect(forkSessionAt(unterminated, 'aaaa0001')).rejects.toThrow(/no header line/)
    })

    it('throws when the first line is not a session header', async () => {
      const bad = join(dir, 'bad.jsonl')
      await writeFile(
        bad,
        line({ type: 'message', id: 'aaaa0001', parentId: null }) + line(HEADER),
        'utf8',
      )
      await expect(forkSessionAt(bad, 'aaaa0001')).rejects.toThrow(/bad header/)
    })

    it('rejects when the source file is missing', async () => {
      await expect(forkSessionAt(join(dir, 'nope.jsonl'), 'aaaa0001')).rejects.toThrow(/ENOENT/)
    })
  })
})
