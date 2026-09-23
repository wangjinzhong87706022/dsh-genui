/**
 * Markdown citation enhancer: post-processes the host's Markdown render to
 * turn `[ID:N]` and `[[N]]` text into interactive teal superscript badges.
 *
 * The host's stock Markdown renderer emits these markers as plain text — they
 * only become interactive chips inside GenUI `text` components (via
 * inline.ts). This module bridges that gap by scanning the rendered Markdown
 * DOM and replacing text-node occurrences with `<sup>` badges that call
 * `openCitationPopover`, matching the inline renderer's behaviour exactly.
 *
 * @module @changfenhuang/dsh-genui/client/markdown-citation-enhancer
 */
import { cancelHoverCitationPopover, hoverCitationPopover, openCitationPopover, getCitationByChunkId, scheduleHoverCitationClose } from './citation-store.ts'

// `[ID:N]` / `[[N]]` / `[[ID:N]]` numeric markers, plus the model quirk
// `[[<chunkId>]]` (a hash string) which resolves through the citations
// registry at render time — an unmapped hash stays plain text.
const CITE_RE = /\[\[(?:ID:)?\d{1,3}\]\]|\[ID:\d{1,3}\]|\[\[[A-Za-z0-9_-]{8,64}\]\]/

/** Resolve a marker token to its citation number; null = leave as text.
 * Inner must be ALL digits to count as a numeric marker — parseInt alone
 * would happily turn hash prefixes like `7b8cf792…` into `7`. */
function resolveBadgeN(token: string): number | null {
  let inner: string
  if (token.startsWith('[[')) {
    inner = token.slice(2, -2)
  } else {
    inner = token.slice(1, -1)
  }
  if (inner.startsWith('ID:')) {
    inner = inner.slice(3)
  }
  if (!/^\d+$/.test(inner)) {
    const item = getCitationByChunkId(inner)
    return item?.n ?? null
  }
  const n = parseInt(inner, 10)
  return Number.isNaN(n) ? null : n
}

function createBadge(n: number): HTMLElement {
  const sup = document.createElement('sup')
  sup.className = 'genui-cite-badge'
  sup.dataset.cite = String(n)
  sup.textContent = `[${n}]`
  sup.addEventListener('click', (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    openCitationPopover(n, event.currentTarget as HTMLElement)
  })
  // Hover 预览（RAGFlow 式）：悬停 300ms 弹 popover，移出 250ms 收；点击仍
  // 打开固定 popover。这些是原生 DOM 监听——本增强器不在 React 管道里。
  sup.addEventListener('mouseenter', (event: MouseEvent) => {
    hoverCitationPopover(n, event.currentTarget as HTMLElement)
  })
  sup.addEventListener('mouseleave', () => {
    cancelHoverCitationPopover()
    scheduleHoverCitationClose()
  })
  return sup
}

function enhanceTextNode(node: Text): void {
  const text = node.nodeValue ?? ''
  const re = /\[\[(?:ID:)?\d{1,3}\]\]|\[ID:\d{1,3}\]|\[\[[A-Za-z0-9_-]{8,64}\]\]/g
  if (!re.test(text)) return
  re.lastIndex = 0
  const parent = node.parentNode
  if (parent === null) return
  const frag = document.createDocumentFragment()
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const token = match[0]
    const n = resolveBadgeN(token)
    if (n === null) continue
    if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)))
    frag.appendChild(createBadge(n))
    last = match.index + token.length
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
  parent.replaceChild(frag, node)
}

function enhanceElement(root: Element): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Text): number {
      if (node.parentElement?.closest('sup.genui-cite-badge') !== null) {
        return NodeFilter.FILTER_REJECT
      }
      if (node.parentElement?.tagName === 'CODE' || node.parentElement?.tagName === 'PRE') {
        return NodeFilter.FILTER_REJECT
      }
      return CITE_RE.test(node.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  const hits: Text[] = []
  let current = walker.nextNode() as Text | null
  while (current !== null) {
    hits.push(current)
    current = walker.nextNode() as Text | null
  }
  for (const node of hits) enhanceTextNode(node)
}

export { enhanceElement as enhanceCitationsInElement }
