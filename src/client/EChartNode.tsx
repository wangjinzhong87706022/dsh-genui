/**
 * ECharts node: renders a full ECharts chart from a declarative option
 * object. The echarts engine is lazy-loaded (lib/assets/echarts.js) only when
 * an `echart` node appears — the main client bundle never carries the engine.
 *
 * The `option` field accepts a standard ECharts `EChartsCoreOption`. For
 * simple use cases the `preset` + `data` shorthand builds the option
 * automatically: `preset: 'bar' | 'line' | 'pie' | 'scatter' | 'area'` maps
 * to a themed option template that reads the same `data`/`series` shape as
 * the `chart` node, so a model can upgrade a `chart` to ECharts by changing
 * `type` to `echart` and adding `preset`.
 * @module @changfenhuang/dsh-genui/client/EChartNode
 */
import { renderInline } from './inline.ts'
import { useEffect, useRef, useState } from 'react'
import css from './GenuiBlock.module.css'
import { CORE_PRESETS, createChart as lazyCreateChart, type EChartsInstance } from './echarts-lazy.ts'
import { CHART_COLORS } from './blocks/charts.tsx'
import { GENUI_LIMITS } from './genui-runtime/limits.ts'
import { useGenuiAction } from './action-context.ts'
import { diagBump } from './diagnostics.ts'
import type { GenuiEChart } from './spec.ts'

/** Which engine bundle this node needs (progressive disclosure). */
function neededEngine(node: GenuiEChart): 'core' | 'full' {
  if (node.option !== undefined || node.tree !== undefined) return 'full'
  return CORE_PRESETS.has(node.preset ?? 'bar') ? 'core' : 'full'
}

/**
 * Categorical fallback palette. The host defines its `--dsw-static-*` tokens on
 * `body`, not on `:root`, and ECharts renders to CANVAS (so a `var(--x)` string
 * is meaningless to it — every colour must be resolved to a literal first).
 * Reading only `document.documentElement` therefore returned '' for every
 * series colour and collapsed multi-series charts to one accent hue; these
 * fixed hues keep series distinguishable on any host.
 */
export const SERIES_FALLBACK = [
  '#679efe', '#4ed17e', '#f5b83d', '#f2707a', '#8b7ff0', '#3fc7d4', '#b7c8fe', '#9aa3b2',
] as const

/**
 * Read a host theme token, resolved from the ELEMENT first (custom properties
 * inherit, so any node inside `body` sees the host sheet) and falling back to
 * body/root for detached renders.
 */
function readToken(name: string, fallback: string, el?: HTMLElement | null): string {
  const hosts: Array<Element | null> = [el ?? null, typeof document === 'undefined' ? null : document.body, typeof document === 'undefined' ? null : document.documentElement]
  for (const host of hosts) {
    if (host === null) continue
    const value = getComputedStyle(host).getPropertyValue(name).trim()
    if (value !== '') return value
  }
  return fallback
}

/** Resolve the host accent and label colors for ECharts theming. */
function themeColors(el?: HTMLElement | null): {
  accent: string
  labelPrimary: string
  labelSecondary: string
  labelTertiary: string
  border: string
  bgLayer1: string
} {
  return {
    accent: readToken('--dsw-alias-state-business-primary', '#4f8ef7', el),
    labelPrimary: readToken('--dsw-alias-label-primary', '#e6e6e6', el),
    labelSecondary: readToken('--dsw-alias-label-secondary', '#a0a0a0', el),
    labelTertiary: readToken('--dsw-alias-label-tertiary', '#6b6b6b', el),
    border: readToken('--dsw-alias-border-l1', 'rgba(255,255,255,0.12)', el),
    bgLayer1: readToken('--dsw-alias-bg-layer-1', '#1a1a1e', el),
  }
}

/** Build a full ECharts option from a preset + the simple data/series shape.
 *  `el` is the chart's own container: theme tokens are resolved against it so
 *  host colours are found wherever the host defines them. */
