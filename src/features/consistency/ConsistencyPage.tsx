import { useState } from "react";
import { useParams } from "react-router-dom";
import { Tabs } from "@heroui/react";
import { PageScaffold } from "@/components/common/PageScaffold";
import { Loading } from "@/components/common/ui";
import { useChapters, useIssues, useProject } from "@/app/hooks";
import { IssueBoard, DEFAULT_FILTERS, type IssueFilters } from "./IssueBoard";
import { RunChecks } from "./RunChecks";
import { useSettle } from "./helpers";

const TABS = [
  { key: "board", label: "问题看板" },
  { key: "run", label: "运行检查" },
];

/** 一致性报告页：问题看板 + 运行检查 */
export function ConsistencyPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const project = useProject(projectId);
  const chapters = useChapters(projectId);
  const issues = useIssues(projectId);
  const settled = useSettle();
  const [tab, setTab] = useState("board");
  // 筛选条件放在页面上层，切换标签时不会丢失
  const [filters, setFilters] = useState<IssueFilters>({ ...DEFAULT_FILTERS });

  if (!project || !settled) {
    return (
      <PageScaffold title="一致性报告" description="正在读取问题库…" withNav>
        <Loading label="正在打开问题库…" />
      </PageScaffold>
    );
  }

  const open = issues.filter((i) => i.status === "open").length;
  const blocker = issues.filter((i) => i.status === "open" && i.severity === "blocker").length;

  return (
    <PageScaffold
      title="一致性报告"
      description={
        issues.length === 0
          ? "还没有检查记录 · " + chapters.length + " 章"
          : "待处理 " + open + " 条 · 阻断 " + blocker + " 条 · 共 " + issues.length + " 条记录"
      }
      withNav
    >
      <div className="mx-auto max-w-6xl">
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))} className="w-full">
          {/* 注意：Tabs.Indicator 需要外层 SharedElementTransition，这里不用，避免运行时崩溃 */}
          <Tabs.List className="mb-5">
            {TABS.map((t) => (
              <Tabs.Tab key={t.key} id={t.key}>
                {t.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>

          <Tabs.Panel id="board">
            <IssueBoard
              projectId={projectId}
              issues={issues}
              chapters={chapters}
              filters={filters}
              onFiltersChange={setFilters}
            />
          </Tabs.Panel>
          <Tabs.Panel id="run">
            <RunChecks projectId={projectId} chapters={chapters} />
          </Tabs.Panel>
        </Tabs>
      </div>
    </PageScaffold>
  );
}
