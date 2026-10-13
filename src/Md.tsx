import { Fragment, type ReactNode } from 'react'

/*
  A post's words with a little Markdown (the user, 13 Oct): **bold**, *italic*, [text](link),
  bare links, and lines starting "- " as a list. Built as React nodes, so nothing is injected as HTML.
*/
const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<]+)/g

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
    return <Fragment key={i}><a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{url}</a>{t.slice(url.length)}</Fragment>
  })
}

export default function Md({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{para.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l)}</Fragment>)}</p>)
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>)
    para = []; list = []
  }
  for (const line of text.split(/\r?\n/)) {
    const li = /^\s*[-*•]\s+(.*)$/.exec(line)
    if (li) { if (para.length) { const l = list; list = []; flush(); list = l } list.push(li[1]) }
    else if (!line.trim()) flush()
    else { if (list.length) { const p = para; para = []; flush(); para = p } para.push(line) }
  }
  flush()
  return <div className={'digest-md' + (className ? ' ' + className : '')}>{blocks}</div>
}
