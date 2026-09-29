/**
 * Original-document viewer: an in-page overlay that shows a citation's source
 * document through the host proxy (`/api/ragflow/documents/...`), without
 * leaving the conversation.
 *
 * Rendering is dispatched on a preflight probe (fetch → status +
 * Content-Type, body transfer aborted) via `pickDocPresentation`
 * (original-doc-presentation.ts — pure, unit-tested):
 * - `application/pdf` → PdfJsFrame（pdf.js canvas 自渲染；无插件文档/iframe
 *   sandbox 语义纠缠，缺 PDF 插件的嵌入式 Chromium 也能渲染）；资产/文档失败
 *   降级为 新标签/下载 提示。
 * - `text/html` → iframe + `sandbox="allow-scripts"`（可信文档跑脚本，opaque
 *   origin 隔离宿主）。
 * - 其它（图片/文本）→ iframe 无 sandbox（同源自有内容，历史行为）。
 * - 非 2xx → 错误面板（正文从同源 contentDocument 或预检响应补充）。
 *
 * 空白/屏蔽页修复史（2026-09-29）：① Chromium 对插件文档（PDF）在 sandbox
 * iframe 里一律拦截——同源期已去掉 sandbox；② 代理业务失败信封转真 404
 * （document.js）；③ 插件 PDF 的 `load` 事件不可依赖 → 8 秒自撤浮层；④ 内嵌
 * Chromium 缺 PDF 插件 → 空文档检测 + 操作提示（iframe 路径仍保留此检测）。
 *
 * 跨源可信代理（多租户网关）的扩展规格——内容类型分派表、代理义务（HEAD 已
 * 在 document.js 落地、Range 已落地、签名 URL 与 CSP frame-ancestors 待 P3）——
 * 见 askdata 仓 `docs/original-doc-viewer-spec.md`。
 * @module @changfenhuang/dsh-genui/client/original-viewer
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { proxyUrlFor, registerOriginalViewer } from './citation-store.ts'
import { pickDocPresentation, type DocPresentation } from './original-doc-presentation.ts'
import { PdfJsFrame } from './pdfjs-frame.tsx'
import css from './GenuiBlock.module.css'

/** 预检缓存上界（URL → 分派结果；超界淘汰最早一条）。 */
const PROBE_CACHE_MAX = 64
const probeCache = new Map<string, DocPresentation>()

