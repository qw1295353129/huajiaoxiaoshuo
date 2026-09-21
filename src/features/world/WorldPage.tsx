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
import { EntryEditor } from "./EntryEditor";
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
                  两栏比例是调过的：原来列表固定 320px、编辑器吃掉剩下的全部宽度
                  （1512 宽的屏上编辑器有 1152px，标题输入框横跨一整屏，很难看）。
                  现在列表固定 380px 并把剩余空间全部给它，编辑器收在上限 680px ——
                  表单双列展开后每列约 320px，是舒服的输入宽度；宽屏下多出来的空间
                  给列表，条目多了也更好扫。
                */}
                {/*
                  分栏从 xl（1280）才开始。最初用 lg（1024）时，1024 宽的屏上
                  固定 380px 的列表会把编辑区压到 348px —— 比不分栏还难用。
                  小屏改为上下排列：列表在上、编辑器在下，各自都能用满宽度。
                */}
                <div className="grid items-start gap-4 pt-3 xl:grid-cols-[380px_minmax(0,1fr)]">
                <div className="xl:sticky xl:top-0 xl:max-h-[calc(100dvh-13rem)] xl:overflow-y-auto xl:pr-1">
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

                <div className="min-w-0 xl:max-w-[680px]">
                  {creating || selected ? (
                    <EntryEditor
                      projectId={projectId}
                      entry={creating ? undefined : selected}
                      isNew={creating}
                      entries={entries}
                      titleIndex={titleIndex}
                      incoming={refMaps.incoming}
                      outgoing={refMaps.outgoing}
                      onSelect={handleSelect}
                      onSaved={(id) => {
                        setCreating(false);
                        setSelectedId(id);
                      }}
                      onDeleted={() => {
                        setCreating(false);
                        setSelectedId(undefined);
                      }}
                      onQuickCreate={handleQuickCreate}
                    />
                  ) : (
                    <EmptyHint
                      icon={<Sparkles className="size-8" />}
                      title={entries.length ? "从左侧选择一个条目" : "还没有世界观条目"}
                      description={
                        entries.length
                          ? "右侧可以编辑标题、别名、层级、正文与硬规则，正文里用 [[条目标题]] 就能互相引用。"
                          : "先把世界的地基搭起来：地理、力量体系、组织、历史。每个条目都可以带不可违反的硬规则。"
                      }
                      action={
                        <Button variant="primary" size="sm" onPress={startCreate}>
                          <Plus className="size-4" />
                          新建条目
                        </Button>
                      }
                    />
                  )}
                </div>
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
