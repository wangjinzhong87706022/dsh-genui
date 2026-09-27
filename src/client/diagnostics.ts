/**
 * Client diagnostics — opt-in counters for E2E chain diagnosis.
 *
 * These used to be bare `globalThis.__genuiX = …` writes sprinkled through
 * the render path, where the guard branch ran on every streaming chunk (a
 * property write plus a `Number()` coercion per frame, for a number nobody
 * reads in production). They now live behind one flag:
 *
 * - OFF by default: `diagBump` is a single boolean check, no writes.
 * - E2E turns it on before app code runs (`page.addInitScript`):
 *   `window.__GENUI_DIAG__ = true`, then reads `window.__genuiDiag`.
 *
 * The counters describe the chart-click → drill chain end to end:
 * binds → clicks → placeholders → actions → queued/dedup → merges.
 * @module @changfenhuang/dsh-genui/client/diagnostics
 */

/** Per-chart lifecycle. */
export type DiagKey =
  | 'binds' | 'clicks' | 'placeholders' | 'actions' | 'queued' | 'dedup' | 'merges'
  | 'patchArrivals' | 'echartMounts' | 'actionTemplateMounts'
  /** Guard-level: actionTemplate seen on input / passed through to the node. */
  | 'guardATIn' | 'guardATOut'

interface DiagHost {
  __GENUI_DIAG__?: boolean
  __genuiDiag?: Record<string, number>
}

const host = (): DiagHost => globalThis as unknown as DiagHost

/** Bump one counter. No-op unless diagnostics are enabled. */
export function diagBump(key: DiagKey): void {
  const h = host()
  if (h.__GENUI_DIAG__ !== true) return
  const bag = h.__genuiDiag ?? (h.__genuiDiag = {})
  bag[key] = (bag[key] ?? 0) + 1
}

/** Read one counter (0 when diagnostics were never enabled). */
export function diagRead(key: DiagKey): number {
  return host().__genuiDiag?.[key] ?? 0
}

/** Clear all counters (test hygiene). */
export function resetGenuiDiagnostics(): void {
  const h = host()
  if (h.__genuiDiag !== undefined) h.__genuiDiag = {}
}
