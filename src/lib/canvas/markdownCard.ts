/**
 * The markdown a canvas card shows.
 *
 * Obsidian renders card text as markdown and swaps it for the source while you
 * edit. This module produces a tiny block/inline tree from that source; the
 * view maps it to React elements, so no HTML string ever reaches the DOM
 * (there is no `dangerouslySetInnerHTML` anywhere in this app).
 *
 * Scope is deliberately small — what fits in a card: headings, paragraphs with
 * hard line breaks, bullet/ordered/task lists, quotes, fenced code, bold,
 * italic, strikethrough, inline code, links and `[[wikilinks]]`.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'strike'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] }
  | { kind: 'wikilink'; target: string; label: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'break' }

export type Block =
  | { kind: 'heading'; level: number; lines: Inline[][] }
  | { kind: 'paragraph'; lines: Inline[][] }
  | { kind: 'quote'; lines: Inline[][] }
  | { kind: 'list'; ordered: boolean; items: { checked?: boolean; lines: Inline[][] }[] }
  | { kind: 'code'; lang: string; text: string }

const FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*([\w-]*)[ \t]*$/
const HEADING = /^(#{1,6})[ \t]+(.*)$/
const QUOTE = /^[ \t]*>[ \t]?(.*)$/
const BULLET = /^[ \t]*[-*+][ \t]+(.*)$/
const ORDERED = /^[ \t]*\d+[.)][ \t]+(.*)$/
const TASK = /^\[([ xX])\][ \t]+(.*)$/
const TAG = /(^|[\s([{,;:'"])#([\p{L}\p{N}_/-]+)/u

/** Emphasis/link markers, longest first so `**` wins over `*`. */
const EMPHASIS: { marker: string; kind: 'strong' | 'em' | 'strike' }[] = [
  { marker: '**', kind: 'strong' },
  { marker: '__', kind: 'strong' },
  { marker: '~~', kind: 'strike' },
  { marker: '*', kind: 'em' },
  { marker: '_', kind: 'em' },
]

function findClosing(source: string, marker: string, from: number): number {
  let index = source.indexOf(marker, from)
  while (index !== -1) {
    // A closing marker must have content before it and not be escaped.
    if (index > from && source[index - 1] !== '\\') return index
    index = source.indexOf(marker, index + 1)
  }
  return -1
}

function pushText(out: Inline[], text: string): void {
  if (!text) return
  const last = out[out.length - 1]
  if (last && last.kind === 'text') {
    out[out.length - 1] = { kind: 'text', text: last.text + text }
    return
  }
  out.push({ kind: 'text', text })
}

