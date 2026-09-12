'use client';

import * as React from 'react';

import type {
  FateEdge,
  FateEdgeStatus,
  FateNode,
  FateNodeKind,
  FateNodeStatus,
  FateTreeGraph,
  PositionedFateNode,
} from '@/types/fate';

/**
 * 命运树（DAG）可视化。
 *
 * 分层布局：回合号 → 列，同回合节点在列内垂直均分。布局结果以百分比坐标输出，
 * 节点用 HTML 绝对定位（便于套 Tailwind 样式），连线用 SVG 贝塞尔曲线绘制，
 * 两者共用同一套坐标，因此窗口缩放时不会错位。
 *
 * 容器使用固定宽高比 `1000 / 560`，与 SVG viewBox 完全一致，
 * 保证百分比定位与 viewBox 坐标严格对齐；窄屏时横向滚动而不是压缩变形。
 */

const VIEW_W = 1000;
const VIEW_H = 560;
const PAD_X = 110;
const PAD_Y = 84;
const MIN_GAP = 96;
const MAX_GAP = 152;

interface LaidOutEdge {
  readonly edge: FateEdge;
  readonly from: PositionedFateNode;
  readonly to: PositionedFateNode;
}

function layoutGraph(
  graph: FateTreeGraph,
  totalTurns: number,
): {
  nodes: PositionedFateNode[];
  edges: LaidOutEdge[];
} {
  const columns = new Map<number, FateNode[]>();

  graph.nodes.forEach((node) => {
    const list = columns.get(node.turnIndex);
    if (list) {
      list.push(node);
    } else {
      columns.set(node.turnIndex, [node]);
    }
  });

  const turns = [...columns.keys()].sort((a, b) => a - b);
  // 横轴按「剧本总回合数」分列，而不是按当前已出现的最大回合，
  // 否则第一回合的两个分支会被顶到最右侧并被容器裁掉。
  const span = Math.max(1, totalTurns);
  const positioned = new Map<string, PositionedFateNode>();

  turns.forEach((turn) => {
    const nodes = columns.get(turn) ?? [];
    const ratio = turn === 0 ? 0 : turn / span;
    const x = PAD_X + ratio * (VIEW_W - PAD_X * 2);
    const count = nodes.length;
    const usable = VIEW_H - PAD_Y * 2;
    const gap = count > 1 ? Math.max(MIN_GAP, Math.min(MAX_GAP, usable / (count - 1))) : 0;

    nodes.forEach((node, index) => {
      const y = count === 1 ? VIEW_H / 2 : VIEW_H / 2 + (index - (count - 1) / 2) * gap;

      positioned.set(node.id, {
        ...node,
        xPercent: (x / VIEW_W) * 100,
        yPercent: (y / VIEW_H) * 100,
      });
    });
  });

  const edges: LaidOutEdge[] = [];

  graph.edges.forEach((edge) => {
    const from = positioned.get(edge.from);
    const to = positioned.get(edge.to);

    if (from && to) {
      edges.push({ edge, from, to });
    }
  });

  return { nodes: [...positioned.values()], edges };
}

/** 从左向右的三次贝塞尔：水平控制点让连线像水流一样平顺。 */
function buildEdgePath(from: PositionedFateNode, to: PositionedFateNode): string {
  const x1 = (from.xPercent / 100) * VIEW_W;
  const y1 = (from.yPercent / 100) * VIEW_H;
  const x2 = (to.xPercent / 100) * VIEW_W;
  const y2 = (to.yPercent / 100) * VIEW_H;
  const curve = Math.max(48, (x2 - x1) * 0.5);

  return `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`;
}

const EDGE_CLASS: Record<FateEdgeStatus, string> = {
  locked: 'fate-edge fate-edge-locked',
  available: 'fate-edge fate-edge-available',
  taken: 'fate-edge fate-edge-taken animate-dash-flow',
  failed: 'fate-edge fate-edge-failed animate-dash-flow',
};

const EDGE_MARKER: Record<FateEdgeStatus, string> = {
  locked: 'fate-arrow-locked',
  available: 'fate-arrow-available',
  taken: 'fate-arrow-taken',
  failed: 'fate-arrow-failed',
};

