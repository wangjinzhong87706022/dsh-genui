// @vitest-environment jsdom
// EChartNode rendering: preset five forms, error fallback, option priority,
// title/height, role=img/aria-label, scatter with CJK labels.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { GenuiEChart } from '../src/client/spec'
import { EChartNode, SERIES_FALLBACK } from '../src/client/EChartNode.tsx'
import { createChart } from '../src/client/echarts-lazy.ts'

vi.mock('../src/client/echarts-lazy.ts', async () => {
  // Keep the real preset→engine mapping so the mock stays honest about which
  // bundle a preset needs (progressive disclosure).
  const actual = await vi.importActual<typeof import('../src/client/echarts-lazy.ts')>('../src/client/echarts-lazy.ts')
  return { createChart: vi.fn(), CORE_PRESETS: actual.CORE_PRESETS }
})
beforeEach(() => {
  vi.mocked(createChart).mockReset()
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function fakeInstance() {
  return { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
}

/** Instance that records event bindings so a test can fire a chart click. */
function fakeInstanceWithEvents() {
  const handlers = new Map<string, (params: { name?: unknown }) => void>()
  return {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn((event: string, handler: (params: { name?: unknown }) => void) => {
      handlers.set(event, handler)
    }),
    fire: (event: string, params: { name?: unknown }) => handlers.get(event)?.(params),
    boundEvents: () => [...handlers.keys()],
  }
}

describe('EChartNode: series palette', () => {
  it('keeps eight distinct fallback hues (host tokens may be absent)', () => {
    // The regression: every slot fell back to the single accent colour, so a
    // multi-series chart came out entirely blue.
    expect(SERIES_FALLBACK.length).toBeGreaterThanOrEqual(6)
    expect(new Set(SERIES_FALLBACK).size).toBe(SERIES_FALLBACK.length)
  })
})

describe('EChartNode: word cloud', () => {
  it('cycles explicit palette colors per word', async () => {
    vi.mocked(createChart).mockResolvedValue(fakeInstance())
    render(<EChartNode node={{ type: 'echart', preset: 'wordCloud', palette: ['#123456', '#abcdef'], data: [
      { label: 'A', value: 3 }, { label: 'B', value: 2 }, { label: 'C', value: 1 },
    ] }} />)
    await vi.waitFor(() => {
      expect(createChart).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ series: [expect.objectContaining({ data: [
        { name: 'A', value: 3, textStyle: { color: '#123456' } },
        { name: 'B', value: 2, textStyle: { color: '#abcdef' } },
        { name: 'C', value: 1, textStyle: { color: '#123456' } },
      ] })] }), expect.anything(), 'full')
    })
  })

  it('builds weighted words and loads the full engine', async () => {
    vi.mocked(createChart).mockResolvedValue(fakeInstance())
    render(<EChartNode node={{ type: 'echart', preset: 'wordCloud', data: [{ label: '系统', value: 80 }, { label: '用户', value: 30 }] }} />)
    await vi.waitFor(() => {
      expect(createChart).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        series: [expect.objectContaining({ type: 'wordCloud', data: [expect.objectContaining({ name: '系统', value: 80 }), expect.objectContaining({ name: '用户', value: 30 })] })],
      }), expect.anything(), 'full')
    })
  })
})

describe('EChartNode: preset rendering', () => {
  it('renders data-genui-echart container for each preset', async () => {
    for (const preset of [
      'bar', 'line', 'area', 'pie', 'scatter',
      'radar', 'gauge', 'funnel', 'treemap', 'sankey', 'graph', 'heatmap', 'bigline',
    ] as const) {
      vi.mocked(createChart).mockImplementation(() => Promise.resolve(fakeInstance()))
      const node: GenuiEChart = { type: 'echart', preset, data: [{ label: 'a', value: 1 }] }
      const { container, unmount } = render(<EChartNode node={node} />)
      await vi.waitFor(() => {
        expect(container.querySelector('[data-genui-echart]')).not.toBeNull()
      })
      unmount()
    }
  })
})

describe('EChartNode: error fallback', () => {
  it('shows error fallback when engine load fails', async () => {
    vi.mocked(createChart).mockImplementation(() => Promise.reject(new Error('asset 404')))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.textContent).toContain('ECharts 渲染失败')
    }, { timeout: 3000 })
  })
})

describe('EChartNode: option vs preset', () => {
  it('option takes priority over preset', async () => {
    let capturedOption: unknown
    vi.mocked(createChart).mockImplementation((_el, option) => {
      capturedOption = option
      return Promise.resolve(fakeInstance())
    })
    const node: GenuiEChart = {
      type: 'echart',
      preset: 'bar',
      option: { title: { text: 'custom' } },
      data: [{ label: 'a', value: 1 }],
    }
    render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(capturedOption).toBeDefined()
    }, { timeout: 3000 })
    const opt = capturedOption as Record<string, unknown>
    expect(opt.title).toEqual({ text: 'custom' })
    expect(opt.xAxis).toBeUndefined()
  })
})

