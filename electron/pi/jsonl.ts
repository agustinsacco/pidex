import { StringDecoder } from 'node:string_decoder'

/**
 * Strict JSONL splitter for the pi RPC protocol.
 *
 * Records are delimited by LF only; a trailing CR is stripped (CRLF input is
 * accepted). Unicode line separators (U+2028/U+2029) are legal inside JSON
 * strings and must NOT split records — this is why Node's readline is
 * explicitly not protocol-compliant here.
 *
 * Handles multi-byte UTF-8 sequences split across chunk boundaries via
 * StringDecoder.
 */
export class JsonlDecoder {
  private buffer = ''
  private readonly decoder = new StringDecoder('utf8')

  /** Feed a chunk; returns zero or more complete lines (without delimiters). */
  push(chunk: Buffer | string): string[] {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk)

    const lines: string[] = []
    let newlineIndex: number
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      let line = this.buffer.slice(0, newlineIndex)
      this.buffer = this.buffer.slice(newlineIndex + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (line.length > 0) lines.push(line)
    }
    return lines
  }

  /** Flush any remaining buffered data as a final line (stream end). */
  end(): string[] {
    this.buffer += this.decoder.end()
    if (this.buffer.length === 0) return []
    let line = this.buffer
    this.buffer = ''
    if (line.endsWith('\r')) line = line.slice(0, -1)
    return line.length > 0 ? [line] : []
  }
}