/** The overlay: one document at a time, Esc / backdrop / × closes. */
export function OriginalViewer(): ReactNode {
  const [citation, setCitation] = useState<GenuiCitationLike | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [presentation, setPresentation] = useState<DocPresentation | null>(null)
  const close = useCallback(() => setCitation(null), [])

  // 所有权安全注册：多个卡片各挂一个 viewer 时，卸载只清自己的注册。
  useEffect(() => registerOriginalViewer(setCitation), [])

  useEffect(() => {
    if (citation === null) return
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [citation, close])

  /** Preflight: HEAD（代理 P1 已实现真 HEAD——只回元信息不拉 body）取 status +
   * content-type。结果按 URL 缓存（同引用反复打开不重复预检；有界防增长）。 */
  const probe = useCallback(async (url: string): Promise<DocPresentation | { probeFailed: true }> => {
    const cached = probeCache.get(url)
    if (cached !== undefined) return cached
    try {
      const res = await fetch(url, { method: 'HEAD' })
      const picked = pickDocPresentation(res.status, res.headers.get('content-type'))
      if (picked.kind === 'error') {
        // HEAD 无 body——错误正文用一次 GET 补齐（小响应），面板里给得出原因。
        try {
          const text = (await fetch(url).then(r => r.text())).trim()
          if (text.length > 0) return cacheAndReturn(url, { kind: 'error', status: picked.status, body: text.slice(0, 300) })
        } catch { /* 不可读 */ }
        return cacheAndReturn(url, { kind: 'error', status: picked.status })
      }
      return cacheAndReturn(url, picked)
    } catch {
      return { probeFailed: true }
    }
  }, [])

  /** 信号中止后 res.text() 会 reject——错误正文走独立的不带信号 GET。 */
  function cacheAndReturn(url: string, value: DocPresentation): DocPresentation {
    if (probeCache.size >= PROBE_CACHE_MAX) {
      const first = probeCache.keys().next().value
      if (first !== undefined) probeCache.delete(first)
    }
    probeCache.set(url, value)
    return value
  }

  // 每次打开新文档：重置并预检。
  useEffect(() => {
    setPresentation(null)
    setErrorText(null)
    if (citation === null) return
    const url = proxyUrlFor(citation)
    if (url === null) return
    let cancelled = false
    void probe(url).then(result => {
      if (cancelled) return
      if ('probeFailed' in result) {
        // 预检失败（未来跨源 CORS 等）→ 回退历史行为：无 sandbox iframe +
        // contentDocument 错误检测，新标签/下载始终可用。
        setPresentation({ kind: 'iframe', sandboxScripts: false })
        return
      }
      if (result.kind === 'error' && 'body' in result && result.body) setErrorText(result.body)
      setPresentation(result)
    })
    return () => { cancelled = true }
  }, [citation, probe])

  if (citation === null) return null
  const url = proxyUrlFor(citation)
  if (url === null) return null

  // Positions carry (page,x0,x1,top,bottom); the page is what a viewer can
  // jump to. PDF.js gets the page directly; the iframe path uses #page.
  const pages = [...new Set((citation.positions ?? []).map(tuple => tuple[0]).filter((page): page is number => page !== undefined && page >= 1))]
  const firstPage = pages[0] ?? citation.page
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
          <button
            type="button"
            className={css.originalViewerDownload}
            onClick={() => { window.open(url, '_blank', 'noopener,noreferrer') }}
          >
            新标签
          </button>
          <a className={css.originalViewerDownload} href={url} download={citation.doc}>下载</a>
          <button type="button" className={css.originalViewerClose} onClick={close} aria-label="关闭">×</button>
        </div>
        {errorText !== null
          ? (
              <div className={css.originalViewerNote} data-kind="error">
                {'原文不可得：' + errorText + '\n（该条引用携带的文档句柄未命中知识库；可换一条引用重试，或用上方「下载」确认代理返回）'}
              </div>
            )
          : presentation === null
            ? <div className={css.originalViewerNote}>正在加载原文…</div>
            : presentation.kind === 'pdfjs'
              ? (
                  <PdfJsFrame
                    url={url}
                    {...(firstPage !== undefined ? { initialPage: firstPage } : {})}
                    onFallback={() => setErrorText('PDF.js 渲染失败')}
                  />
                )
              : presentation.kind === 'error'
                ? (
                    <div className={css.originalViewerNote} data-kind="error">
                      {'原文不可得（HTTP ' + String(presentation.status) + '）' + (errorText !== null ? '：' + errorText : '') + '\n（可换一条引用重试，或用「新标签 / 下载」确认代理返回）'}
                    </div>
                  )
                : <FramePresentation url={pages.length > 0 ? `${url}#page=${pages[0]}` : url} sandboxScripts={presentation.sandboxScripts} />}
      </div>
    </div>
  )
}

/** The non-PDF iframe arm: same-origin content, optional script sandbox, and
 * the empty-plugin-document detection (内嵌 Chromium 缺 PDF 插件的历史兜底). */
function FramePresentation({ url, sandboxScripts }: { url: string; sandboxScripts: boolean }): ReactNode {
  const [note, setNote] = useState<string | null>('正在加载原文…')
  const onLoad = (frameEl: HTMLIFrameElement): void => {
    try {
      const doc = frameEl.contentDocument
      if (doc !== null && doc.body !== null && doc.body.children.length === 0 && doc.querySelectorAll('embed').length === 0) {
        const text = doc.body.textContent?.trim() ?? ''
        if (text.length > 0) {
          setNote('原文不可得：' + text.slice(0, 300) + '\n（可换一条引用重试，或用「新标签 / 下载」确认代理返回）')
          return
        }
        setNote('当前浏览器不支持内嵌该文档的预览。\n请点上方「新标签」在新页面查看，或用「下载」保存后打开。')
        return
      }
    } catch { /* 同源代理理论可达；按成功处理 */ }
    setNote(null)
  }
  return (
    <>
      {note !== null && <div className={css.originalViewerNote} {...(/原文不可得/.test(note) ? { 'data-kind': 'error' } : {})}>{note}</div>}
      <iframe
        className={css.originalViewerFrame}
        src={url}
        title="原文"
        {...(sandboxScripts ? { sandbox: 'allow-scripts' } : {})}
        onLoad={event => onLoad(event.currentTarget)}
      />
    </>
  )
}

/** The citation shape the viewer consumes (GenuiCitation minus type-only bits). */
interface GenuiCitationLike {
  doc: string
  page?: number
  documentId?: string
  chunkId?: string
  positions?: number[][]
}
