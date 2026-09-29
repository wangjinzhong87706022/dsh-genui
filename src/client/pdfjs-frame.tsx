/**
 * PdfJsFrame: renders one page of a proxied PDF via the pdf.js asset
 * (canvas — no plugin document, no iframe-sandbox entanglement, works in
 * PDF-plugin-less embedded Chromium). Initial page comes from the citation's
 * positions/page; prev/next walk. Any asset/document/render failure calls
 * `onFallback` — the viewer then shows its 新标签/下载 escape hatch.
 * @module @changfenhuang/dsh-genui/client/pdfjs-frame
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { assetDirUrl, assetUrl, loadGenuiAsset } from './asset-loader.ts'
import type { PdfJsAssetApi } from './asset-pdfjs.ts'
import css from './GenuiBlock.module.css'

/** The document/page surface the frame consumes (mirrors the asset's API). */
interface PdfDocLike {
  numPages: number
  getPage: (pageNumber: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number }
    render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown; transform?: number[] | undefined }) => { promise: Promise<void> }
  }>
  destroy: () => Promise<void>
}

/** 文档加载预算：worker/网络/解析任一环节挂死的降级闸门。 */
const DOCUMENT_TIMEOUT_MS = 30_000

// 切引用时页码不重置的隐患由预检兜住：presentation 置 null → 本组件卸载重挂，
// initialPage 随新挂载生效。若将来预检改为原地更新，这里需补 page 重置。
export function PdfJsFrame({ url, initialPage, onFallback }: {
  url: string
  /** 1-based cited page; clamped into [1, numPages]. */
  initialPage?: number
  onFallback: () => void
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const docRef = useRef<PdfDocLike | null>(null)
  const fallbackRef = useRef(onFallback)
  fallbackRef.current = onFallback
  const [page, setPage] = useState(() => Math.max(1, initialPage ?? 1))
  const [total, setTotal] = useState(0)
  const [ready, setReady] = useState(false)

  // 卸载即销毁 pdf.js 文档句柄——清理时现取 ref（异步加载完成后再卸载的
  // 路径也要销毁；挂载时捕获会销毁到 null）。
  useEffect(() => () => { void docRef.current?.destroy() }, [])

  const renderPage = useCallback(async (doc: PdfDocLike, pageNumber: number): Promise<void> => {
    const target = Math.min(Math.max(1, pageNumber), doc.numPages)
    const pageDoc = await doc.getPage(target)
    const canvas = canvasRef.current
    if (canvas === null) return
    const viewport = pageDoc.getViewport({ scale: 1.5 })
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width = '100%'
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    await pageDoc.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    }).promise
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const pdfjs = await loadGenuiAsset<PdfJsAssetApi>('pdfjs')
        pdfjs.GlobalWorkerOptions.workerSrc = assetUrl('pdfjs-worker.js')
        const task = pdfjs.getDocument({
          url,
          // CJK 规程 PDF 的非嵌入字体走 cmaps；目录形 URL（无 rev 查询）。
          cMapUrl: assetDirUrl('cmaps'),
          cMapPacked: true,
          // 关闭"整流直读/自动预取"回退：代理已支持 Range 切片（P1），
          // 强制按需取块——首渲不等全文、内存只留需要的对象（spec §5 观察 A）。
          disableStream: true,
          disableAutoFetch: true,
        })
        // 30s 预算：worker/网络/解析任一环节挂死即降级，不把查看器挂成永久加载；
        // 超时分支同时销毁 loadingTask（否则后台继续加载，泄漏 worker 与内存）。
        const doc = await Promise.race([
          task.promise,
          new Promise<never>((_, reject) => {
            window.setTimeout(() => {
              void task.destroy()
              reject(new Error('pdf.js document load timed out (30s)'))
            }, DOCUMENT_TIMEOUT_MS)
          }),
        ])
        if (cancelled) {
          void doc.destroy()
          return
        }
        docRef.current = doc
        setTotal(doc.numPages)
        await renderPage(doc, page)
        if (!cancelled) setReady(true)
      } catch {
        if (!cancelled) fallbackRef.current()
      }
    })()
    return () => { cancelled = true }
    // url 变化即整篇重载；翻页走 go() 不重载文档。
  }, [url])

  const go = (delta: number): void => {
    const doc = docRef.current
    if (doc === null) return
    const next = Math.min(Math.max(1, page + delta), doc.numPages)
    if (next === page) return
    setPage(next)
    setReady(false)
    void loadGenuiAsset<PdfJsAssetApi>('pdfjs').then(() => renderPage(doc, next)).then(
      () => { setReady(true) },
      () => { fallbackRef.current() },
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {!ready && <div className={css.originalViewerNote}>正在按页加载原文…</div>}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#f6f7f9' }}>
        <canvas ref={canvasRef} style={ready ? { display: 'block', margin: '0 auto' } : { display: 'none' }} />
      </div>
      {total > 0 && (
        <div className={css.originalViewerHead} style={{ justifyContent: 'center' }}>
          <button type="button" className={css.originalViewerDownload} disabled={page <= 1} onClick={() => go(-1)}>‹ 上一页</button>
          <span className={css.originalViewerPage}>第 {page} / {total} 页</span>
          <button type="button" className={css.originalViewerDownload} disabled={page >= total} onClick={() => go(1)}>下一页 ›</button>
        </div>
      )}
    </div>
  )
}
