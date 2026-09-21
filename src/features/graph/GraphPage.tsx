import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Chip } from "@heroui/react";
import { Network, RefreshCw, Swords, UserRound, Users } from "lucide-react";
import type { Relationship } from "@/core";
import { PageScaffold } from "@/components/common/PageScaffold";
import { EmptyHint, Loading, StatCard } from "@/components/common/ui";
import { ROUTES } from "@/app/routes";
import { useAsync, useChapters, useCharacters, useRelationships } from "@/app/hooks";
import { listCharacters } from "@/db/repo/cast";
import { GraphCanvas, type GraphEdgeInput, type GraphNodeInput } from "./GraphCanvas";
import { GraphSidePanel } from "./GraphSidePanel";
import { layoutFingerprint } from "./forceLayout";
import {
  HOSTILE_KINDS,
  MAIN_ROLES,
  RELATION_KINDS,
  ROLE_ORDER,
  affinityLabel,
  edgeOpacity,
  edgeWidth,
  nodeRadius,
  relationColor,
  relationLabel,
  roleColor,
  roleLabel,
} from "./graphMeta";
import { DIVIDER_CLASS, LABEL_CLASS, SELECT_CLASS } from "./styles";

type FilterMode = "all" | "main" | "hostile" | "ego";

const MODE_LABELS: Record<FilterMode, string> = {
  all: "全部角色",
  main: "只看主角团",
  hostile: "只看敌对关系",
  ego: "只看某角色的一度关系",
};

