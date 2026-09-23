/**
 * Citation registry + popover: the shared runtime behind inline `[[N]]`
 * markers and `citations` blocks.
 *
 * A `citations` node registers its items on mount (latest registration wins,
 * so the answer the reader is looking at is always the lookup source); an
 * inline `[[N]]` badge in a sibling `text` node opens the popover with the
 * registered content. The popover is imperative DOM on <body> — inline.ts is
 * a plain-function renderer with no React root of its own, so a portal would
 * need a host mount that may not exist (embedded hosts).
 * @module @changfenhuang/dsh-genui/client/citation-store
 */
import css from './GenuiBlock.module.css'

import type { GenuiCitation } from './spec.ts'

/** All currently registered citation entries, keyed by marker number. */
let registry = new Map<number, GenuiCitation>()

/** Replace the registry (a citations node mount — the latest answer wins). */
export function registerCitations(items: readonly GenuiCitation[]): void {
  const next = new Map<number, GenuiCitation>()
  for (const item of items) next.set(item.n, item)
  registry = next
}

/** Current registry size (test/observability hook). */
export function citationCount(): number {
  return registry.size
}

/** Look up one citation by marker number. */
export function getCitation(n: number): GenuiCitation | undefined {
  return registry.get(n)
}

/** Look up one citation by its RAGFlow chunk id (model quirk: some answers
 * emit `[[<chunkId>]]` markers instead of `[ID:N]`; resolving through the
 * registry keeps those badges working without a re-ask). */
export function getCitationByChunkId(chunkId: string): GenuiCitation | undefined {
  for (const item of registry.values()) {
    if (item.chunkId === chunkId) return item
  }
  return undefined
}

/* ---------------- original document ---------------- */

/**
 * Host proxy route serving a RAGFlow knowledge-base document's original
 * file (the ragflow plugin's `ragflow-documents` row; the API key stays
 * host-side). `by-chunk` resolves a chunkId through the host's retrieval
 * history — the model's citations fence carries chunkId reliably but
 * documentId unreliably (observed: omitted, or the document NAME copied
 * in).
 */
const ORIGINAL_DOCUMENT_ROUTE = '/api/ragflow/documents'

/** The proxy URL serving one citation's original document, or null when it
 * carries neither handle. */
export function proxyUrlFor(citation: { documentId?: string; chunkId?: string }): string | null {
  if (citation.documentId !== undefined && citation.documentId !== '') {
    return `${ORIGINAL_DOCUMENT_ROUTE}/${encodeURIComponent(citation.documentId)}`
  }
  if (citation.chunkId !== undefined && citation.chunkId !== '') {
    return `${ORIGINAL_DOCUMENT_ROUTE}/by-chunk/${encodeURIComponent(citation.chunkId)}`
  }
  return null
}

/**
 * The mounted original-viewer overlay's opener, or null when no viewer is
 * mounted (a replayed message whose citations card never rendered).
 */
let viewerOpener: ((citation: GenuiCitation) => void) | null = null

/**
 * Register the mounted viewer's opener; the returned disposer clears it only
 * when THIS registration still owns the slot — several cards may mount a
 * viewer concurrently and a staler one unmounting must not evict a live one.
 */
export function registerOriginalViewer(opener: (citation: GenuiCitation) => void): () => void {
  viewerOpener = opener
  return () => { if (viewerOpener === opener) viewerOpener = null }
}

/**
 * Open one citation's original document: the mounted viewer when present, a
 * new tab otherwise. Safe to call from React handlers and imperative DOM
 * (the badge popover) alike.
 * @param citation - the entry carrying documentId and/or chunkId.
 */
export function openOriginalDocument(citation: GenuiCitation): void {
  if (viewerOpener !== null) {
    viewerOpener(citation)
    return
  }
  const url = proxyUrlFor(citation)
  if (url !== null) window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Open the citation's document page in the RAGFlow web frontend (double-click
 * on a citation row): the host 302s to `{webBase}/document/{id}`. PERMISSIONS:
 * the web frontend needs a logged-in browser session on the RAGFlow origin —
 * the API key cannot log the user in, so an unauthenticated browser lands on
 * RAGFlow's login page.
 */
export function openInRagflowWeb(citation: { documentId?: string; chunkId?: string }): void {
  const path = citation.documentId !== undefined && citation.documentId !== ''
    ? `/api/ragflow/web-open/${encodeURIComponent(citation.documentId)}`
    : citation.chunkId !== undefined && citation.chunkId !== ''
      ? `/api/ragflow/web-open/by-chunk/${encodeURIComponent(citation.chunkId)}`
      : null
  if (path !== null) window.open(path, '_blank', 'noopener,noreferrer')
}

/* ---------------- popover ---------------- */

let popover: HTMLDivElement | null = null
let outsideClose: ((event: MouseEvent) => void) | null = null
let keyClose: ((event: KeyboardEvent) => void) | null = null
/** Pending hover-close timer (hover mode keeps the popover while pointed at). */
let hoverCloseTimer: number | null = null
/** Pending hover-open timer (badge mouseenter; one hover at a time). */
let hoverOpenTimer: number | null = null
/** Hover open/close latencies: fast enough to feel attached, slow enough not to flicker. */
const HOVER_OPEN_MS = 300
const HOVER_CLOSE_MS = 250

function closeCitationPopover(): void {
  if (hoverCloseTimer !== null) {
    window.clearTimeout(hoverCloseTimer)
    hoverCloseTimer = null
  }
  if (popover !== null) {
    popover.remove()
    popover = null
  }
  if (outsideClose !== null) {
    document.removeEventListener('click', outsideClose, true)
    outsideClose = null
  }
  if (keyClose !== null) {
    document.removeEventListener('keydown', keyClose, true)
    keyClose = null
  }
}