const NODE_STYLE: Record<FateNodeStatus, string> = {
  locked: 'border-white/10 bg-ink-800/70 text-slate-600',
  available:
    'border-zhihu-500/50 bg-ink-700 text-slate-100 hover:-translate-y-0.5 hover:border-zhihu-400 hover:shadow-glow',
  current: 'border-white/40 bg-ink-600 text-white shadow-glow',
  visited: 'border-white/15 bg-ink-700/90 text-slate-300',
  succeeded: 'border-relic-gold/60 bg-ink-700 text-amber-100 shadow-relic',
  failed: 'border-relic-danger/60 bg-ink-700 text-rose-100',
};

const NODE_MARK: Record<FateNodeKind, string> = {
  root: '起',
  safe: '稳',
  risk: '险',
  success: '成',
  fail: '败',
};

const NODE_MARK_STYLE: Record<FateNodeKind, string> = {
  root: 'bg-white/10 text-slate-300',
  safe: 'bg-zhihu-500/20 text-zhihu-300',
  risk: 'bg-relic-gold/20 text-amber-300',
  success: 'bg-relic-jade/20 text-emerald-300',
  fail: 'bg-relic-danger/20 text-rose-300',
};

const LEGEND: ReadonlyArray<{ readonly label: string; readonly className: string }> = [
  { label: '可选项', className: 'border-zhihu-500/60 bg-ink-700' },
  { label: '检定通过', className: 'border-relic-gold/60 bg-ink-700' },
  { label: '检定失败', className: 'border-relic-danger/60 bg-ink-700' },
  { label: '未走分支', className: 'border-white/10 bg-ink-800' },
];

export interface FateTreeProps {
  readonly graph: FateTreeGraph;
  /**
   * 剧本总回合数，决定横轴分列刻度。
   * 必须由调用方按剧本给出，否则命运树会按「当前已出现的最大回合」压缩，
   * 导致第一回合分支被顶到最右侧。
   */
  readonly totalTurns?: number;
  /** 当前正在检定的节点 id，用于高亮。 */
  readonly activeNodeId?: string | null;
  /** 点击可选项时回调；锁定/已走过的节点不会触发。 */
  readonly onSelectNode?: (nodeId: string) => void;
  readonly title?: string;
  readonly className?: string;
}