/**
 * Styled tree option shared by the `tree` preset and drill-patch subtrees —
 * same palette/roam/emphasis/toolbox so a drill answer looks like its parent
 * chart. `renderMode: 'richText'` keeps model-written node names out of the
 * HTML parser (the same invariant every other preset's tooltip upholds).
 *
 * `expandAndCollapse: false` is load-bearing for drill charts, not cosmetic.
 * With it on, ECharts toggles the subtree on EVERY single click and re-renders
 * — which both steals the click from a `dblclick` binding (the second click
 * lands on the re-laid-out node, so no dblclick sequence is ever recognised)
 * and makes the optimistic placeholder fight the native collapse. A tree
 * already renders fully expanded via `initialTreeDepth: -1`, so collapsing
 * costs the reader nothing.
 */
function treeOption(data: unknown[], el?: HTMLElement | null, rightPad = 200): Record<string, unknown> {
  const t = themeColors(el)
  return {
    tooltip: { renderMode: 'richText', backgroundColor: t.bgLayer1, borderColor: t.border, textStyle: { color: t.labelPrimary }, trigger: 'item', triggerOn: 'mousemove' },
    backgroundColor: 'transparent',
    toolbox: { show: true, feature: { saveAsImage: {} }, right: 10, top: 2 },
    series: [{
      type: 'tree', data, roam: true, initialTreeDepth: -1, orient: 'LR',
      expandAndCollapse: false,
      left: 16, right: rightPad, top: 10, bottom: 10, symbol: 'circle', symbolSize: 12,
      itemStyle: { color: '#5b8ff9', borderColor: '#5b8ff9', borderWidth: 2 },
      lineStyle: { color: '#b8c6dd', width: 1.5, curveness: 0.45 },
      label: { position: 'left', fontSize: 13, color: '#47607c', distance: 6 },
      leaves: { symbolSize: 9, itemStyle: { color: '#5ad8a6' }, label: { position: 'right', fontSize: 13, color: '#2e7d5b' } },
      emphasis: { focus: 'descendant', lineStyle: { width: 2.5 }, itemStyle: { color: '#f6bd16', borderColor: '#f6bd16' } },
      animationDuration: 400,
    }],
  }
}

