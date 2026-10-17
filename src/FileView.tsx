import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, X } from 'lucide-react'

/*
  A post's file, opened inside the app rather than in another tab (the user, 17 Oct: "when opening
  doc it is going to diff tab"). A PDF is drawn page by page here, its links kept live over the
  pages; Word, Excel and PowerPoint open in Microsoft's viewer; anything else is offered as a download.
*/
const OFFICE = /\.(docx?|xlsx?|pptx?)$/i
const PICTURE = /\.(jpe?g|png|webp)$/i

export function fileKind(name: string | null | undefined, url: string): 'pdf' | 'office' | 'picture' | 'other' {
  const n = (name || url).split('?')[0]
  if (/\.pdf$/i.test(n)) return 'pdf'
  if (OFFICE.test(n)) return 'office'
  if (PICTURE.test(n)) return 'picture'
  return 'other'
}

export default function FileView({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const kind = fileKind(name, url)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [onClose])
  return (
    <div className="file-view" role="dialog" aria-modal="true" aria-label={name}>
      <div className="file-view-bar">
        <span className="file-view-name">{name}</span>
        <a className="file-view-btn" href={url} download={name} aria-label="Download" title="Download"><Download size={18} /></a>
        <button type="button" className="file-view-btn" onClick={onClose} aria-label="Close" title="Close"><X size={20} /></button>
      </div>
      <div className="file-view-body">
        {kind === 'pdf' && <PdfPages url={url} />}
        {kind === 'office' && (
          <iframe title={name} className="file-view-frame" src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`} />
        )}
        {kind === 'picture' && <img src={url} alt={name} className="file-view-img" />}
        {kind === 'other' && (
          <div className="file-view-note">
            <p>This file opens in its own app.</p>
            <a className="digest-sheet-btn" href={url} download={name}><Download size={16} /> Download {name}</a>
          </div>
        )}
      </div>
    </div>
  )
}

/** Every page of a PDF, the width of the screen, with its web links laid over the page where they are. */
function PdfPages({ url }: { url: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
        pdfjs.GlobalWorkerOptions.workerSrc = worker
        const doc = await pdfjs.getDocument(url).promise
        const host = box.current
        if (!host || cancelled) return
        host.innerHTML = ''
        const width = Math.min((host.clientWidth || window.innerWidth) - 16, 1000)
        const ratio = window.devicePixelRatio || 1
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return
          const page = await doc.getPage(i)
          const base = page.getViewport({ scale: 1 })
          const vp = page.getViewport({ scale: width / base.width })
          const wrap = document.createElement('div')
          wrap.className = 'file-view-page'
          wrap.style.width = `${vp.width}px`; wrap.style.height = `${vp.height}px`
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(vp.width * ratio); canvas.height = Math.floor(vp.height * ratio)
          canvas.style.width = `${vp.width}px`; canvas.style.height = `${vp.height}px`
          wrap.appendChild(canvas)
          host.appendChild(wrap)
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise
          // A meeting or registration link in the PDF still works: a press opens it.
          for (const a of await page.getAnnotations()) {
            if (a.subtype !== 'Link' || !a.url) continue
            const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect)
            const link = document.createElement('a')
            link.href = a.url; link.target = '_blank'; link.rel = 'noreferrer'
            link.className = 'file-view-link'
            link.style.left = `${Math.min(x1, x2)}px`; link.style.top = `${Math.min(y1, y2)}px`
            link.style.width = `${Math.abs(x2 - x1)}px`; link.style.height = `${Math.abs(y2 - y1)}px`
            wrap.appendChild(link)
          }
          if (i === 1) setState('ready')
        }
      } catch {
        if (!cancelled) setState('failed')
      }
    })()
    return () => { cancelled = true }
  }, [url])
  return (
    <>
      {state === 'loading' && <div className="file-view-note"><Loader2 className="spin" size={28} /></div>}
      {state === 'failed' && (
        <div className="file-view-note">
          <p>This PDF could not be shown here.</p>
          <a className="digest-sheet-btn" href={url} target="_blank" rel="noreferrer">Open it</a>
        </div>
      )}
      <div ref={box} className="file-view-pages" />
    </>
  )
}