function FateNodeCard({
  node,
  isActive,
  onSelect,
}: {
  node: PositionedFateNode;
  isActive: boolean;
  onSelect?: (nodeId: string) => void;
}) {
  const selectable = node.status === 'available' && Boolean(onSelect);
  const style = isActive ? NODE_STYLE.current : NODE_STYLE[node.status];

  return (
    <button
      type="button"
      disabled={!selectable}
      onClick={() => selectable && onSelect?.(node.id)}
      aria-label={`${node.label}${node.badge ? `，${node.badge}` : ''}`}
      style={{ left: `${node.xPercent}%`, top: `${node.yPercent}%` }}
      className="absolute -translate-x-1/2 -translate-y-1/2 focus-visible:outline-none"
    >
      <span className="relative block">
        {selectable ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 -z-10 animate-ping-slow rounded-xl border border-zhihu-400/40"
          />
        ) : null}

        <span
          className={[
            'flex w-[132px] flex-col gap-1 rounded-xl border px-3 py-2 text-left backdrop-blur-sm transition-all duration-200 ease-out',
            selectable ? 'cursor-pointer' : 'cursor-default',
            style,
          ].join(' ')}
        >
          <span className="flex items-center gap-1.5">
            <span
              className={[
                'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold',
                NODE_MARK_STYLE[node.kind],
              ].join(' ')}
            >
              {NODE_MARK[node.kind]}
            </span>
            <span className="truncate text-[11px] font-semibold leading-tight">{node.label}</span>
          </span>

          {node.badge ? (
            <span className="truncate font-mono text-[9px] text-slate-400">{node.badge}</span>
          ) : null}

          {node.sublabel ? (
            <span className="truncate text-[9px] text-slate-500">{node.sublabel}</span>
          ) : null}
        </span>

        {node.relicId ? (
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-relic-gold text-[9px] font-bold text-ink-900 shadow-relic"
          >
            ✦
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function FateTree({
  graph,
  totalTurns = 4,
  activeNodeId = null,
  onSelectNode,
  title = '命运之树',
  className,
}: FateTreeProps) {
  const { nodes, edges } = React.useMemo(
    () => layoutGraph(graph, totalTurns),
    [graph, totalTurns],
  );
  const turnMarkers = React.useMemo(
    () => Array.from({ length: Math.max(0, totalTurns) }, (_, index) => index + 1),
    [totalTurns],
  );

  return (
    <section className={['panel flex flex-col', className].filter(Boolean).join(' ')}>
      <header className="panel-header">
        <h3 className="panel-title">
          <span aria-hidden="true" className="h-4 w-1 rounded-full bg-zhihu-500" />
          {title}
        </h3>
        <span className="chip">{nodes.length} 个分支节点</span>
      </header>

      {nodes.length === 0 ? (
        <div className="flex h-[300px] flex-col items-center justify-center gap-2 px-6 text-center">
          <span className="text-sm text-slate-500">命运尚未分叉</span>
          <span className="text-xs text-slate-600">做出第一个选择后，这里会生长出你的推演路径</span>
        </div>
      ) : (
        <>
          <div className="scrollbar-thin overflow-x-auto px-3 pb-2 pt-4">
            <div className="relative mx-auto w-full min-w-[720px] max-w-[1000px] aspect-[1000/560]">
              <svg
                aria-hidden="true"
                viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full"
              >
                <defs>
                  <marker
                    id="fate-arrow-locked"
                    viewBox="0 0 12 12"
                    refX="10"
                    refY="6"
                    markerWidth="11"
                    markerHeight="11"
                    markerUnits="userSpaceOnUse"
                    orient="auto"
                  >
                    <path d="M0,0 L12,6 L0,12 L3,6 Z" fill="rgba(148,163,184,0.3)" />
                  </marker>
                  <marker
                    id="fate-arrow-available"
                    viewBox="0 0 12 12"
                    refX="10"
                    refY="6"
                    markerWidth="11"
                    markerHeight="11"
                    markerUnits="userSpaceOnUse"
                    orient="auto"
                  >
                    <path d="M0,0 L12,6 L0,12 L3,6 Z" fill="rgba(0,132,255,0.65)" />
                  </marker>
                  <marker
                    id="fate-arrow-taken"
                    viewBox="0 0 12 12"
                    refX="10"
                    refY="6"
                    markerWidth="12"
                    markerHeight="12"
                    markerUnits="userSpaceOnUse"
                    orient="auto"
                  >
                    <path d="M0,0 L12,6 L0,12 L3,6 Z" fill="rgba(0,132,255,0.95)" />
                  </marker>
                  <marker
                    id="fate-arrow-failed"
                    viewBox="0 0 12 12"
                    refX="10"
                    refY="6"
                    markerWidth="12"
                    markerHeight="12"
                    markerUnits="userSpaceOnUse"
                    orient="auto"
                  >
                    <path d="M0,0 L12,6 L0,12 L3,6 Z" fill="rgba(255,77,109,0.9)" />
                  </marker>
                </defs>

                {/* 回合分隔线，让「第几回合」在视觉上有锚点 */}
                {turnMarkers.map((turn) => {
                  const x = PAD_X + (turn / Math.max(1, totalTurns)) * (VIEW_W - PAD_X * 2);
                  return (
                    <line
                      key={turn}
                      x1={x}
                      y1={PAD_Y - 44}
                      x2={x}
                      y2={VIEW_H - PAD_Y + 44}
                      stroke="rgba(255,255,255,0.05)"
                      strokeWidth="1"
                      strokeDasharray="4 8"
                    />
                  );
                })}

                {edges.map(({ edge, from, to }) => (
                  <path
                    key={edge.id}
                    d={buildEdgePath(from, to)}
                    className={EDGE_CLASS[edge.status]}
                    markerEnd={`url(#${EDGE_MARKER[edge.status]})`}
                  />
                ))}
              </svg>

              {nodes.map((node) => (
                <FateNodeCard
                  key={node.id}
                  node={node}
                  isActive={activeNodeId === node.id}
                  onSelect={onSelectNode}
                />
              ))}
            </div>
          </div>

          <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 px-4 py-3">
            {LEGEND.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
                <span className={['h-3 w-3 rounded border', item.className].join(' ')} />
                {item.label}
              </span>
            ))}
          </footer>
        </>
      )}
    </section>
  );
}

export default FateTree;
