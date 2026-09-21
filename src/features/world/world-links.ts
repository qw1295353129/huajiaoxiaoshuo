import type { ID, WorldEntry } from "@/core";
import { normalizeForCompare, truncate } from "@/utils/text";

/**
 * [[标题]] 双向链接语法的解析、引用统计与父子层级构建。
 * 全是纯函数，列表、详情与预览共用同一份逻辑。
 */

/** 把正文切成「普通文本 / [[链接]]」片段，预览时把 link 片段渲染成可点击元素 */
export function parseWikiSegments(body: string): WikiSegment[] {
  const re = /\[\[([^\]]+)\]\]/g;
  const segments: WikiSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null = re.exec(body);
  while (match) {
    if (match.index > cursor) segments.push({ kind: "text", text: body.slice(cursor, match.index) });
    const target = match[1].trim();
    if (target) segments.push({ kind: "link", target: target });
    cursor = match.index + match[0].length;
    match = re.exec(body);
  }
  if (cursor < body.length) segments.push({ kind: "text", text: body.slice(cursor) });
  return segments;
}

export type WikiSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; target: string };

/** 正文里出现的 [[链接]] 目标名（去重，保持出现顺序） */
export function extractLinkTitles(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const seg of parseWikiSegments(body)) {
    if (seg.kind !== "link") continue;
    const key = normalizeForCompare(seg.target);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(seg.target);
  }
  return out;
}

/** 标题 + 别名的归一化索引，用来解析 [[链接]] */
export type TitleIndex = Map<string, WorldEntry>;

export function buildTitleIndex(entries: WorldEntry[]): TitleIndex {
  const index: TitleIndex = new Map();
  for (const entry of entries) {
    const titleKey = normalizeForCompare(entry.title);
    if (titleKey && !index.has(titleKey)) index.set(titleKey, entry);
    for (const alias of entry.aliases) {
      const aliasKey = normalizeForCompare(alias);
      if (aliasKey && !index.has(aliasKey)) index.set(aliasKey, entry);
    }
  }
  return index;
}

export function resolveWikilink(index: TitleIndex, target: string): WorldEntry | undefined {
  return index.get(normalizeForCompare(target));
}

/** 正文里指向的其他条目 id（保存时写回 entry.refs） */
export function resolveRefs(body: string, index: TitleIndex, selfId?: ID): ID[] {
  const out: ID[] = [];
  for (const title of extractLinkTitles(body)) {
    const target = resolveWikilink(index, title);
    if (!target || target.id === selfId) continue;
    if (!out.includes(target.id)) out.push(target.id);
  }
  return out;
}

export interface RefMaps {
  /** 条目 id → 它在正文里引用的条目 id */
  outgoing: Map<ID, ID[]>;
  /** 条目 id → 引用了它的条目 id（列表里的「被引用次数」） */
  incoming: Map<ID, ID[]>;
}

/** 依据正文的 [[链接]] 实时计算双向引用关系 */
export function computeRefMaps(entries: WorldEntry[]): RefMaps {
  const index = buildTitleIndex(entries);
  const outgoing = new Map<ID, ID[]>();
  const incoming = new Map<ID, ID[]>();
  for (const entry of entries) {
    outgoing.set(entry.id, []);
    incoming.set(entry.id, []);
  }
  for (const entry of entries) {
    const refs = resolveRefs(entry.body, index, entry.id);
    outgoing.set(entry.id, refs);
    for (const refId of refs) {
      const list = incoming.get(refId);
      if (list && !list.includes(entry.id)) list.push(entry.id);
    }
  }
  return { outgoing: outgoing, incoming: incoming };
}

export interface EntryNode {
  entry: WorldEntry;
  depth: number;
  children: EntryNode[];
}