function presetOption(node: GenuiEChart, el?: HTMLElement | null): Record<string, unknown> {
  const t = themeColors(el)
  // Each palette slot carries its own fallback hue: if the host lacks the
  // static tokens, series must still be distinguishable (the old code fell
  // back to the accent for every slot, so every chart came out one colour).
  const colors = node.palette !== undefined && node.palette.length > 0
    ? [...node.palette]
    : CHART_COLORS.map((c, i) =>
      readToken(c.replace('var(', '').replace(')', ''), SERIES_FALLBACK[i % SERIES_FALLBACK.length]!, el))
  const data = node.data ?? []
  const series = node.series

  // Shared tooltip base: renderMode 'richText' prevents ECharts from writing
  // tooltip content via innerHTML — labels/formatters are model output and
  // must never reach the HTML parser.
  const tt = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    renderMode: 'richText',
    backgroundColor: t.bgLayer1,
    borderColor: t.border,
    textStyle: { color: t.labelPrimary },
    ...extra,
  })

  const base = {
    color: colors,
    textStyle: { color: t.labelSecondary, fontFamily: 'inherit' },
    backgroundColor: 'transparent',
    grid: { left: 48, right: 16, top: 24, bottom: 32 },
    tooltip: tt({ trigger: 'item' }),
  }

  switch (node.preset) {
    case 'wordCloud': {
      return {
        ...base,
        series: [{
          type: 'wordCloud',
          sizeRange: [16, 64],
          rotationRange: [0, 0],
          gridSize: 8,
          textStyle: { fontFamily: 'sans-serif' },
          data: data.map((d, i) => ({ name: d.label, value: d.value, textStyle: { color: colors[i % colors.length] } })),
        }],
      }
    }
    case 'pie': {
      return {
        ...base,
        tooltip: tt({ trigger: 'item', formatter: '{b}: {c} ({d}%)' }),
        legend: { bottom: 0, textStyle: { color: t.labelTertiary } },
        series: [{
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 6, borderColor: t.bgLayer1, borderWidth: 2 },
          label: { color: t.labelSecondary },
          data: data.map(d => ({ name: d.label, value: d.value })),
        }],
      }
    }
    case 'scatter': {
      // xAxis is 'category' so string labels (e.g. 「一月」) render correctly;
      // the previous `type: 'value'` xAxis could not plot non-numeric labels.
      return {
        ...base,
        tooltip: tt({ trigger: 'item' }),
        xAxis: { type: 'category', data: data.map(d => d.label), axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        yAxis: { type: 'value', axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series: [{
          type: 'scatter',
          symbolSize: 10,
          data: data.map(d => d.value),
        }],
      }
    }
    case 'area': {
      return {
        ...base,
        tooltip: tt({ trigger: 'axis' }),
        xAxis: { type: 'category', data: data.map(d => d.label), axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary } },
        yAxis: { type: 'value', axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series: (series ?? [{ label: '', data }]).map((s, i) => ({
          name: s.label,
          type: 'line',
          smooth: true,
          areaStyle: { opacity: 0.15 },
          data: s.data.map(d => d.value),
          ...optItemStyleColor(s.color, i, series),
        })),
        legend: series !== undefined ? { bottom: 0, textStyle: { color: t.labelTertiary } } : undefined,
      }
    }
    case 'line': {
      return {
        ...base,
        tooltip: tt({ trigger: 'axis' }),
        xAxis: { type: 'category', data: data.map(d => d.label), axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary } },
        yAxis: { type: 'value', axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series: (series ?? [{ label: '', data }]).map((s, i) => ({
          name: s.label,
          type: 'line',
          smooth: true,
          showSymbol: true,
          symbolSize: 6,
          data: s.data.map(d => d.value),
          ...optItemStyleColor(s.color, i, series),
        })),
        legend: series !== undefined ? { bottom: 0, textStyle: { color: t.labelTertiary } } : undefined,
      }
    }
    case 'radar': {
      // Indicators come from the first series' labels; each series is one
      // polygon. `data` alone is treated as a single unnamed series.
      const entries = series ?? [{ label: '', data }]
      const indicators = (entries[0]?.data ?? []).map(d => ({ name: d.label, max: undefined as number | undefined }))
      const max = Math.max(...entries.flatMap(e => e.data.map(d => Number(d.value) || 0)), 1)
      return {
        ...base,
        tooltip: tt({ trigger: 'item' }),
        legend: { bottom: 0, textStyle: { color: t.labelTertiary } },
        radar: {
          indicator: indicators.map(i => ({ name: i.name, max: Math.ceil(max * 1.1) })),
          splitLine: { lineStyle: { color: t.border } },
          splitArea: { show: false },
          axisLine: { lineStyle: { color: t.border } },
          axisName: { color: t.labelTertiary },
        },
        series: [{
          type: 'radar',
          symbolSize: 5,
          areaStyle: { opacity: 0.12 },
          data: entries.map((e, i) => ({
            name: e.label,
            value: e.data.map(d => Number(d.value) || 0),
            ...optItemStyleColor(e.color, i, series),
          })),
        }],
      }
    }
    case 'gauge': {
      // One gauge per datum (usually a single KPI).
      return {
        ...base,
        tooltip: tt({ trigger: 'item' }),
        series: data.slice(0, 4).map((d, i) => ({
          type: 'gauge',
          startAngle: 210,
          endAngle: -30,
          min: 0,
          max: Math.max(Number(d.value) || 0, 100),
          center: data.length > 1 ? [`${(i + 0.5) * (100 / Math.min(data.length, 4))}%`, '58%'] : ['50%', '58%'],
          radius: data.length > 1 ? '62%' : '82%',
          progress: { show: true, width: 12 },
          axisLine: { lineStyle: { width: 12, color: [[1, t.border]] } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          pointer: { show: false },
          title: { offsetCenter: [0, '32%'], color: t.labelTertiary, fontSize: 12 },
          detail: { valueAnimation: true, fontSize: 26, offsetCenter: [0, '2%'], formatter: '{value}', color: t.labelPrimary },
          data: [{ value: Number(d.value) || 0, name: d.label }],
        })),
      }
    }
    case 'funnel': {
      return {
        ...base,
        tooltip: tt({ trigger: 'item', formatter: '{b}: {c}' }),
        legend: { bottom: 0, textStyle: { color: t.labelTertiary } },
        series: [{
          type: 'funnel',
          left: '8%',
          width: '84%',
          top: 16,
          bottom: 40,
          gap: 2,
          label: { position: 'inside', color: '#fff', formatter: '{b} {c}' },
          itemStyle: { borderWidth: 0 },
          data: data.map(d => ({ name: d.label, value: Number(d.value) || 0 })),
        }],
      }
    }
    case 'treemap': {
      return {
        ...base,
        tooltip: tt({ trigger: 'item', formatter: '{b}: {c}' }),
        series: [{
          type: 'treemap',
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          upperLabel: { show: false },
          label: { color: t.labelPrimary },
          itemStyle: { borderColor: t.bgLayer1, borderWidth: 2, gapWidth: 2 },
          data: data.map(d => ({ name: d.label, value: Number(d.value) || 0 })),
        }],
      }
    }
    case 'sankey': {
      const links = node.links ?? []
      const names = data.length > 0
        ? data.map(d => d.label)
        : [...new Set(links.flatMap(l => [l.from, l.to]))]
      return {
        ...base,
        tooltip: tt({ trigger: 'item' }),
        series: [{
          type: 'sankey',
          left: 8,
          right: 8,
          top: 12,
          bottom: 12,
          nodeGap: 12,
          lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.32 },
          label: { color: t.labelSecondary },
          emphasis: { focus: 'adjacency' },
          data: names.map(name => ({ name })),
          links: links.map(l => ({ source: l.from, target: l.to, value: l.value ?? 1 })),
        }],
      }
    }
    case 'graph': {
      const links = node.links ?? []
      const names = data.length > 0
        ? data.map(d => d.label)
        : [...new Set(links.flatMap(l => [l.from, l.to]))]
      // Node size follows its degree, so hubs read as hubs without extra data.
      const degree = new Map<string, number>()
      for (const l of links) {
        degree.set(l.from, (degree.get(l.from) ?? 0) + 1)
        degree.set(l.to, (degree.get(l.to) ?? 0) + 1)
      }
      // A relation is an EDGE, not a node: `links[].label` (the relation name)
      // renders on the edge, and the arrowhead carries direction. Line colour
      // is a FIXED tone, not the theme border token — the border token resolves
      // to a near-invisible wash on light hosts (the "nodes but no edges"
      // screenshot); the tree preset's tone reads on both themes.
      // Arrows/labels opt in only when at least one edge carries a label —
      // undirected topology charts must not grow arrowheads.
      const edgeLabels = links.some(l => l.label !== undefined)
      const line = { color: '#b8c6dd', width: 1.5, curveness: 0.12 }
      const edgeDecor: Record<string, unknown> = edgeLabels ? {
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: 9,
        edgeLabel: {
          show: true, color: t.labelSecondary, fontSize: 10,
          backgroundColor: 'rgba(255,255,255,0.75)', padding: [1, 3], borderRadius: 2,
          formatter: (p: { data?: { label?: string } }) => p.data?.label ?? '',
        },
      } : {}
      const nodeData = names.map(name => ({ name, symbolSize: 16 + (degree.get(name) ?? 0) * 5 }))

      // Hierarchy layout: root (first data item) on the left, BFS layers into
      // columns — the tree-like reading order relation charts need. All edges
      // survive (a tree series could not draw the back-edges).
      //
      // `drill` charts DEFAULT to hierarchy even when the fence omits
      // `graphLayout`: old sessions store fences generated before the field
      // existed, and re-rendering them must not regress the relation graph to
      // a force blob (user-reported). drill is ours — hierarchy is its design.
      const graphLayout = node.graphLayout ?? (node.drill !== undefined ? 'hierarchy' : undefined)
      if (graphLayout === 'hierarchy' && names.length > 1 && links.length > 0) {
        const adjacency = new Map<string, string[]>()
        for (const l of links) {
          if (!adjacency.has(l.from)) adjacency.set(l.from, [])
          adjacency.get(l.from)!.push(l.to)
        }
        const depth = new Map<string, number>()
        const root = names[0]!
        depth.set(root, 0)
        const queue = [root]
        while (queue.length > 0) {
          const cur = queue.shift()!
          for (const nxt of adjacency.get(cur) ?? []) {
            if (!depth.has(nxt)) {
              depth.set(nxt, depth.get(cur)! + 1)
              queue.push(nxt)
            }
          }
        }
        // Unreached nodes (no path from root) trail as the last column.
        const maxDepth = Math.max(0, ...depth.values())
        for (const n of names) {
          if (!depth.has(n)) depth.set(n, maxDepth + 1)
        }
        const columns = new Map<number, string[]>()
        for (const n of names) {
          const d = depth.get(n)!
          if (!columns.has(d)) columns.set(d, [])
          columns.get(d)!.push(n)
        }
        const height = node.height ?? 300
        const positioned = names.map((name) => {
          const d = depth.get(name)!
          const col = columns.get(d)!
          // Spread each column vertically; the 1-index keeps nodes off the border.
          const y = ((col.indexOf(name) + 1) / (col.length + 1)) * (height - 40) + 20
          return {
            name,
            x: 70 + d * 300,
            y,
            symbolSize: name === root ? Math.max(20, 16 + (degree.get(name) ?? 0) * 5) : 16 + (degree.get(name) ?? 0) * 5,
            // 根的出边全在右侧扇开，标签放下方才压不着线
            label: name === root ? { position: 'bottom' } : undefined,
          }
        })
        return {
          ...base,
          tooltip: tt({ trigger: 'item' }),
          series: [{
            type: 'graph',
            layout: 'none',
            roam: true,
            label: { show: true, position: 'right', color: t.labelSecondary, fontSize: 11 },
            lineStyle: line,
            ...edgeDecor,
            emphasis: { focus: 'adjacency' },
            data: positioned,
            links: links.map(l => ({
              source: l.from,
              target: l.to,
              ...(l.value !== undefined ? { value: l.value } : {}),
              ...(l.label !== undefined ? { label: l.label } : {}),
            })),
          }],
        }
      }

      return {
        ...base,
        tooltip: tt({ trigger: 'item' }),
        series: [{
          type: 'graph',
          layout: 'force',
          roam: true,
          label: { show: true, color: t.labelSecondary, fontSize: 11 },
          force: { repulsion: 200, edgeLength: 80 },
          lineStyle: line,
          ...edgeDecor,
          emphasis: { focus: 'adjacency' },
          data: nodeData,
          links: links.map(l => ({
            source: l.from,
            target: l.to,
            ...(l.value !== undefined ? { value: l.value } : {}),
            ...(l.label !== undefined ? { label: l.label } : {}),
          })),
        }],
      }
    }
    case 'heatmap': {
      // Rows come from `series` (one row per entry), columns from the first
      // row's labels — the same shape the other presets use.
      const rows = series ?? [{ label: '', data }]
      const cols = (rows[0]?.data ?? []).map(d => d.label)
      const values = rows.flatMap((row, y) => row.data.map((d, x) => [x, y, Number(d.value) || 0]))
      const max = Math.max(...values.map(v => v[2] as number), 1)
      return {
        ...base,
        tooltip: tt({ trigger: 'item', position: 'top' }),
        grid: { left: 64, right: 16, top: 16, bottom: 48 },
        xAxis: { type: 'category', data: cols, splitArea: { show: false }, axisLabel: { color: t.labelTertiary }, axisLine: { lineStyle: { color: t.border } } },
        yAxis: { type: 'category', data: rows.map(r => r.label), splitArea: { show: false }, axisLabel: { color: t.labelTertiary }, axisLine: { lineStyle: { color: t.border } } },
        visualMap: { min: 0, max, calculable: true, orient: 'horizontal', left: 'center', bottom: 0, textStyle: { color: t.labelTertiary } },
        series: [{ type: 'heatmap', data: values, label: { show: values.length <= 60, color: t.labelPrimary }, itemStyle: { borderColor: t.bgLayer1, borderWidth: 2 } }],
      }
    }
    case 'bigline': {
      // Long series: symbols off, area wash, inside + slider zoom.
      return {
        ...base,
        tooltip: tt({ trigger: 'axis' }),
        grid: { left: 48, right: 20, top: 24, bottom: 56 },
        dataZoom: [
          { type: 'inside', start: 0, end: 45 },
          { type: 'slider', height: 16, bottom: 8, borderColor: t.border, textStyle: { color: t.labelTertiary } },
        ],
        xAxis: { type: 'category', boundaryGap: false, data: data.map(d => d.label), axisLabel: { color: t.labelTertiary }, axisLine: { lineStyle: { color: t.border } } },
        yAxis: { type: 'value', axisLabel: { color: t.labelTertiary }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series: (series ?? [{ label: '', data }]).map((s2, i) => ({
          name: s2.label,
          type: 'line',
          smooth: true,
          showSymbol: false,
          areaStyle: { opacity: 0.12 },
          data: s2.data.map(d => d.value),
          ...optItemStyleColor(s2.color, i, series),
        })),
        legend: series !== undefined ? { bottom: 26, textStyle: { color: t.labelTertiary } } : undefined,
      }
    }
    case 'tree':
      // Styled tree from nested `tree.data` — the model writes CONTENT only;
      // palette/roam/emphasis/toolbox live here so long-template transcription
      // (the JSON-corruption source) never reaches the model.
      return treeOption(node.tree?.data ?? [], el, 200)
    default: {
      // 'bar' or unspecified
      return {
        ...base,
        tooltip: tt({ trigger: 'axis', axisPointer: { type: 'shadow' } }),
        xAxis: { type: 'category', data: data.map(d => d.label), axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary } },
        yAxis: { type: 'value', axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series: (series ?? [{ label: '', data }]).map(s => ({
          name: s.label,
          type: 'bar',
          barMaxWidth: 40,
          itemStyle: { borderRadius: [4, 4, 2, 2], ...(s.color !== undefined ? { color: s.color } : {}) },
          data: s.data.map(d => d.value),
        })),
        legend: series !== undefined ? { bottom: 0, textStyle: { color: t.labelTertiary } } : undefined,
      }
    }
  }
}

/** Per-series itemStyle.color override when the preset series declares one
 * (aligns with the `chart` node which respects `series[].color`). */
function optItemStyleColor(color: string | undefined, _i: number, _series: unknown): Record<string, unknown> {
  return color !== undefined ? { itemStyle: { color } } : {}
}

/* ── Drill-down: registry, tree helpers, serial-queue machinery ─────────── */

interface DrillTreeNode { name?: unknown; children?: DrillTreeNode[]; [k: string]: unknown }


const DRILL_TIMEOUT_MS = GENUI_LIMITS.drillTimeoutMs
const DRILL_QUEUE_MAX = GENUI_LIMITS.drillQueueMax
/**
 * Placeholder sentinel. A private-use codepoint a model will never emit in a
 * node name — unlike an emoji prefix, which would make a real model starting
 * with that glyph both unclickable and silently dropped by the merge filter.
 */
const PLACEHOLDER_PREFIX = ''

function cloneTreeData(data: DrillTreeNode[]): DrillTreeNode[] {
  return structuredClone(data) as DrillTreeNode[]
}

function findTreeNode(data: DrillTreeNode[], name: string): DrillTreeNode | undefined {
  for (const node of data) {
    if (String(node.name ?? '') === name) return node
    const hit = node.children !== undefined ? findTreeNode(node.children, name) : undefined
    if (hit !== undefined) return hit
  }
  return undefined
}

export function EChartNode({ node }: { node: GenuiEChart }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const instanceRef = useRef<EChartsInstance | null>(null)
  // Click-to-action bridge (`actionTemplate`): read through a ref so the
  // mount-time click binding always relays through the latest handler.
  const onAction = useGenuiAction()
  const onActionRef = useRef(onAction)
  onActionRef.current = onAction

  // Drill state (only when node.drill is set): optimistic placeholder, single
  // flight with a visible cancelable serial queue, and patch merging.
  const [drillQueue, setDrillQueue] = useState<string[]>([])
  const queueRef = useRef<string[]>([])
  const inflightRef = useRef<string | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Patch-answer charts render their own (fallback) option; the update effect
  // must reuse it rather than re-derive one from a patch-only node.
  const isPatchRef = useRef(false)
  const patchOptionRef = useRef<Record<string, unknown> | null>(null)
  // Drill charts keep a MUTABLE tree copy so the optimistic placeholder can be
  // injected/removed locally (no registry, no patch replay — the answer comes
  // back as its own chart now).
  const treeDataRef = useRef<DrillTreeNode[] | null>(null)
  const baseOptionRef = useRef<Record<string, unknown> | null>(null)
  const applyTreeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let alive = true
    const el = ref.current
    if (el === null) return

    // Drill ANSWER (patch fence): render the NEW subtree IN PLACE, in this
    // message. Merging it back into the parent chart was tried and reverted —
    // the parent sits far up the transcript, so updates forced scrolling to
    // find it, and the tree grew unreadable after 2-3 drills. One answer, one
    // chart, at the point of the answer.
    if (node.drillPatch !== undefined) {
      diagBump('patchArrivals')
      isPatchRef.current = true
      const patchOption = treeOption(
        [{ name: node.drillPatch.target, children: node.drillPatch.children ?? [] }],
        el,
        160,
      )
      patchOptionRef.current = patchOption
      void lazyCreateChart(el, patchOption, { height: node.height ?? 300 }, 'full').then((inst) => {
        if (!alive) { inst.dispose(); return }
        instanceRef.current = inst
        setStatus('ready')
      }).catch(() => { if (alive) setStatus('error') })
      return () => { alive = false; instanceRef.current?.dispose(); instanceRef.current = null }
    }

    // Full `option` wins over preset shorthand.
    const option = node.option ?? presetOption(node, el)
    const drillKey = node.drill?.key

    void lazyCreateChart(el, option, { height: node.height ?? 300 }, neededEngine(node)).then((inst) => {
      if (!alive) {
        inst.dispose()
        return
      }
      instanceRef.current = inst
      diagBump('echartMounts')
      if (node.actionTemplate !== undefined) diagBump('actionTemplateMounts')

      // Mutable tree copy for the optimistic placeholder (raw `option` charts
      // read series[0].data; preset:'tree' reads node.tree.data).
      if (node.drill !== undefined) {
        const series0 = (node.option as { series?: Array<{ data?: unknown }> } | undefined)?.series?.[0]
        if (Array.isArray(series0?.data)) {
          treeDataRef.current = cloneTreeData(series0.data as DrillTreeNode[])
          baseOptionRef.current = structuredClone(node.option) as Record<string, unknown>
        } else if (node.tree !== undefined && Array.isArray(node.tree.data)) {
          treeDataRef.current = cloneTreeData(node.tree.data as DrillTreeNode[])
          baseOptionRef.current = presetOption(node, el) as Record<string, unknown>
        }
      }

      const applyTree = (): void => {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        if (instanceRef.current === null || baseOptionRef.current === null || treeDataRef.current === null) return
        const base = baseOptionRef.current
        const series = (base.series as Array<{ data?: unknown }>)[0]
        if (series !== undefined) series.data = treeDataRef.current
        instanceRef.current.setOption(base)
      }
      applyTreeRef.current = applyTree
      const dispatchDrill = (name: string): void => {
        inflightRef.current = name
        const data = treeDataRef.current
        const target = data === null ? undefined : findTreeNode(data, name)
        if (data !== null && target !== undefined) {
          target.children = target.children ?? []
          target.children.push({
            name: `${PLACEHOLDER_PREFIX} 查询中…`,
            itemStyle: { color: '#9aa3b2', borderColor: '#9aa3b2' },
            label: { color: '#9aa3b2' },
          })
          diagBump('placeholders')
          applyTree()
        }
        diagBump('actions')
        onActionRef.current?.(`下钻模型：${name}`, { type: 'echart-click', name })
        timeoutRef.current = setTimeout(() => {
          if (inflightRef.current !== name) return
          inflightRef.current = null
          const d = treeDataRef.current
          const t = d === null ? undefined : findTreeNode(d, name)
          if (t?.children !== undefined) {
            t.children = t.children.filter(c => !String(c.name ?? '').startsWith(PLACEHOLDER_PREFIX))
            applyTree()
          }
          const next = queueRef.current.shift()
          setDrillQueue([...queueRef.current])
          if (next !== undefined) dispatchDrill(next)
        }, DRILL_TIMEOUT_MS)
      }
      // Chart-click → [genui-action]: `{name}` in the template is replaced by
      // the hit node's name; empty names (canvas background) are ignored. Drill
      // charts get a default template — model adherence on a second copied
      // field is flaky, and drill alone is enough to opt in.
      //
      // Drill binds `click`, NOT `dblclick`: treeOption turns off ECharts'
      // expandAndCollapse, so a single click is free for the drill handler and
      // nothing re-renders between the two clicks of a double-click. Binding
      // dblclick while collapse was still on could never fire — the first click
      // re-laid-out the tree, so the second never closed a dblclick sequence.
      // `diagBump` counters trace the chain for E2E (opt-in, see
      // client/diagnostics.ts): bind → hit → action → queue → patch.
      const template = node.actionTemplate ?? (drillKey !== undefined ? '下钻模型：{name}' : undefined)
      if (template !== undefined && typeof inst.on === 'function') {
        diagBump('binds')
        inst.on('click', (params) => {
          const name = typeof params?.name === 'string' ? params.name : ''
          diagBump('clicks')
          if (name === '' || name.startsWith(PLACEHOLDER_PREFIX)) return
          if (drillKey === undefined) {
            // Plain action chart: one click = one action (previous behavior).
            diagBump('actions')
            onActionRef.current?.(template.replaceAll('{name}', name), { type: 'echart-click', name })
            return
          }
          // Drill mode: same-name dedupe, single-flight, visible serial queue.
          if (inflightRef.current === name || queueRef.current.includes(name)) {
            diagBump('dedup')
            return
          }
          if (inflightRef.current !== null) {
            if (queueRef.current.length >= DRILL_QUEUE_MAX) return
            queueRef.current.push(name)
            setDrillQueue([...queueRef.current])
            diagBump('queued')
            return
          }
          dispatchDrill(name)
        })
      }
      setStatus('ready')
    }).catch(() => {
      if (alive) setStatus('error')
    })

    return () => {
      alive = false
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
      instanceRef.current?.dispose()
      instanceRef.current = null
      treeDataRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Resize observer: keep the chart responsive.
  useEffect(() => {
    if (status !== 'ready') return
    const el = ref.current
    if (el === null) return
    const ro = new ResizeObserver(() => {
      instanceRef.current?.resize()
    })
    ro.observe(el)
    return () => { ro.disconnect() }
  }, [status])

  // Update option when the node changes (model re-render). `status` is in
  // deps so that when the engine finishes loading (status: 'loading' →
  // 'ready'), this effect re-runs and applies the LATEST option — without
  // it, a spec update that arrived during engine load would be lost forever
  // (the mount effect captured the old option, and this effect would have
  // returned early when status was 'loading' and never re-run).
  useEffect(() => {
    if (status !== 'ready' || instanceRef.current === null) return
    // Patch-answer chart: keep its own fallback option. Re-deriving from a
    // patch-only node hands `presetOption` no preset/data and blanks the chart
    // (notMerge replaces the whole series list).
    if (isPatchRef.current) {
      // Subtree charts stream in append-only: replace series[0].data wholesale
      // on every update so the final chunk carries the complete subtree.
      if (node.drillPatch !== undefined && patchOptionRef.current !== null) {
        const series = (patchOptionRef.current.series as Array<{ data?: unknown }>)[0]
        if (series !== undefined) {
          series.data = [{ name: node.drillPatch.target, children: node.drillPatch.children ?? [] }]
        }
        instanceRef.current.setOption(patchOptionRef.current)
      }
      return
    }
    const option = node.option ?? presetOption(node, ref.current)
    instanceRef.current.setOption(option, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, status])

  if (status === 'error') {
    return (
      <div className={css.echartFallback} data-genui-echart>
        <div className={css.echartErr}>ECharts 渲染失败</div>
        {node.title !== undefined && <div className={css.echartHint}>{renderInline(node.title)}</div>}
      </div>
    )
  }

  return (
    <div className={css.echartWrap} data-genui-echart>
      {node.title !== undefined && <div className={css.echartTitle}>{renderInline(node.title)}</div>}
      {drillQueue.length > 0 && (
        <div style={{ fontSize: 12, color: '#6b7280', padding: '2px 8px' }}>
          排队：
          {drillQueue.map(n => (
            <button
              key={n}
              type="button"
              title="点击取消"
              onClick={() => {
                queueRef.current = queueRef.current.filter(q => q !== n)
                setDrillQueue([...queueRef.current])
              }}
              style={{ margin: '0 4px', padding: '0 6px', cursor: 'pointer', fontSize: 12 }}
            >
              {n} ✕
            </button>
          ))}
        </div>
      )}
      {/* The affordance is invisible otherwise: node folding is off, so a click
          on a node does nothing visible until the drill answer streams back. */}
      {node.drill !== undefined && drillQueue.length === 0 && (
        <div className={css.echartHint} style={{ padding: '2px 8px' }}>💡 单击图中任意节点可下钻查看它的关系</div>
      )}
      <div
        ref={ref}
        className={css.echartCanvas}
        style={{ height: `${node.height ?? 300}px` }}
        role="img"
        aria-label={node.title ?? 'ECharts chart'}
      />
      {status === 'loading' && <div className={css.echartHint}>加载图表…</div>}
    </div>
  )
}
