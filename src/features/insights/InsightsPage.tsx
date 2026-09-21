import { useState } from "react";
import { useParams } from "react-router-dom";
import { Tabs } from "@heroui/react";
import { PageScaffold } from "@/components/common/PageScaffold";
import { Loading } from "@/components/common/ui";
import { useChapters, useProject } from "@/app/hooks";
import { formatWords } from "@/utils/format";
import { WritingTrend } from "./WritingTrend";
import { MetricsCurve } from "./MetricsCurve";
import { StyleFingerprintPanel } from "./StyleFingerprintPanel";
import { LocalAuditPanel } from "./LocalAuditPanel";
import { MacroAuditPanel } from "./MacroAuditPanel";
import { useSettle } from "./helpers";

const TABS = [
  { key: "trend", label: "写作趋势" },
  { key: "metrics", label: "章节指标" },
  { key: "style", label: "文风指纹" },
  { key: "audit", label: "AI 味体检" },
  { key: "macro", label: "宏观审计" },
];

/** 写作分析页：趋势 / 指标曲线 / 文风指纹 / AI 味体检 / 宏观审计 */
export function InsightsPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const project = useProject(projectId);
  const chapters = useChapters(projectId);
  const settled = useSettle();
  const [tab, setTab] = useState("trend");

  const totalWords = chapters.reduce((a, c) => a + c.wordCount, 0);

  if (!project || !settled) {
    return (
      <PageScaffold title="写作分析" description="正在读取数据…" withNav>
        <Loading label="正在打开分析面板…" />
      </PageScaffold>
    );
  }

  return (
    <PageScaffold title="写作分析" description={chapters.length + " 章 · " + formatWords(totalWords)} withNav>
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

          <Tabs.Panel id="trend">
            <WritingTrend projectId={projectId} chapters={chapters} />
          </Tabs.Panel>
          <Tabs.Panel id="metrics">
            <MetricsCurve projectId={projectId} chapters={chapters} />
          </Tabs.Panel>
          <Tabs.Panel id="style">
            <StyleFingerprintPanel projectId={projectId} chapters={chapters} />
          </Tabs.Panel>
          <Tabs.Panel id="audit">
            <LocalAuditPanel projectId={projectId} chapters={chapters} />
          </Tabs.Panel>
          <Tabs.Panel id="macro">
            <MacroAuditPanel projectId={projectId} chapters={chapters} />
          </Tabs.Panel>
        </Tabs>
      </div>
    </PageScaffold>
  );
}