describe('EChartNode: title and height', () => {
  it('renders title when provided', async () => {
    vi.mocked(createChart).mockImplementation(() => Promise.resolve(fakeInstance()))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', title: '销售趋势', data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.querySelector('[data-genui-echart]')).not.toBeNull()
    })
    expect(container.textContent).toContain('销售趋势')
  })

  it('applies custom height to canvas', async () => {
    vi.mocked(createChart).mockImplementation(() => Promise.resolve(fakeInstance()))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', height: 500, data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.querySelector('[role="img"]')).not.toBeNull()
    })
    const canvas = container.querySelector('[role="img"]') as HTMLElement
    expect(canvas.style.height).toBe('500px')
  })

  it('defaults height to 300px', async () => {
    vi.mocked(createChart).mockImplementation(() => Promise.resolve(fakeInstance()))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.querySelector('[role="img"]')).not.toBeNull()
    })
    const canvas = container.querySelector('[role="img"]') as HTMLElement
    expect(canvas.style.height).toBe('300px')
  })
})

describe('EChartNode: accessibility', () => {
  it('renders role=img and aria-label with title', async () => {
    vi.mocked(createChart).mockImplementation(() => Promise.resolve(fakeInstance()))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', title: '图表', data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.querySelector('[role="img"]')).not.toBeNull()
    })
    const canvas = container.querySelector('[role="img"]')
    expect(canvas?.getAttribute('aria-label')).toBe('图表')
  })

  it('renders aria-label fallback when no title', async () => {
    vi.mocked(createChart).mockImplementation(() => Promise.resolve(fakeInstance()))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.querySelector('[role="img"]')).not.toBeNull()
    })
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('ECharts chart')
  })
})

describe('EChartNode: scatter with CJK labels', () => {
  it('passes category xAxis with CJK labels (not value axis)', async () => {
    let capturedOption: unknown
    vi.mocked(createChart).mockImplementation((_el, option) => {
      capturedOption = option
      return Promise.resolve(fakeInstance())
    })
    const node: GenuiEChart = {
      type: 'echart',
      preset: 'scatter',
      data: [{ label: '一月', value: 10 }, { label: '二月', value: 20 }],
    }
    render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(capturedOption).toBeDefined()
    }, { timeout: 3000 })
    const opt = capturedOption as { xAxis?: { type?: string; data?: string[] } }
    expect(opt.xAxis?.type).toBe('category')
    expect(opt.xAxis?.data).toEqual(['一月', '二月'])
  })
})

describe('EChartNode: drill 子树就地展开（2026-09-27 行为变更）', () => {
  const patchChart = (target: string, children: unknown[]): GenuiEChart =>
    ({ type: 'echart', preset: 'tree', height: 220, drillPatch: { key: 'root', target, children } })

  function renderChart(node: GenuiEChart) {
    const created: Array<{ setOption: ReturnType<typeof vi.fn> }> = []
    vi.mocked(createChart).mockImplementation(async () => {
      const inst = fakeInstance()
      created.push(inst as never)
      return inst as never
    })
    return created
  }

  it('patch 子树就地渲染成独立图（不并入上图）', async () => {
    const created = renderChart(patchChart('设备基础模型', [{ name: '能源基础模型' }]))
    render(<EChartNode node={patchChart('设备基础模型', [{ name: '能源基础模型' }])} />)
    await vi.waitFor(() => expect(created.length).toBeGreaterThanOrEqual(1))
    // patch 走 lazyCreateChart(el, patchOption) 直接建实例，option 是第 2 个入参
    const opt = vi.mocked(createChart).mock.calls[0]?.[1] as { series?: Array<{ type?: string; data?: unknown[] }> }
    expect(opt?.series?.[0]?.type).toBe('tree')
    // 根节点是下钻目标，children 是新增子树
    expect(JSON.stringify(opt?.series?.[0]?.data)).toContain('设备基础模型')
    expect(JSON.stringify(opt?.series?.[0]?.data)).toContain('能源基础模型')
  })

  it('两个 patch 各自渲染成独立图（不合并、图不膨胀）', async () => {
    const created = renderChart(patchChart('X', [{ name: 'a' }]))
    const { unmount } = render(<EChartNode node={patchChart('X', [{ name: 'a' }])} />)
    await vi.waitFor(() => expect(created.length).toBe(1))
    unmount()
    render(<EChartNode node={patchChart('Y', [{ name: 'b' }])} />)
    await vi.waitFor(() => expect(created.length).toBe(2))
    const callOpt = (i: number): string => JSON.stringify(
      (vi.mocked(createChart).mock.calls[i]?.[1] as { series?: Array<{ data?: unknown }> }).series?.[0]?.data)
    const first = callOpt(0)
    const second = callOpt(1)
    expect(first).toContain('"X"')
    expect(second).toContain('"Y"')
    expect(second).not.toContain('"X"') // 独立图，不含上一棵树
  })
})

