import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@heroui/react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { createLayoutNodes, simulate, type LayoutLink, type LayoutNode } from "./forceLayout";

/** 画布坐标系（放大缩小平移都作用在 viewBox 上） */
const WIDTH = 1000;
const HEIGHT = 640;
const MIN_VIEW_W = 240;
const MAX_VIEW_W = 1600;
const FRAMES = 60;

export interface GraphNodeInput {
  id: string;
  label: string;
  sublabel?: string;
  radius: number;
  color: string;
  emoji?: string;
}

export interface GraphEdgeInput {
  id: string;
  source: string;
  target: string;
  color: string;
  width: number;
  opacity: number;
  label: string;
  strength: number;
  directed: boolean;
  dashed?: boolean;
}

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FULL_VIEW: View = { x: 0, y: 0, w: WIDTH, h: HEIGHT };

/**
 * 纯 SVG 关系图谱画布：
 * 自己实现的力导向布局 + pointer events 拖拽节点 + viewBox 缩放平移。
 */
export function GraphCanvas({
  nodes,
  edges,
  fingerprint,
  selectedNodeId,
  selectedEdgeId,
  visibleIds,
  emphasisIds,
  onSelectNode,
  onSelectEdge,
  onClearSelection,
}: {
  nodes: GraphNodeInput[];
  edges: GraphEdgeInput[];
  /** 结构指纹，变化时重新跑布局 */
  fingerprint: string;
  selectedNodeId?: string;
  selectedEdgeId?: string;
  /** 当前可见节点（用于淡化） */
  visibleIds: Set<string>;
  /** 需要强调的节点（某角色的一度关系）；为空表示不淡化 */
  emphasisIds: Set<string>;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onClearSelection: () => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodesRef = useRef<LayoutNode[]>([]);
  const linksRef = useRef<LayoutLink[]>([]);
  const rafRef = useRef<number>(0);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; view: View; moved: boolean } | null>(null);

  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [view, setView] = useState<View>(FULL_VIEW);
  const viewRef = useRef<View>(FULL_VIEW);
  viewRef.current = view;

  const links: LayoutLink[] = useMemo(
    () => edges.map((e) => ({ id: e.id, source: e.source, target: e.target, strength: e.strength })),
    [edges],
  );
  linksRef.current = links;

  const syncPositions = useCallback(() => {
    const next: Record<string, { x: number; y: number }> = {};
    for (const node of nodesRef.current) next[node.id] = { x: node.x, y: node.y };
    setPositions(next);
  }, []);

  /** 布局稳定后自动适配视图，让整张图铺满画布 */
  const fitToNodes = useCallback(() => {
    const list = nodesRef.current;
    if (list.length === 0) return;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const node of list) {
      // 预留标签与描边的空间
      const pad = node.radius + 34;
      minX = Math.min(minX, node.x - pad);
      maxX = Math.max(maxX, node.x + pad);
      minY = Math.min(minY, node.y - pad);
      maxY = Math.max(maxY, node.y + pad);
    }
    const margin = 16;
    const scale = Math.max((maxX - minX + margin * 2) / WIDTH, (maxY - minY + margin * 2) / HEIGHT);
    const w = Math.min(MAX_VIEW_W, Math.max(MIN_VIEW_W, WIDTH * scale));
    const h = (w / WIDTH) * HEIGHT;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setView(clampView({ x: cx - w / 2, y: cy - h / 2, w, h }));
  }, []);

  /** 跑 frames 帧动画（每帧推进 3 次迭代），结束后可选自动适配视图 */
  const runSimulation = useCallback(
    (frames: number, fitAfter = false) => {
      cancelAnimationFrame(rafRef.current);
      let frame = 0;
      const step = () => {
        simulate(nodesRef.current, linksRef.current, { width: WIDTH, height: HEIGHT, iterations: 3 });
        syncPositions();
        frame += 1;
        if (frame < frames) {
          rafRef.current = requestAnimationFrame(step);
        } else if (fitAfter) {
          fitToNodes();
        }
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [syncPositions, fitToNodes],
  );

  // 结构变化 → 重建节点并重新布局（30~60 帧内稳定后自动适配视图）
  useEffect(() => {
    nodesRef.current = createLayoutNodes(
      nodes.map((n) => ({ id: n.id, radius: n.radius })),
      WIDTH,
      HEIGHT,
    );
    syncPositions();
    runSimulation(FRAMES, true);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  // 滚轮缩放：需要非 passive 监听才能 preventDefault
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0016);
      setView((prev) => zoomAt(el, prev, factor, event.clientX, event.clientY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toCanvas = (clientX: number, clientY: number) => {
    const el = svgRef.current;
    const current = viewRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const scale = Math.min(rect.width / current.w, rect.height / current.h) || 1;
    const offsetX = (rect.width - current.w * scale) / 2;
    const offsetY = (rect.height - current.h * scale) / 2;
    return {
      x: current.x + (clientX - rect.left - offsetX) / scale,
      y: current.y + (clientY - rect.top - offsetY) / scale,
    };
  };

  const startNodeDrag = (event: ReactPointerEvent, id: string) => {
    event.stopPropagation();
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node) return;
    const point = toCanvas(event.clientX, event.clientY);
    dragRef.current = { id, offsetX: node.x - point.x, offsetY: node.y - point.y, moved: false };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const startPan = (event: ReactPointerEvent) => {
    panRef.current = { startX: event.clientX, startY: event.clientY, view: viewRef.current, moved: false };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (drag) {
      const point = toCanvas(event.clientX, event.clientY);
      const node = nodesRef.current.find((n) => n.id === drag.id);
      if (node) {
        const nextX = point.x + drag.offsetX;
        const nextY = point.y + drag.offsetY;
        if (Math.abs(nextX - node.x) > 0.5 || Math.abs(nextY - node.y) > 0.5) drag.moved = true;
        node.x = Math.max(node.radius, Math.min(WIDTH - node.radius, nextX));
        node.y = Math.max(node.radius, Math.min(HEIGHT - node.radius, nextY));
        node.fixed = true;
        simulate(nodesRef.current, linksRef.current, { width: WIDTH, height: HEIGHT, iterations: 1 });
        syncPositions();
      }
      return;
    }

    const pan = panRef.current;
    if (pan) {
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const scale = Math.min(rect.width / pan.view.w, rect.height / pan.view.h) || 1;
      const dx = (event.clientX - pan.startX) / scale;
      const dy = (event.clientY - pan.startY) / scale;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) pan.moved = true;
      setView(clampView({ ...pan.view, x: pan.view.x - dx, y: pan.view.y - dy }));
    }
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (drag) {
      const node = nodesRef.current.find((n) => n.id === drag.id);
      if (node) node.fixed = false;
      dragRef.current = null;
      if (!drag.moved) onSelectNode(drag.id);
      else runSimulation(24);
    }
    const pan = panRef.current;
    if (pan) {
      panRef.current = null;
      if (!pan.moved) onClearSelection();
    }
    svgRef.current?.releasePointerCapture?.(event.pointerId);
  };

  const zoomBy = (factor: number) => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setView((prev) => zoomAt(el, prev, factor, rect.left + rect.width / 2, rect.top + rect.height / 2));
  };

  /** 边颜色 → 箭头 marker id */
  const markerColors = useMemo(() => Array.from(new Set(edges.filter((e) => e.directed).map((e) => e.color))), [edges]);
  const graphNodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const edgeById = useMemo(() => new Map(edges.map((e) => [e.id, e])), [edges]);
  /** 反向边集合：用于把双向关系画成两条弧线 */
  const reverseKeys = useMemo(() => {
    const set = new Set<string>();
    for (const e of edges) set.add(e.source + "→" + e.target);
    return set;
  }, [edges]);

  const zoomedIn = view.w < 700;

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={view.x + " " + view.y + " " + view.w + " " + view.h}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full touch-none select-none"
        onPointerDown={startPan}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          {markerColors.map((color) => (
            <marker
              key={color}
              id={markerId(color)}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
          ))}
        </defs>

        {/* 连线 */}
        <g>
          {edges.map((edge) => {
            const a = positions[edge.source];
            const b = positions[edge.target];
            const sourceNode = graphNodeById.get(edge.source);
            const targetNode = graphNodeById.get(edge.target);
            if (!a || !b || !sourceNode || !targetNode) return null;

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const ux = dx / dist;
            const uy = dy / dist;
            const x1 = a.x + ux * (sourceNode.radius + 2);
            const y1 = a.y + uy * (sourceNode.radius + 2);
            const x2 = b.x - ux * (targetNode.radius + 9);
            const y2 = b.y - uy * (targetNode.radius + 9);

            const hasReverse = reverseKeys.has(edge.target + "→" + edge.source);
            const mx = (x1 + x2) / 2 + (hasReverse ? -uy * 16 : 0);
            const my = (y1 + y2) / 2 + (hasReverse ? ux * 16 : 0);
            const d = "M " + x1 + " " + y1 + " Q " + mx + " " + my + " " + x2 + " " + y2;

            const dim = !visibleIds.has(edge.source) || !visibleIds.has(edge.target);
            const active = selectedEdgeId === edge.id;
            const emphasized =
              emphasisIds.size === 0 || (emphasisIds.has(edge.source) && emphasisIds.has(edge.target));

            return (
              <g key={edge.id} data-edge-id={edge.id} opacity={dim ? 0.12 : emphasized ? 1 : 0.25}>
                <path d={d} fill="none" stroke={edge.color} strokeWidth={edge.width} strokeOpacity={edge.opacity} strokeLinecap="round" strokeDasharray={edge.dashed ? "5 4" : undefined} />
                {edge.directed && (
                  <path d={d} fill="none" stroke={edge.color} strokeWidth={edge.width} strokeOpacity={edge.opacity} markerEnd={"url(#" + markerId(edge.color) + ")"} />
                )}
                {/* 点击热区 */}
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  className="cursor-pointer"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onSelectEdge(edge.id);
                  }}
                />
                {(active || zoomedIn) && (
                  <text
                    x={mx}
                    y={my}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="pointer-events-none select-none fill-neutral-600 dark:fill-neutral-300"
                    style={{ fontSize: 10, paintOrder: "stroke" }}
                    stroke="white"
                    strokeWidth={3}
                    strokeOpacity={0.85}
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* 节点 */}
        <g>
          {nodes.map((node) => {
            const p = positions[node.id];
            if (!p) return null;
            const dim = !visibleIds.has(node.id);
            const emphasized = emphasisIds.size === 0 || emphasisIds.has(node.id);
            const active = selectedNodeId === node.id;
            return (
              <g
                key={node.id}
                data-node-id={node.id}
                transform={"translate(" + p.x + " " + p.y + ")"}
                opacity={dim ? 0.2 : emphasized ? 1 : 0.3}
                className="cursor-grab active:cursor-grabbing"
                onPointerDown={(event) => startNodeDrag(event, node.id)}
              >
                {active && <circle r={node.radius + 7} fill="none" stroke={node.color} strokeOpacity={0.4} strokeWidth={2} />}
                <circle
                  r={node.radius}
                  fill={node.color}
                  fillOpacity={0.92}
                  className="stroke-white dark:stroke-neutral-900"
                  strokeWidth={2}
                />
                {node.emoji ? (
                  <text textAnchor="middle" dominantBaseline="central" className="pointer-events-none select-none" style={{ fontSize: node.radius * 0.95 }}>
                    {node.emoji}
                  </text>
                ) : (
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="pointer-events-none select-none fill-white"
                    style={{ fontSize: Math.max(10, node.radius * 0.7) }}
                  >
                    {node.label.slice(0, 1)}
                  </text>
                )}
                <text
                  y={node.radius + 13}
                  textAnchor="middle"
                  className="pointer-events-none select-none fill-neutral-700 dark:fill-neutral-200"
                  style={{ fontSize: 11, paintOrder: "stroke" }}
                  stroke="white"
                  strokeWidth={3}
                  strokeOpacity={0.75}
                >
                  {node.label}
                </text>
                {node.sublabel && (
                  <text
                    y={node.radius + 25}
                    textAnchor="middle"
                    className="pointer-events-none select-none fill-neutral-500"
                    style={{ fontSize: 9.5, paintOrder: "stroke" }}
                    stroke="white"
                    strokeWidth={3}
                    strokeOpacity={0.75}
                  >
                    {node.sublabel}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* 缩放控制 */}
      <div className="absolute right-3 top-3 flex flex-col gap-1">
        <Button size="sm" variant="outline" isIconOnly aria-label="放大" onPress={() => zoomBy(1.25)}>
          <ZoomIn className="size-4" />
        </Button>
        <Button size="sm" variant="outline" isIconOnly aria-label="缩小" onPress={() => zoomBy(0.8)}>
          <ZoomOut className="size-4" />
        </Button>
        <Button size="sm" variant="outline" isIconOnly aria-label="复位视图" onPress={() => setView(FULL_VIEW)}>
          <Maximize2 className="size-4" />
        </Button>
      </div>

      <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] opacity-40">
        拖拽节点调整位置 · 拖动空白平移 · 滚轮缩放 · 点击节点/连线查看详情
      </p>
      {edgeById.size === 0 && (
        <p className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-xs opacity-50">
          还没有人物关系
        </p>
      )}
    </div>
  );
}

function markerId(color: string): string {
  return "graph-arrow-" + color.replace("#", "");
}

function clampView(view: View): View {
  const w = Math.min(MAX_VIEW_W, Math.max(MIN_VIEW_W, view.w));
  const h = (w / WIDTH) * HEIGHT;
  const x = Math.min(WIDTH - w, Math.max(0, view.x));
  const y = Math.min(HEIGHT - h, Math.max(0, view.y));
  return { x, y, w, h };
}

/** 以某个屏幕坐标为锚点缩放视图 */
function zoomAt(el: SVGSVGElement, view: View, factor: number, clientX: number, clientY: number): View {
  const nextW = Math.min(MAX_VIEW_W, Math.max(MIN_VIEW_W, view.w / factor));
  const nextH = (nextW / WIDTH) * HEIGHT;
  const rect = el.getBoundingClientRect();
  const scale = Math.min(rect.width / view.w, rect.height / view.h) || 1;
  const offsetX = (rect.width - view.w * scale) / 2;
  const offsetY = (rect.height - view.h * scale) / 2;
  const anchorX = view.x + (clientX - rect.left - offsetX) / scale;
  const anchorY = view.y + (clientY - rect.top - offsetY) / scale;
  const ratio = nextW / view.w;
  const x = anchorX - (anchorX - view.x) * ratio;
  const y = anchorY - (anchorY - view.y) * ratio;
  return clampView({ x, y, w: nextW, h: nextH });
}