/** 关系图谱页：纯 SVG 力导向图 + 关系编辑。 */
export function GraphPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const characters = useCharacters(projectId);
  const relationships = useRelationships(projectId);
  const chapters = useChapters(projectId);

  // liveQuery 首帧只返回空数组，用一次真实查询判断加载完成
  const bootRes = useAsync(async () => {
    await listCharacters(projectId);
    return true;
  }, [projectId], false);
  const booted = bootRes.value;

  const [mode, setMode] = useState<FilterMode>("all");
  const [egoId, setEgoId] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>(undefined);
  const [layoutNonce, setLayoutNonce] = useState(0);

  /** 每个角色的出场章节数 */
  const appearances = useMemo(() => {
    const map = new Map<string, number>();
    for (const chapter of chapters) {
      for (const id of chapter.characterIds) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [chapters]);

  /** 角色首次出现的章节标题 */
  const firstChapterTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const chapter of [...chapters].sort((a, b) => a.order - b.order)) {
      for (const id of chapter.characterIds) {
        if (!map.has(id)) map.set(id, "第" + (chapter.order + 1) + "章 " + chapter.title);
      }
    }
    return map;
  }, [chapters]);

  /** 邻接表：用于一度关系筛选与高亮 */
  const neighborMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const rel of relationships) {
      const from = map.get(rel.fromId) ?? new Set<string>();
      from.add(rel.toId);
      map.set(rel.fromId, from);
      const to = map.get(rel.toId) ?? new Set<string>();
      to.add(rel.fromId);
      map.set(rel.toId, to);
    }
    return map;
  }, [relationships]);

  const characterIds = useMemo(() => new Set(characters.map((c) => c.id)), [characters]);

  /** 当前筛选下应该出现的角色与关系 */
  const visible = useMemo(() => {
    const allIds = new Set(characters.map((c) => c.id));
    if (mode === "main") {
      const mainIds = new Set(characters.filter((c) => MAIN_ROLES.includes(c.role)).map((c) => c.id));
      if (mainIds.size >= 2) {
        return { ids: mainIds, edgeKind: undefined as string[] | undefined, fallback: false };
      }
      return { ids: allIds, edgeKind: undefined as string[] | undefined, fallback: true };
    }
    if (mode === "hostile") {
      const ids = new Set<string>();
      for (const rel of relationships) {
        if (HOSTILE_KINDS.includes(rel.kind) && characterIds.has(rel.fromId) && characterIds.has(rel.toId)) {
          ids.add(rel.fromId);
          ids.add(rel.toId);
        }
      }
      return { ids, edgeKind: HOSTILE_KINDS as string[], fallback: false };
    }
    if (mode === "ego" && egoId) {
      const ids = new Set<string>([egoId]);
      for (const id of neighborMap.get(egoId) ?? []) ids.add(id);
      return { ids, edgeKind: undefined as string[] | undefined, fallback: false };
    }
    return { ids: allIds, edgeKind: undefined as string[] | undefined, fallback: false };
  }, [mode, egoId, characters, relationships, neighborMap, characterIds]);

  const visibleCharacters = useMemo(
    () => characters.filter((c) => visible.ids.has(c.id)),
    [characters, visible.ids],
  );

  const visibleRelationships = useMemo(
    () =>
      relationships.filter(
        (rel) =>
          visible.ids.has(rel.fromId) &&
          visible.ids.has(rel.toId) &&
          characterIds.has(rel.fromId) &&
          characterIds.has(rel.toId) &&
          (!visible.edgeKind || visible.edgeKind.includes(rel.kind)),
      ),
    [relationships, visible.ids, visible.edgeKind, characterIds],
  );

  const nodeInputs: GraphNodeInput[] = useMemo(
    () =>
      visibleCharacters.map((c) => ({
        id: c.id,
        label: c.name,
        sublabel: roleLabel(c.role),
        radius: nodeRadius(appearances.get(c.id) ?? 0),
        color: c.color || roleColor(c.role),
        emoji: c.avatarEmoji,
      })),
    [visibleCharacters, appearances],
  );

  const edgeInputs: GraphEdgeInput[] = useMemo(
    () =>
      visibleRelationships.map((rel) => ({
        id: rel.id,
        source: rel.fromId,
        target: rel.toId,
        color: relationColor(rel.kind),
        width: edgeWidth(rel.affinity),
        opacity: edgeOpacity(rel.affinity),
        label: relationLabel(rel.kind),
        strength: Math.min(1, Math.abs(rel.affinity) / 100) * 0.8 + 0.15,
        directed: true,
      })),
    [visibleRelationships],
  );

  const renderedIds = useMemo(() => new Set(nodeInputs.map((n) => n.id)), [nodeInputs]);

  /** 选中某个角色时淡化无关节点 */
  const emphasisIds = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    const set = new Set<string>([selectedNodeId]);
    for (const id of neighborMap.get(selectedNodeId) ?? []) set.add(id);
    return set;
  }, [selectedNodeId, neighborMap]);

  const fingerprint = useMemo(
    () =>
      layoutFingerprint(
        nodeInputs.map((n) => n.id + ":" + n.radius),
        edgeInputs.map((e) => e.id + ":" + e.width.toFixed(2)),
      ) +
      "#" +
      layoutNonce,
    [nodeInputs, edgeInputs, layoutNonce],
  );

  const selectedNode = selectedNodeId ? characters.find((c) => c.id === selectedNodeId) : undefined;
  const selectedEdge = selectedEdgeId ? relationships.find((r) => r.id === selectedEdgeId) : undefined;

  /** 图例：只列出当前画面上真实存在的角色定位与关系类型 */
  const legendRoles = ROLE_ORDER.filter((role) => visibleCharacters.some((c) => c.role === role));
  const legendKinds = RELATION_KINDS.filter((kind) => visibleRelationships.some((r) => r.kind === kind));

  const isolated = visibleCharacters.filter((c) => (neighborMap.get(c.id)?.size ?? 0) === 0).length;

  const body = () => {
    if (!booted) return <Loading label="正在读取人物关系…" />;

    if (characters.length < 2) {
      return (
        <EmptyHint
          icon={<Users className="size-8" />}
          title="至少需要两个人物才能画关系图"
          description="先到「人物」页建立角色，再为它们建立关系（亲人、恋人、盟友、敌对……），关系图谱就会自动生成。"
          action={
            <Button variant="primary" onPress={() => navigate(ROUTES.characters(projectId))}>
              <Users className="size-4" />
              去建立人物
            </Button>
          }
        />
      );
    }

    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="角色" value={characters.length} hint="参与图谱的人物总数" tone="accent" icon={<Users className="size-4" />} />
          <StatCard label="关系" value={relationships.length} hint="有向边数量" tone="success" icon={<Network className="size-4" />} />
          <StatCard label="当前显示" value={visibleCharacters.length + " / " + visibleRelationships.length} hint="角色 / 关系" />
          <StatCard
            label="孤立角色"
            value={isolated}
            tone={isolated > 0 ? "warning" : "success"}
            hint={isolated > 0 ? "还没有任何关系连线" : "所有人都在关系网里"}
          />
        </div>

        <Card className={"flex flex-wrap items-end gap-3 p-3 " + DIVIDER_CLASS}>
          <div>
            <label className={LABEL_CLASS}>筛选</label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(MODE_LABELS) as FilterMode[]).map((m) => (
                <button key={m} type="button" className="transition active:scale-95" onClick={() => setMode(m)}>
                  <Chip size="sm" color={mode === m ? "accent" : "default"}>
                    {m === "hostile" && <Swords className="mr-0.5 inline size-3" />}
                    {m === "ego" && <UserRound className="mr-0.5 inline size-3" />}
                    {MODE_LABELS[m]}
                  </Chip>
                </button>
              ))}
            </div>
          </div>

          {mode === "ego" && (
            <div className="w-[200px]">
              <label className={LABEL_CLASS}>中心角色</label>
              <select className={SELECT_CLASS} value={egoId} onChange={(e) => setEgoId(e.target.value)}>
                <option value="">请选择角色</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2 pb-1">
            {visible.fallback && <span className="text-[11px] text-amber-500">没有识别到主角 / 反派，已退回显示全部角色</span>}
            {(selectedNodeId || selectedEdgeId) && (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  setSelectedNodeId(undefined);
                  setSelectedEdgeId(undefined);
                }}
              >
                取消选中
              </Button>
            )}
            <Button size="sm" variant="outline" onPress={() => setLayoutNonce((n) => n + 1)}>
              <RefreshCw className="size-3.5" />
              重新布局
            </Button>
          </div>
        </Card>

        <div className="flex flex-col gap-4 lg:flex-row">
          <Card className="min-w-0 flex-1 overflow-hidden p-0">
            <div className="h-[58vh] min-h-[420px] w-full">
              {visibleCharacters.length === 0 ? (
                <div className="grid h-full place-items-center px-6 text-center">
                  <div>
                    <p className="text-sm font-medium">当前筛选下没有角色</p>
                    <p className="mt-1.5 text-xs opacity-55">
                      {mode === "hostile"
                        ? "还没有「敌对」或「对手」类型的关系，先在右侧为角色建立关系。"
                        : mode === "ego"
                          ? "请选择一位中心角色。"
                          : "换一个筛选条件试试。"}
                    </p>
                  </div>
                </div>
              ) : (
                <GraphCanvas
                  nodes={nodeInputs}
                  edges={edgeInputs}
                  fingerprint={fingerprint}
                  selectedNodeId={selectedNodeId}
                  selectedEdgeId={selectedEdgeId}
                  visibleIds={renderedIds}
                  emphasisIds={emphasisIds}
                  onSelectNode={(id) => {
                    setSelectedNodeId(id);
                    setSelectedEdgeId(undefined);
                  }}
                  onSelectEdge={(id) => {
                    setSelectedEdgeId(id);
                    setSelectedNodeId(undefined);
                  }}
                  onClearSelection={() => {
                    setSelectedNodeId(undefined);
                    setSelectedEdgeId(undefined);
                  }}
                />
              )}
            </div>
          </Card>

          <div className="w-full shrink-0 space-y-4 lg:w-80">
            <GraphSidePanel
              projectId={projectId}
              node={selectedNode}
              edge={selectedEdge}
              characters={characters}
              relationships={relationships}
              appearances={appearances}
              firstChapterTitles={firstChapterTitles}
              onSelectEdge={(id) => {
                setSelectedEdgeId(id);
                setSelectedNodeId(undefined);
              }}
              onClose={() => setSelectedEdgeId(undefined)}
            />

            <Card className="p-4">
              <p className="text-xs font-medium">图例</p>
              <div className="mt-2.5 space-y-2">
                <div>
                  <p className="text-[11px] opacity-45">节点：颜色按角色定位，大小按出场章节数</p>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
                    {legendRoles.map((role) => (
                      <span key={role} className="flex items-center gap-1.5 text-[11px] opacity-70">
                        <span className="inline-block size-3 rounded-full" style={{ backgroundColor: roleColor(role) }} />
                        {roleLabel(role)}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] opacity-45">连线：颜色按关系类型，粗细与深浅按情感强度</p>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
                    {legendKinds.length === 0 && <span className="text-[11px] opacity-50">当前没有关系连线</span>}
                    {legendKinds.map((kind) => (
                      <span key={kind} className="flex items-center gap-1.5 text-[11px] opacity-70">
                        <span className="inline-block h-[3px] w-4 rounded-full" style={{ backgroundColor: relationColor(kind) }} />
                        {relationLabel(kind)}
                      </span>
                    ))}
                  </div>
                </div>
                {selectedEdge && (
                  <p className="text-[11px] opacity-55">
                    已选关系：{affinityLabel(selectedEdge.affinity)}（{selectedEdge.affinity > 0 ? "+" : ""}
                    {selectedEdge.affinity}）
                  </p>
                )}
              </div>
            </Card>

            {relationships.length === 0 && (
              <Card className="p-4">
                <p className="text-xs font-medium text-amber-600 dark:text-amber-300">还没有任何人物关系</p>
                <p className="mt-1.5 text-[11px] leading-relaxed opacity-60">
                  图谱现在只有孤立的节点。点击任意角色卡片里的「新增」按钮，就能建立第一条关系；
                  也可以直接去人物页补充。
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <PageScaffold
      title="关系图谱"
      description={booted ? characters.length + " 位角色 · " + relationships.length + " 条关系" : "正在读取…"}
      actions={
        <Button variant="outline" onPress={() => setLayoutNonce((n) => n + 1)} isDisabled={characters.length < 2}>
          <RefreshCw className="size-4" />
          重新布局
        </Button>
      }
    >
      {body()}
    </PageScaffold>
  );
}