/** 按 parentId 构树；父节点缺失或成环的条目降级为根节点，保证一个都不会丢 */
export function buildEntryTree(entries: WorldEntry[]): EntryNode[] {
  const byId = new Map(entries.map((e) => [e.id, e] as const));
  const nodes = new Map<ID, EntryNode>();
  for (const entry of entries) nodes.set(entry.id, { entry: entry, depth: 0, children: [] });

  const attached = new Set<ID>();
  for (const entry of entries) {
    if (!entry.parentId || entry.parentId === entry.id) continue;
    const parent = byId.get(entry.parentId);
    if (!parent) continue;
    // 父节点不能是自己的后代，否则会形成环
    if (isAncestor(byId, parent, entry.id)) continue;
    const parentNode = nodes.get(entry.parentId);
    const node = nodes.get(entry.id);
    if (!parentNode || !node) continue;
    parentNode.children.push(node);
    attached.add(entry.id);
  }

  const roots = entries.filter((e) => !attached.has(e.id)).map((e) => nodes.get(e.id)).filter((n): n is EntryNode => Boolean(n));
  const assignDepth = (list: EntryNode[], depth: number) => {
    for (const node of list) {
      node.depth = depth;
      assignDepth(node.children, depth + 1);
    }
  };
  assignDepth(roots, 0);
  return roots;
}

/** candidate 是否位于 ancestorId 的子树里（用于防止父子成环） */
function isAncestor(byId: Map<ID, WorldEntry>, candidate: WorldEntry, ancestorId: ID): boolean {
  const guard = new Set<ID>();
  let cursor: WorldEntry | undefined = candidate;
  while (cursor && cursor.parentId) {
    if (cursor.parentId === ancestorId) return true;
    if (guard.has(cursor.id)) return false;
    guard.add(cursor.id);
    cursor = byId.get(cursor.parentId);
  }
  return false;
}

/** 某条目的全部子孙 id */
export function collectDescendantIds(entries: WorldEntry[], rootId: ID): Set<ID> {
  const childrenOf = new Map<ID, ID[]>();
  for (const entry of entries) {
    if (!entry.parentId || entry.parentId === entry.id) continue;
    const list = childrenOf.get(entry.parentId);
    if (list) list.push(entry.id);
    else childrenOf.set(entry.parentId, [entry.id]);
  }
  const out = new Set<ID>();
  const walk = (id: ID) => {
    for (const child of childrenOf.get(id) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      walk(child);
    }
  };
  walk(rootId);
  return out;
}

/** 从根到当前条目的父链（不含自己），用于「XXX / YYY」面包屑 */
export function entryBreadcrumb(entry: WorldEntry, byId: Map<ID, WorldEntry>): WorldEntry[] {
  const chain: WorldEntry[] = [];
  const guard = new Set<ID>();
  let cursor = entry.parentId ? byId.get(entry.parentId) : undefined;
  while (cursor && !guard.has(cursor.id)) {
    guard.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return chain;
}

/** 命中判断：标题 / 别名 / 标签 / 正文 / 规则 */
export function matchesQuery(entry: WorldEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (entry.title.toLowerCase().includes(q)) return true;
  if (entry.aliases.some((a) => a.toLowerCase().includes(q))) return true;
  if (entry.tags.some((t) => t.toLowerCase().includes(q))) return true;
  if (entry.body.toLowerCase().includes(q)) return true;
  return entry.rules.some((r) => r.statement.toLowerCase().includes(q));
}

/** 正文摘要：去掉 [[ ]] 记号并压平空白 */
export function summarizeBody(body: string, max = 90): string {
  const plain = body.replace(/\[\[([^\]]+)\]\]/g, "$1").replace(/\s+/g, " ").trim();
  return truncate(plain, max);
}

/** 多行文本 → 去空、去重后的数组（别名用换行分隔） */
export function parseLines(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\n\r]+/)) {
    const item = raw.trim();
    if (!item) continue;
    const key = normalizeForCompare(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** 逗号 / 顿号 / 空格分隔 → 数组（标签用） */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,，、;；\s]+/)) {
    const item = raw.trim();
    if (!item) continue;
    const key = normalizeForCompare(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
