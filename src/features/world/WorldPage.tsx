import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Tabs } from "@heroui/react";
import { Globe2, Layers, Plus, ShieldAlert, ShieldCheck, Sparkles, Users } from "lucide-react";
import type { ID, WorldCategory } from "@/core";
import { useAsync, useDebounced, useEntities, useGlossary, useProjects, useRules, useWorldEntries } from "@/app/hooks";
import { createWorldEntry, listWorldEntries } from "@/db/repo/world";
import { useAppStore } from "@/app/store";
import { WORLD_CATEGORY_LABELS } from "@/db/defaults";
import { PageScaffold } from "@/components/common/PageScaffold";
import { EmptyHint, Loading, StatCard } from "@/components/common/ui";
import { ConflictModal } from "./ConflictModal";
import { WorldGenDialog } from "./WorldGenDialog";
import { WorldEntryDialog } from "./WorldEntryDialog";
import { EntryList } from "./EntryList";
import { GlossaryTab } from "./GlossaryTab";
import { buildTitleIndex, computeRefMaps } from "./world-links";

const CATEGORY_TOTAL = Object.keys(WORLD_CATEGORY_LABELS).length;

/**
 * 世界观页：左侧分类导航 + 条目列表，右侧条目详情（字段 / 硬规则 / 双向链接），
 * 另有名词表标签页与规则冲突自检。
 */
