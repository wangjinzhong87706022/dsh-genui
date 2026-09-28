/**
 * Drill-scope context: namespaces the chart drill registry by session.
 *
 * The registry (`EChartNode.tsx` `drillRegistry`) is a module-level Map; two
 * open sessions writing the same `drill.key` must never merge patches into
 * each other's charts, so the key is `${sessionId}::${key}`. The session id
 * is provided per render site (DOM fence / session panel), NOT through a
 * module-level global — a global would leak across concurrently-mounted
 * sessions and race with the async engine-load read path.
 *
 * Absent provider → `'dom'` (tests, pristine surfaces).
 * @module @changfenhuang/dsh-genui/client/drill-scope
 */
import { createContext, useContext } from 'react'

export const DrillScopeContext = createContext<string | undefined>(undefined)

/** Session namespace for the drill registry ('dom' when unknown). */
export function useDrillScope(): string {
  return useContext(DrillScopeContext) ?? 'dom'
}
