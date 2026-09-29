/**
 * Original-document presentation dispatch: maps a preflight probe result
 * (HTTP status + Content-Type of the document proxy response) to the way the
 * viewer presents it. Pure and unit-tested — the viewer component only wires
 * the probe around it.
 *
 * 分派表（spec: askdata `docs/original-doc-viewer-spec.md` §2）：
 * - `application/pdf` → pdfjs 自渲染（canvas，无插件文档/sandbox 语义纠缠）
 * - `text/html`       → iframe + `sandbox="allow-scripts"`（可信文档跑脚本，
 *   opaque origin 隔离宿主）
 * - `image/*`、`text/*`、其它 → iframe 无 sandbox（同源自有内容，历史行为）
 * - 非 2xx            → 错误面板（错误正文由同源 contentDocument 或预检补充）
 * @module @changfenhuang/dsh-genui/client/original-doc-presentation
 */

/** How the viewer renders one proxied document. */
export type DocPresentation =
  | { kind: 'pdfjs' }
  | { kind: 'iframe'; sandboxScripts: boolean }
  | { kind: 'error'; status: number; body?: string }

/**
 * Dispatch on the preflight outcome. `contentType` may be null (server sent
 * no header); unknown types fall back to the plain iframe so exotic-but-
 * trusted payloads stay reachable via the 新标签/下载 buttons.
 */
export function pickDocPresentation(status: number, contentType: string | null): DocPresentation {
  if (status < 200 || status >= 300) return { kind: 'error', status }
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('application/pdf')) return { kind: 'pdfjs' }
  if (ct.includes('text/html')) return { kind: 'iframe', sandboxScripts: true }
  return { kind: 'iframe', sandboxScripts: false }
}
