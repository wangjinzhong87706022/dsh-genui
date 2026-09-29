/**
 * PDF.js asset-bundle entry: the engine for the original-document viewer's
 * inline PDF rendering. Registers on `window.__GenuiAssets__.pdfjs`. Built as
 * a standalone IIFE into `lib/assets/pdfjs.js` and served by the plugin's
 * node-half route; loaded on demand by the viewer (original-viewer.tsx →
 * pdfjs-frame.tsx). The worker bundle (`asset-pdfjs-worker.ts` →
 * `lib/assets/pdfjs-worker.js`) is NOT script-injected — the viewer points
 * `GlobalWorkerOptions.workerSrc` at its served URL.
 *
 * CJK 标准规程 PDF 依赖打包 cmaps（scripts/copy-cmaps.mjs →
 * `lib/assets/cmaps/*.bcmap`，节点路由按 octet-stream 提供）——缺失表现为
 * 中文乱码。spec: askdata `docs/original-doc-viewer-spec.md` §2/§5。
 * @module @changfenhuang/dsh-genui/client/asset-pdfjs
 */
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/build/pdf.mjs'

/** The engine surface the viewer consumes (minimal, typed locally). */
export interface PdfJsAssetApi {
  getDocument: (src: {
    url: string
    cMapUrl?: string
    cMapPacked?: boolean
    disableStream?: boolean | undefined
    disableAutoFetch?: boolean | undefined
  }) => {
    destroy: () => Promise<void>
    promise: Promise<{
      numPages: number
      getPage: (pageNumber: number) => Promise<{
        getViewport: (o: { scale: number }) => { width: number; height: number }
        render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown; transform?: number[] | undefined }) => { promise: Promise<void> }
      }>
      destroy: () => Promise<void>
    }>
  }
  GlobalWorkerOptions: { workerSrc: string }
}

const win = globalThis as unknown as { __GenuiAssets__?: Record<string, unknown> }
const assets = win.__GenuiAssets__ ?? (win.__GenuiAssets__ = {})
assets.pdfjs = { getDocument, GlobalWorkerOptions }
