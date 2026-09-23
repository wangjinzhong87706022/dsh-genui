/**
 * CitationsNode: a RAGFlow-style "依据" (sources) card — one teal numbered
 * chip per entry, doc name + clause/page beside it, click to expand the
 * verbatim excerpt inline, plus an "open original" action when the entry
 * carries a RAGFlow handle. Mounting also registers the items into the
 * citation store so inline `[[N]]` badges in sibling `text` nodes resolve,
 * and mounts the original-document viewer overlay.
 * @module @changfenhuang/dsh-genui/client/blocks/citations
 */
import { useEffect, useState } from 'react'
import { openInRagflowWeb, openOriginalDocument, registerCitations } from '../citation-store.ts'
import { OriginalViewer } from '../original-viewer.tsx'
import css from '../GenuiBlock.module.css'
import { renderInline } from '../inline.ts'
import type { GenuiCitation, GenuiCitations } from '../spec.ts'

/** Expandable one-entry UI for the citations card. */
function CitationEntry({ item }: { item: GenuiCitation }) {
  const { n, doc, clause, page, quote } = item
  const [open, setOpen] = useState(false)
  const meta = [clause, page !== undefined ? `第${page}页` : ''].filter(part => part !== '').join(' · ')
  const expandable = quote !== undefined && quote !== ''
  // 打开原文：documentId 直取，缺省时 chunkId 经宿主检索历史反查。
  const hasOriginal = (item.documentId !== undefined && item.documentId !== '')
    || (item.chunkId !== undefined && item.chunkId !== '')
  return (
    <div className={css.citationEntry}>
      <div className={css.citationRowGroup}>
        <button
          type="button"
          className={css.citationRow}
          onClick={() => { if (expandable) setOpen(value => !value) }}
          onDoubleClick={() => { openInRagflowWeb(item) }}
          title={expandable ? '单击展开摘录 · 双击在 RAGFlow 中打开（需已登录）' : '双击在 RAGFlow 中打开（需已登录）'}
          aria-expanded={expandable ? open : undefined}
        >
          <span className={css.citationChip} data-cite-chip={n}>{n}</span>
          <span className={css.citationDoc}>{renderInline(doc, false)}</span>
          {meta !== '' && <span className={css.citationMeta}>{meta}</span>}
          {expandable && <span className={css.citationCaret} aria-hidden>{open ? '▾' : '▸'}</span>}
        </button>
        {hasOriginal && (
          <button
            type="button"
            className={css.citationOpen}
            title="在知识库原文档中打开"
            onClick={() => { openOriginalDocument(item) }}
          >
            打开原文
          </button>
        )}
      </div>
      {open && quote !== undefined && quote !== '' && (
        <div className={css.citationQuote} data-cite-quote={n}>{renderInline(quote)}</div>
      )}
    </div>
  )
}

/** The block-level sources card. */
export function CitationsNode({ node }: { node: GenuiCitations }) {
  // Register on mount so inline `[[N]]` badges resolve; re-registration is
  // idempotent (latest answer's items win).
  useEffect(() => { registerCitations(node.items) }, [node.items])
  return (
    <div className={css.citations} data-citations>
      <div className={css.citationsTitle}>
        <span className={css.citationsIcon} aria-hidden>▤</span>
        {node.title ?? '依据'}
        <span className={css.citationsCount}>{node.items.length}</span>
      </div>
      <div className={css.citationsList}>
        {node.items.map(item => <CitationEntry key={item.n} item={item} />)}
      </div>
      {/* 原文查看器随卡片挂载（角标 popover 的按钮经同一 opener 打开它）。 */}
      <OriginalViewer />
    </div>
  )
}