export function WorldPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const projects = useProjects();
  const entries = useWorldEntries(projectId);
  const entities = useEntities(projectId);
  const glossary = useGlossary(projectId);
  const projectRules = useRules(projectId);
  const notify = useAppStore((s) => s.notify);

  const [tab, setTab] = useState<string>("entries");
  const [selectedId, setSelectedId] = useState<ID | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [category, setCategory] = useState<WorldCategory | "all">("all");
  const [rawQuery, setRawQuery] = useState("");
  const [treeMode, setTreeMode] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);

  /** 搜索防抖：大列表输入时不做无谓的重算 */
  const filterQuery = useDebounced(rawQuery, 220);
  /** 仅用于首屏加载态（订阅式 hook 无法区分「加载中」和「空」） */
  const worldRes = useAsync(() => listWorldEntries(projectId), [projectId], []);
  const loading = worldRes.loading;

  const titleIndex = useMemo(() => buildTitleIndex(entries), [entries]);
  const refMaps = useMemo(() => computeRefMaps(entries), [entries]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e] as const)), [entries]);

  /** 实际选中的条目：显式选择优先，其次回落到列表第一项（条目被删除时自动切换） */
  const activeId = creating ? undefined : selectedId && byId.has(selectedId) ? selectedId : entries[0]?.id;

  const stats = useMemo(() => {
    let rules = 0;
    let enabled = 0;
    const categories = new Set<WorldCategory>();
    for (const entry of entries) {
      categories.add(entry.category);
      for (const rule of entry.rules) {
        rules += 1;
        if (rule.enabled && rule.statement.trim()) enabled += 1;
      }
    }
    return {
      categories: categories.size,
      rules: rules,
      enabledRules: enabled,
      unconfirmed: entities.filter((e) => !e.confirmed).length,
    };
  }, [entries, entities]);

  const project = useMemo(() => (projects ?? []).find((p) => p.id === projectId), [projects, projectId]);

  function startCreate() {
    setTab("entries");
    setCreating(true);
  }

  function handleSelect(id: ID) {
    setCreating(false);
    setSelectedId(id);
  }

  /** 预览里点死链的「创建该条目」：只建条目，不打断当前编辑 */
  async function handleQuickCreate(title: string) {
    try {
      const created = await createWorldEntry(projectId, {
        title: title,
        category: category === "all" ? "custom" : category,
      });
      notify("success", "已创建条目《" + created.title + "》", "链接现在可以点击跳转了");
    } catch (e) {
      notify("danger", "创建失败", e instanceof Error ? e.message : String(e));
    }
  }

  if (projects === undefined) {
    return (
      <PageScaffold title="世界观" withNav>
        <Loading />
      </PageScaffold>
    );
  }

  if (!project) {
    return (
      <PageScaffold title="世界观" withNav>
        <EmptyHint title="作品不存在或已被删除" description="回到书库重新选择一部作品。" />
      </PageScaffold>
    );
  }

  const selected = activeId ? byId.get(activeId) : undefined;

  return (
    <PageScaffold
      title="世界观"
      description={
        entries.length + " 个条目 · " + stats.enabledRules + " 条生效规则 · 名词表 " + glossary.length + " 条"
      }
      actions={
        <>
          <Button variant="outline" size="sm" onPress={() => setGenOpen(true)}>
            <Sparkles className="size-4" />
            AI 生成条目
          </Button>
          <Button variant="outline" size="sm" onPress={() => setConflictOpen(true)}>
            <ShieldAlert className="size-4" />
            规则冲突自检
          </Button>
          <Button variant="primary" size="sm" onPress={startCreate}>
            <Plus className="size-4" />
            新建条目
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="世界观条目"
            value={entries.length}
            hint={"其中 " + entries.filter((e) => e.importance >= 4).length + " 个高重要度"}
            icon={<Globe2 className="size-4" />}
            tone="accent"
          />
          <StatCard label="已用分类" value={stats.categories} hint={"全部 " + CATEGORY_TOTAL + " 类"} icon={<Layers className="size-4" />} />
          <StatCard
            label="硬规则"
            value={stats.rules}
            hint={"启用 " + stats.enabledRules + " 条 · 会进入 AI 上下文"}
            icon={<ShieldCheck className="size-4" />}
            tone="success"
          />
          <StatCard
            label="未确认实体"
            value={stats.unconfirmed}
            hint={"共抽取 " + entities.length + " 个实体"}
            icon={<Users className="size-4" />}
            tone={stats.unconfirmed > 0 ? "warning" : "default"}
          />
        </div>

        <Tabs aria-label="世界观视图" selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
          <Tabs.ListContainer>
            <Tabs.List>
              <Tabs.Tab id="entries">世界观条目</Tabs.Tab>
              <Tabs.Tab id="glossary">名词表</Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          <Tabs.Panel id="entries">
            {loading ? (
              <Loading />
            ) : (
              <>
                {/*
                  条目列表**占满整页**，点击条目打开编辑弹窗。
                  之前是"列表 + 常驻编辑面板"两栏，怎么调比例都别扭：
                  编辑区一旦常驻，列表就永远要让出一大块横向空间，而浏览时根本不需要它。
                  现在浏览与编辑彻底分开 —— 浏览是全宽的，编辑是浮层。
                */}
                <div className="pt-3">
                  <EntryList
                    entries={entries}
                    selectedId={activeId}
                    category={category}
                    onCategory={setCategory}
                    rawQuery={rawQuery}
                    filterQuery={filterQuery}
                    onQuery={setRawQuery}
                    treeMode={treeMode}
                    onTreeMode={setTreeMode}
                    incoming={refMaps.incoming}
                    onCreate={startCreate}
                    onSelect={handleSelect}
                  />
                </div>
              </>
            )}
          </Tabs.Panel>

          <Tabs.Panel id="glossary">
            <div className="pt-3">
              <GlossaryTab projectId={projectId} glossary={glossary} entries={entries} />
            </div>
          </Tabs.Panel>
        </Tabs>
      </div>

      {/* 编辑弹窗：由 creating / selected 驱动，关掉就是纯浏览 */}
      <WorldEntryDialog
        /*
          用 selectedId 而不是 activeId 判断是否打开。
          activeId 会回退到 entries[0].id（那是为旧版右侧常驻面板设计的"默认显示第一条"），
          拿它驱动弹窗会导致**一进页面弹窗就自动打开**。
        */
        open={creating || Boolean(selectedId)}
        onClose={() => {
          setCreating(false);
          setSelectedId(undefined);
        }}
        projectId={projectId}
        entry={creating ? undefined : selected}
        isNew={creating}
        entries={entries}
        titleIndex={titleIndex}
        incoming={refMaps.incoming}
        outgoing={refMaps.outgoing}
        onSelect={handleSelect}
        onSaved={(id) => setSelectedId(id)}
        onDeleted={() => setSelectedId(undefined)}
        onQuickCreate={handleQuickCreate}
      />

      <WorldGenDialog
        open={genOpen}
        onOpenChange={setGenOpen}
        projectId={projectId}
        defaultCategory={category === "all" ? undefined : category}
      />

      <ConflictModal
        projectId={projectId}
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        entries={entries}
        projectRules={projectRules}
        onOpenEntry={(id) => {
          setConflictOpen(false);
          setTab("entries");
          handleSelect(id);
        }}
      />
    </PageScaffold>
  );
}
