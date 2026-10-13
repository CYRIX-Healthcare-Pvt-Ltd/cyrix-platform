import { Fragment, type ReactNode } from 'react'

/*
  A post's words with a little Markdown (the user, 13 Oct): **bold**, *italic*, [text](link),
  bare links, and lines starting "- " as a list. Built as React nodes, so nothing is injected as HTML.
*/
const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<]+|\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:in|com|org|net|io|co|ai|app|gov|edu)\b(?:\/[^\s<]*)?)/gi

function inline(s: string): ReactNode[] {
  return s.split(INLINE).map((t, i) => {
    if (i % 2 === 0) return t
    if (t.startsWith('**')) return <strong key={i}>{inline(t.slice(2, -2))}</strong>
    if (t.startsWith('[')) {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!
      return <a key={i} href={m[2]} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{inline(m[1])}</a>
    }
    if (t.startsWith('*')) return <em key={i}>{inline(t.slice(1, -1))}</em>
    const url = t.replace(/[.,;:!?)]+$/, '')
    return <Fragment key={i}><a href={/^https?:/i.test(url) ? url : 'https://' + url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{url}</a>{t.slice(url.length)}</Fragment>
  })
}

export default function Md({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: Array<{ text: string; sub: string[] }> } | null = null
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{para.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l)}</Fragment>)}</p>)
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it.text)}{it.sub.length > 0 && <ul>{it.sub.map((x, j) => <li key={j}>{inline(x)}</li>)}</ul>}</li>)
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>)
    }
    para = []; list = null
  }
  for (const line of text.split(/\r?\n/)) {
    const h = /^\s*(#{1,6})\s+(.*)$/.exec(line)
    const ol = /^(\s*)\d+[.)]\s+(.*)$/.exec(line)
    const ul = /^(\s*)[-*•]\s+(.*)$/.exec(line)
    if (h) { flush(); blocks.push(<p key={blocks.length} className={'digest-md-h' + Math.min(h[1].length, 3)}>{inline(h[2])}</p>) }
    else if (ul && list && (ul[1].length > 0 || list.ordered) && list.items.length) list.items[list.items.length - 1].sub.push(ul[2])
    else if (ol || ul) {
      const ordered = !!ol, t = (ol ?? ul)![2]
      if (para.length || (list && list.ordered !== ordered)) flush()
      if (!list) list = { ordered, items: [] }
      list.items.push({ text: t, sub: [] })
    }
    else if (!line.trim()) { if (!list) flush() }
    else if (list && /^\s+/.test(line) && list.items.length) list.items[list.items.length - 1].text += ' ' + line.trim()
    else { if (list) flush(); para.push(line) }
  }
  flush()
  return <div className={'digest-md' + (className ? ' ' + className : '')}>{blocks}</div>
}

/** The words alone, for a card's two-line teaser: no marks, links as their text. */
export const plain = (t: string) => t
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*|__|(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$)/g, '$1')
  .replace(/^\s*#{1,6}\s+/gm, '').replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '').replace(/\s+/g, ' ').trim()