/** One meta line inside the popover (clause / page / provenance ids). */
function metaLine(item: GenuiCitation): string {
  const parts = [
    item.clause,
    item.page !== undefined ? `第${item.page}页` : '',
    item.chunkId !== undefined ? `chunk ${item.chunkId}` : '',
  ].filter(part => part !== '')
  return parts.join(' · ')
}

/** Whether one entry carries a handle the document proxy can resolve. */
function hasOriginalHandle(item: GenuiCitation): boolean {
  return (item.documentId !== undefined && item.documentId !== '')
    || (item.chunkId !== undefined && item.chunkId !== '')
}

/**
 * Open the citation popover for marker `n`, anchored to the clicked badge.
 * `mode='hover'` adds keep-alive listeners on the popover. Falls back to an
 * inline "unregistered marker" hint so a dangling `[[N]]` never looks like a
 * dead control.
 */
export function openCitationPopover(n: number, anchor: HTMLElement, mode: 'click' | 'hover' = 'click'): void {
  closeCitationPopover()
  const item = getCitation(n)
  const box = document.createElement('div')
  box.className = css.citationPopover ?? ''
  box.setAttribute('role', 'dialog')
  box.dataset.citePopover = String(n)

  const header = document.createElement('div')
  header.className = css.citationPopoverHead ?? ''
  const chip = document.createElement('span')
  chip.className = css.citationChip ?? ''
  chip.textContent = String(n)
  header.appendChild(chip)
  const doc = document.createElement('span')
  doc.className = css.citationPopoverDoc ?? ''
  doc.textContent = item?.doc ?? ''
  header.appendChild(doc)
  const meta = metaLine(item ?? { n, doc: '' })
  if (meta !== '') {
    const metaEl = document.createElement('span')
    metaEl.className = css.citationPopoverMeta ?? ''
    metaEl.textContent = meta
    header.appendChild(metaEl)
  }
  box.appendChild(header)

  const quote = document.createElement('div')
  quote.className = css.citationPopoverQuote ?? ''
  // Plain text on purpose: excerpts come from retrieval chunks, and the
  // popover is imperative DOM — no React root to render inline markup into.
  quote.textContent = item === undefined
    ? '未注册的引用编号'
    : (item.quote !== undefined && item.quote !== '' ? item.quote : '（无原文摘录）')
  box.appendChild(quote)

  // 「打开原文」：条目带 RAGFlow documentId 或 chunkId 时出现（代理按前者
  // 直取、后者经检索历史反查；老答案两者皆无的条目保持原样）。
  if (item !== undefined && hasOriginalHandle(item)) {
    const open = document.createElement('button')
    open.type = 'button'
    open.className = css.citationPopoverOpen ?? ''
    open.textContent = '打开原文'
    open.addEventListener('click', (event) => {
      event.stopPropagation()
      openOriginalDocument(item)
    })
    box.appendChild(open)
  }

  document.body.appendChild(box)
  const rect = anchor.getBoundingClientRect()
  const boxRect = box.getBoundingClientRect()
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - boxRect.width - 8)
  const below = rect.bottom + 6
  box.style.left = `${Math.round(left)}px`
  box.style.top = `${Math.round(below + boxRect.height > window.innerHeight - 8
    ? Math.max(8, rect.top - boxRect.height - 6)
    : below)}px`

  popover = box
  // Hover 保活：指针移入 popover 取消关闭计时，移出（badge 与 popover 之外）再关。
  if (mode === 'hover') {
    box.addEventListener('mouseenter', () => {
      if (hoverCloseTimer !== null) {
        window.clearTimeout(hoverCloseTimer)
        hoverCloseTimer = null
      }
    })
    box.addEventListener('mouseleave', () => scheduleHoverCitationClose())
  }
  outsideClose = event => {
    if (popover !== null && event.target instanceof Node && !popover.contains(event.target) && event.target !== anchor) {
      closeCitationPopover()
    }
  }
  keyClose = event => {
    if (event.key === 'Escape') closeCitationPopover()
  }
  document.addEventListener('click', outsideClose, true)
  document.addEventListener('keydown', keyClose, true)
}

/**
 * Schedule a hover-open for marker `n` (badge mouseenter); cancels any
 * pending hover close so moving between adjacent badges never blanks.
 */
export function hoverCitationPopover(n: number, anchor: HTMLElement): void {
  if (hoverOpenTimer !== null) window.clearTimeout(hoverOpenTimer)
  hoverOpenTimer = window.setTimeout(() => {
    hoverOpenTimer = null
    openCitationPopover(n, anchor, 'hover')
  }, HOVER_OPEN_MS)
}

/** Cancel a pending hover-open (badge mouseleave before the delay elapses). */
export function cancelHoverCitationPopover(): void {
  if (hoverOpenTimer !== null) {
    window.clearTimeout(hoverOpenTimer)
    hoverOpenTimer = null
  }
}

/**
 * Schedule hover-close (badge mouseleave); cancelled by entering the popover.
 *
 * A short grace window: moving from the badge to the popover crosses a gap
 * (the popover sits below the badge), and mouseleave fires the moment the
 * pointer leaves the badge — before the popover's own mouseenter. Closing on
 * the first leave would therefore blank the popover mid-crossing. On elapse,
 * a pointer currently INSIDE the popover keeps it alive (crossing case).
 */
export function scheduleHoverCitationClose(): void {
  if (hoverCloseTimer !== null) return
  hoverCloseTimer = window.setTimeout(() => {
    hoverCloseTimer = null
    if (popover !== null && !popover.matches(':hover')) closeCitationPopover()
  }, HOVER_CLOSE_MS)
}
