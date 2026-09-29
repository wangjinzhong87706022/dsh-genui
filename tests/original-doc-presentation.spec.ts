/**
 * Original-document presentation dispatch 单测：Content-Type/状态 → 渲染方式
 * 分派表（spec: askdata docs/original-doc-viewer-spec.md §2）。
 * @module
 */
import { describe, expect, it } from 'vitest'
import { pickDocPresentation } from '../src/client/original-doc-presentation.ts'

describe('pickDocPresentation', () => {
  it('PDF → pdfjs 自渲染（无插件/无 iframe 语义纠缠）', () => {
    expect(pickDocPresentation(200, 'application/pdf')).toEqual({ kind: 'pdfjs' })
  })

  it('HTML → iframe + allow-scripts（可信文档跑脚本，opaque origin 隔离宿主）', () => {
    expect(pickDocPresentation(200, 'text/html; charset=utf-8')).toEqual({ kind: 'iframe', sandboxScripts: true })
  })

  it('图片/纯文本/未知类型 → 无 sandbox iframe（同源自有内容历史行为）', () => {
    expect(pickDocPresentation(200, 'image/png')).toEqual({ kind: 'iframe', sandboxScripts: false })
    expect(pickDocPresentation(200, 'text/plain')).toEqual({ kind: 'iframe', sandboxScripts: false })
    expect(pickDocPresentation(200, null)).toEqual({ kind: 'iframe', sandboxScripts: false })
    expect(pickDocPresentation(200, 'application/octet-stream')).toEqual({ kind: 'iframe', sandboxScripts: false })
  })

  it('非 2xx → 错误面板（带状态码）', () => {
    expect(pickDocPresentation(404, 'text/plain')).toEqual({ kind: 'error', status: 404 })
    expect(pickDocPresentation(502, 'text/html')).toEqual({ kind: 'error', status: 502 })
  })

  it('大小写不敏感（服务端可能回大写 MIME）', () => {
    expect(pickDocPresentation(200, 'Application/PDF')).toEqual({ kind: 'pdfjs' })
  })
})