describe('EChartNode: drill 走单击（2026-09-28 修复双击失效）', () => {
  const drillChart = (): GenuiEChart => ({
    type: 'echart', preset: 'tree', height: 300, drill: { key: '设备基础模型' },
    tree: { data: [{ name: '设备基础模型', children: [{ name: '能源基础模型' }] }] },
  })

  it('drill 绑 click 而非 dblclick', async () => {
    // The regression: drill was bound to 'dblclick', but ECharts' tree toggles
    // the subtree on every single click and re-renders — the first click moved
    // the node, so the second never closed a dblclick sequence and drill was
    // dead. Click is the only binding that can fire.
    const inst = fakeInstanceWithEvents()
    vi.mocked(createChart).mockImplementation(async () => inst as never)
    render(<EChartNode node={drillChart()} />)
    await vi.waitFor(() => expect(inst.on).toHaveBeenCalled())
    expect(inst.boundEvents()).toEqual(['click'])
  })

  it('tree preset 关掉 expandAndCollapse：单击不再被 ECharts 折叠抢走', async () => {
    const inst = fakeInstanceWithEvents()
    vi.mocked(createChart).mockImplementation(async () => inst as never)
    render(<EChartNode node={drillChart()} />)
    await vi.waitFor(() => expect(createChart).toHaveBeenCalled())
    const opt = vi.mocked(createChart).mock.calls[0]?.[1] as {
      series?: Array<{ type?: string; expandAndCollapse?: boolean }>
    }
    expect(opt?.series?.[0]?.type).toBe('tree')
    expect(opt?.series?.[0]?.expandAndCollapse).toBe(false)
  })

  it('drillPatch 子树同样关折叠（保持与首图一致的交互）', async () => {
    const inst = fakeInstanceWithEvents()
    vi.mocked(createChart).mockImplementation(async () => inst as never)
    const node: GenuiEChart = {
      type: 'echart', preset: 'tree', height: 220,
      drillPatch: { key: '设备基础模型', target: '能源基础模型', children: [{ name: '对端' }] },
    }
    render(<EChartNode node={node} />)
    await vi.waitFor(() => expect(createChart).toHaveBeenCalled())
    const opt = vi.mocked(createChart).mock.calls[0]?.[1] as {
      series?: Array<{ type?: string; expandAndCollapse?: boolean }>
    }
    expect(opt?.series?.[0]?.expandAndCollapse).toBe(false)
  })

  it('非 drill 的普通 action 图表仍绑 click（行为不变）', async () => {
    const inst = fakeInstanceWithEvents()
    vi.mocked(createChart).mockImplementation(async () => inst as never)
    render(<EChartNode node={{
      type: 'echart', preset: 'bar', height: 200, actionTemplate: '看看 {name}',
      data: [{ label: '一月', value: 1 }],
    }} />)
    await vi.waitFor(() => expect(inst.on).toHaveBeenCalled())
    expect(inst.boundEvents()).toEqual(['click'])
  })
})

describe('EChartNode: graph preset 边标签（关系是边不是节点）', () => {
  const graphNode = (links: Array<{ from: string; to: string; label?: string }>): GenuiEChart => ({
    type: 'echart', preset: 'graph', height: 300, links,
  })
  const optOf = (): { series?: Array<Record<string, unknown>> } =>
    vi.mocked(createChart).mock.calls[0]?.[1] as { series?: Array<Record<string, unknown>> }

  it('links[].label 渲染成边标签，且带箭头表示方向', async () => {
    vi.mocked(createChart).mockResolvedValue(fakeInstance())
    render(<EChartNode node={graphNode([
      { from: '设备基础模型', to: '设备参数列模型', label: '设备参数列表' },
    ])} />)
    await vi.waitFor(() => expect(createChart).toHaveBeenCalled())
    const series = optOf().series![0]!
    expect(series.edgeSymbol).toEqual(['none', 'arrow'])
    expect((series.edgeLabel as { show: boolean }).show).toBe(true)
    // 关系名挂在边上，不再需要"关系名当节点"这种中间层
    expect(JSON.stringify(series.links)).toContain('设备参数列表')
    const nodeNames = (series.data as Array<{ name: string }>).map((d) => d.name)
    expect(nodeNames).toContain('设备基础模型')
    expect(nodeNames).toContain('设备参数列模型')
    expect(nodeNames).not.toContain('设备参数列表')
  })

  it('无 label 的 links 不开边标签/箭头（普通拓扑图行为不变）', async () => {
    vi.mocked(createChart).mockResolvedValue(fakeInstance())
    render(<EChartNode node={graphNode([{ from: 'A', to: 'B' }])} />)
    await vi.waitFor(() => expect(createChart).toHaveBeenCalled())
    const series = optOf().series![0]!
    expect(series.edgeSymbol).toBeUndefined()
    expect(series.edgeLabel).toBeUndefined()
  })

  it('edgeLabel.formatter 从 link data 取 label，缺失时返回空串', async () => {
    vi.mocked(createChart).mockResolvedValue(fakeInstance())
    render(<EChartNode node={graphNode([{ from: 'A', to: 'B', label: '关系X' }])} />)
    await vi.waitFor(() => expect(createChart).toHaveBeenCalled())
    const fmt = (optOf().series![0]!.edgeLabel as { formatter: (p: unknown) => string }).formatter
    expect(fmt({ data: { label: '关系X' } })).toBe('关系X')
    expect(fmt({})).toBe('')
  })
})
