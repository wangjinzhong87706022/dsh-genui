/**
 * pdf.js 深路径导入的类型声明（pdfjs-dist v6 未为 `build/pdf.mjs` 深路径提供
 * node 解析可达的 types；查看器/资产入口只需要这一小片面）。
 */
declare module 'pdfjs-dist/build/pdf.mjs' {
  export const GlobalWorkerOptions: { workerSrc: string }
  export function getDocument(src: {
    url: string
    cMapUrl?: string
    cMapPacked?: boolean
    disableStream?: boolean | undefined
    disableAutoFetch?: boolean | undefined
  }): {
    destroy: () => Promise<void>
    promise: Promise<{
      numPages: number
      getPage: (pageNumber: number) => Promise<{
        getViewport: (o: { scale: number }) => { width: number; height: number }
        render: (o: {
          canvasContext: CanvasRenderingContext2D
          viewport: unknown
          transform?: number[] | undefined
        }) => { promise: Promise<void> }
      }>
      destroy: () => Promise<void>
    }>
  }
}
