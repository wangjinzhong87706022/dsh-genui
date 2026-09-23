/**
 * Original-document viewer: an in-page overlay that shows a citation's source
 * document through the host proxy (`/api/ragflow/documents/...`), without
 * leaving the conversation.
 *
 * The browser's native viewers render the streamed file — PDF inline (with
 * `#page=N` jumping to the cited page when the citation carries positions),
 * images and text directly. Office formats the host proxy serves as
 * attachments fall back to the download button in the header.
 *
 * The opener is module-level (citation-store) so both entries reach the one
 * overlay: the citations card's button and the imperative badge popover.
 * With no viewer mounted (a replayed message whose card never rendered) the
 * opener falls back to a plain new-tab open, so the action never dead-ends.
 * @module @changfenhuang/dsh-genui/client/original-viewer
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { proxyUrlFor, registerOriginalViewer } from './citation-store.ts'
import css from './GenuiBlock.module.css'

/** The overlay: one document at a time, Esc / backdrop / × closes. */
export function OriginalViewer(): ReactNode {
  const [citation, setCitation] = useState<GenuiCitationLike | null>(null)
  const close = useCallback(() => setCitation(null), [])

  // 所有权安全注册：多个卡片各挂一个 viewer 时，卸载只清自己的注册。
  useEffect(() => registerOriginalViewer(setCitation), [])

  useEffect(() => {
    if (citation === null) return
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [citation, close])

  if (citation === null) return null
  const url = proxyUrlFor(citation)
  if (url === null) return null

  // Positions carry (page,x0,x1,top,bottom); the page is what a native viewer
  // can jump to via the #page fragment. The box itself needs a self-rendered
  // viewer (a later enhancement) — until then the header names the page.
  const pages = [...new Set((citation.positions ?? []).map(tuple => tuple[0]).filter((page): page is number => page !== undefined && page >= 1))]
  const pageHint = pages.length === 0
    ? (citation.page !== undefined ? `第 ${citation.page} 页` : '')
    : pages.length === 1 ? `第 ${pages[0]} 页` : `第 ${pages[0]}–${pages[pages.length - 1]} 页`

  return (
    <div
      className={css.originalViewer}
      data-original-viewer=""
      role="dialog"
      aria-modal="true"
      onClick={event => { if (event.target === event.currentTarget) close() }}
    >
      <div className={css.originalViewerPanel}>
        <div className={css.originalViewerHead}>
          <span className={css.originalViewerTitle}>{citation.doc}</span>
          {pageHint !== '' && <span className={css.originalViewerPage}>{pageHint}</span>}
          <a className={css.originalViewerDownload} href={url} download={citation.doc}>下载</a>
          <button type="button" className={css.originalViewerClose} onClick={close} aria-label="关闭">×</button>
        </div>
        <iframe
          className={css.originalViewerFrame}
          src={pages.length > 0 ? `${url}#page=${pages[0]}` : url}
          title={citation.doc}
          sandbox="allow-same-origin allow-downloads"
        />
      </div>
    </div>
  )
}

/** Minimal shape the overlay reads (GenuiCitation minus the type-only bits). */
interface GenuiCitationLike {
  doc: string
  page?: number
  documentId?: string
  chunkId?: string
  positions?: number[][]
}