/** Inline markdown of one line. Unmatched markers stay literal. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = []
  let index = 0
  let plain = ''

  const flush = () => {
    if (plain) pushText(out, plain)
    plain = ''
  }

  while (index < source.length) {
    const char = source[index]

    // Escaped punctuation.
    if (char === '\\' && index + 1 < source.length) {
      plain += source[index + 1]
      index += 2
      continue
    }

    // Inline code wins over everything: `**` inside backticks is literal.
    if (char === '`') {
      const ticks = source.startsWith('``', index) ? '``' : '`'
      const close = findClosing(source, ticks, index + ticks.length)
      if (close !== -1) {
        flush()
        out.push({ kind: 'code', text: source.slice(index + ticks.length, close) })
        index = close + ticks.length
        continue
      }
    }

    // [[wikilink]] / ![[embed]] — an embed renders as its label in a card.
    if (char === '[' && source.startsWith('[', index + 1)) {
      const close = source.indexOf(']]', index + 2)
      if (close !== -1) {
        flush()
        const inner = source.slice(index + 2, close)
        const [target, alias] = inner.split('|')
        out.push({ kind: 'wikilink', target: target.trim(), label: (alias ?? target).trim() })
        index = close + 2
        continue
      }
    }

    // [text](href)
    if (char === '[') {
      const close = source.indexOf(']', index + 1)
      if (close !== -1 && source[close + 1] === '(') {
        const end = source.indexOf(')', close + 2)
        if (end !== -1) {
          flush()
          out.push({
            kind: 'link',
            href: source.slice(close + 2, end).trim(),
            children: parseInline(source.slice(index + 1, close)),
          })
          index = end + 1
          continue
        }
      }
    }

    // #tag (start of a word only, like the editor's tag highlighter).
    if (char === '#' && (index === 0 || /[\s([{,;:'"]/.test(source[index - 1]))) {
      const match = source.slice(index).match(TAG)
      if (match) {
        flush()
        out.push({ kind: 'tag', tag: match[2] })
        index += match[0].length
        continue
      }
    }

    // **strong**, *em*, ~~strike~~. `_` only opens at a word boundary so
    // snake_case survives.
    let matched = false
    for (const { marker, kind } of EMPHASIS) {
      if (!source.startsWith(marker, index)) continue
      if (marker[0] === '_' && index > 0 && /[\p{L}\p{N}]/u.test(source[index - 1])) continue
      const close = findClosing(source, marker, index + marker.length)
      if (close === -1) continue
      flush()
      out.push({ kind, children: parseInline(source.slice(index + marker.length, close)) })
      index = close + marker.length
      matched = true
      break
    }
    if (matched) continue

    plain += char
    index++
  }

  flush()
  return out
}

function splitLines(source: string): string[] {
  return source.split('\n')
}

/** The whole card: blocks on top, hard line breaks kept inside each block. */
export function parseCardMarkdown(source: string): Block[] {
  const lines = splitLines(source.replace(/\r\n?/g, '\n'))
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    const fence = line.match(FENCE)
    if (fence) {
      const marker = fence[1][0]
      const lang = fence[2] ?? ''
      const body: string[] = []
      index++
      while (index < lines.length && !lines[index].trimStart().startsWith(marker.repeat(3))) {
        body.push(lines[index])
        index++
      }
      // Skip the closing fence (or stop at EOF, like every markdown parser).
      if (index < lines.length) index++
      blocks.push({ kind: 'code', lang, text: body.join('\n') })
      continue
    }

    if (!line.trim()) {
      index++
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1].length,
        lines: [parseInline(heading[2])],
      })
      index++
      continue
    }

    if (QUOTE.test(line)) {
      const quoted: Inline[][] = []
      while (index < lines.length && QUOTE.test(lines[index])) {
        quoted.push(parseInline(lines[index].match(QUOTE)![1]))
        index++
      }
      blocks.push({ kind: 'quote', lines: quoted })
      continue
    }

    const bullet = line.match(BULLET)
    const ordered = line.match(ORDERED)
    if (bullet || ordered) {
      const isOrdered = !bullet && !!ordered
      const items: { checked?: boolean; lines: Inline[][] }[] = []
      while (index < lines.length) {
        const bulletLine = lines[index].match(BULLET)
        const orderedLine = lines[index].match(ORDERED)
        const content = isOrdered ? orderedLine?.[1] : bulletLine?.[1]
        if (content === undefined) break
        const task = content.match(TASK)
        items.push({
          checked: task ? task[1].toLowerCase() === 'x' : undefined,
          lines: [parseInline(task ? task[2] : content)],
        })
        index++
      }
      blocks.push({ kind: 'list', ordered: isOrdered, items })
      continue
    }

    // A paragraph is consecutive non-empty lines; each line keeps its break.
    const paragraph: Inline[][] = []
    while (
      index < lines.length &&
      lines[index].trim() &&
      !FENCE.test(lines[index]) &&
      !HEADING.test(lines[index]) &&
      !QUOTE.test(lines[index]) &&
      !BULLET.test(lines[index]) &&
      !ORDERED.test(lines[index])
    ) {
      paragraph.push(parseInline(lines[index]))
      index++
    }
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', lines: paragraph })
  }

  return blocks
}

/** One-line text for a card title, a preview or an aria label. */
export function cardPlainText(source: string, max = 200): string {
  const flat = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target: string, alias?: string) => alias ?? target)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.slice(0, max)
}
