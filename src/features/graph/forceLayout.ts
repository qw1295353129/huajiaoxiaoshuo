/**
 * 极简力导向布局：斥力 + 弹簧 + 向心力 + 阻尼。
 * 不引入 d3 等任何依赖，几十个节点时性能足够。
 */

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** 拖拽中的节点被钉住，不再参与受力 */
  fixed?: boolean;
}

export interface LayoutLink {
  id: string;
  source: string;
  target: string;
  /** 0..1，越大越短（关系越亲密靠得越近） */
  strength: number;
}

export interface SimulateOptions {
  width: number;
  height: number;
  /** 本次调用的迭代次数 */
  iterations?: number;
  /** 斥力系数 */
  repulsion?: number;
  damping?: number;
  centerStrength?: number;
}

/** 按圆环初始摆放，保证每次布局从同一状态出发（结果稳定、不闪） */
export function createLayoutNodes(
  items: { id: string; radius: number }[],
  width: number,
  height: number,
  seed = 20240921,
): LayoutNode[] {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.36;
  const rand = mulberry32(seed);
  return items.map((item, index) => {
    const angle = (index / Math.max(1, items.length)) * Math.PI * 2 + rand() * 0.2;
    const jitter = 0.85 + rand() * 0.3;
    return {
      id: item.id,
      x: cx + Math.cos(angle) * radius * jitter,
      y: cy + Math.sin(angle) * radius * jitter,
      vx: 0,
      vy: 0,
      radius: item.radius,
    };
  });
}

/**
 * 就地推进模拟若干次迭代。
 * 每帧调用 2~4 次即可看到「30~60 帧后稳定」的动画效果。
 */
export function simulate(nodes: LayoutNode[], links: LayoutLink[], options: SimulateOptions): void {
  const {
    width,
    height,
    iterations = 3,
    repulsion = 9000,
    damping = 0.82,
    centerStrength = 0.005,
  } = options;

  if (nodes.length === 0) return;
  const index = new Map(nodes.map((n) => [n.id, n]));
  const cx = width / 2;
  const cy = height / 2;

  for (let step = 0; step < iterations; step += 1) {
    const alpha = 1 - step / Math.max(1, iterations);

    // 斥力：所有节点两两相斥，重叠时额外推开
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          // 完全重合时给一个确定性的微小偏移，避免除零
          dx = (i % 2 === 0 ? 1 : -1) * 0.6;
          dy = (j % 2 === 0 ? 1 : -1) * 0.6;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const minDistance = a.radius + b.radius + 16;
        const overlap = d < minDistance ? (minDistance - d) * 0.55 : 0;
        const force = (repulsion / d2 + overlap) * alpha;
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // 弹簧：有关系的节点互相拉近
    for (const link of links) {
      const a = index.get(link.source);
      const b = index.get(link.target);
      if (!a || !b || a === b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const rest = (a.radius + b.radius) * (2.4 - Math.min(1, Math.max(0, link.strength)) * 1.1) + 40;
      const force = (d - rest) * 0.05 * alpha;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // 向心力 + 积分
    for (const node of nodes) {
      node.vx += (cx - node.x) * centerStrength * alpha;
      node.vy += (cy - node.y) * centerStrength * alpha;
      if (node.fixed) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx *= damping;
      node.vy *= damping;
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (speed > 14) {
        node.vx = (node.vx / speed) * 14;
        node.vy = (node.vy / speed) * 14;
      }
      node.x += node.vx;
      node.y += node.vy;
      // 限制在画布内
      const pad = node.radius + 10;
      node.x = Math.max(pad, Math.min(width - pad, node.x));
      node.y = Math.max(pad, Math.min(height - pad, node.y));
    }
  }
}

/** 结构指纹：只在这些东西变化时才重新布局 */
export function layoutFingerprint(nodeIds: string[], linkIds: string[]): string {
  return nodeIds.join(",") + "|" + linkIds.join(",");
}

/** 确定性随机数（保证每次布局结果一致） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
