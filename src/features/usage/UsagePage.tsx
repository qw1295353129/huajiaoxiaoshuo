import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Button, Card, Chip } from "@heroui/react";
import { Activity, ArrowDownRight, ArrowUpRight, Coins, Sparkles } from "lucide-react";
import type { ModelPricing } from "@/core";
import { PageScaffold } from "@/components/common/PageScaffold";
import { EmptyHint, Loading, SectionTitle, StatCard } from "@/components/common/ui";
import { useAppStore } from "@/app/store";
import { ROUTES } from "@/app/routes";
import { listGenerations, usageSummary } from "@/db/repo/ai";
import { listPricing, listProviders } from "@/db/repo/settings";
import { formatNumber } from "@/utils/format";
import { formatTokens } from "@/utils/tokens";
import { DailyLine, TaskBars } from "./UsageCharts";
import { GenerationsTable } from "./GenerationsTable";
import { ModelPicker } from "./ModelPicker";

/** 估算成本：单价是可选的，没填就显示为「未计费」 */
function formatCost(value: number): string {
  if (!value) return "—";
  return value < 0.01 ? "¥" + value.toFixed(4) : "¥" + value.toFixed(2);
}

/** 单价说明 */
function PricingNote({ rows, onOpenSettings }: { rows: ModelPricing[]; onOpenSettings: () => void }) {
  if (rows.length === 0) {
    return (
      <Card className="border border-amber-500/30 bg-amber-500/[0.06] p-4">
        <div className="flex items-start gap-3">
          <Coins className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">成本暂时算不出来</p>
            <p className="mt-1 text-xs leading-relaxed opacity-70">
              这里还没有填写任何模型单价，所以「估算成本」一直为 0。在「设置 → 模型与 AI → 计费」里按
              「供应商::模型」填上每百万 token 的输入 / 输出单价，之后新的调用就会自动算钱。
            </p>
          </div>
          <Button size="sm" variant="outline" onPress={onOpenSettings}>
            去填写单价
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <SectionTitle hint="单位：元 / 百万 token；只对填写过单价的模型生效">已填写的模型单价</SectionTitle>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="min-w-0 flex-1 truncate">{row.key}</span>
            <span className="tabular opacity-60">输入 ¥{row.inputPerM}</span>
            <span className="tabular opacity-60">输出 ¥{row.outputPerM}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] opacity-45">
        成本是按用量 × 单价估算的，仅供参考；实际账单以供应商为准。
      </p>
    </Card>
  );
}

/** AI 用量：调用次数、token、成本与生成记录 */
export function UsagePage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const notify = useAppStore((s) => s.notify);

  const summary = useLiveQuery(() => (projectId ? usageSummary(projectId) : undefined), [projectId], undefined);
  const generations = useLiveQuery(() => (projectId ? listGenerations(projectId, 200) : []), [projectId], undefined);
  const providers = useLiveQuery(() => listProviders(), [], undefined);
  const pricing = useLiveQuery(() => listPricing(), [], undefined);

  const calls = summary?.calls ?? 0;
  const promptTokens = summary?.promptTokens ?? 0;
  const completionTokens = summary?.completionTokens ?? 0;
  const cost = summary?.cost ?? 0;
  const failed = (generations ?? []).filter((g) => !g.ok).length;

  return (
    <PageScaffold
      title="AI 用量"
      description="所有调用都记录在本机，不上传任何数据"
      actions={<Chip size="sm" color={failed > 0 ? "warning" : "default"}>{calls} 次调用</Chip>}
    >
      {summary === undefined ? (
        <Loading label="正在统计用量…" />
      ) : (
        <div className="mx-auto max-w-5xl space-y-5 pb-12">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="AI 调用次数"
              value={formatNumber(calls)}
              icon={<Activity className="size-4" />}
              hint={failed > 0 ? failed + " 次失败" : "全部成功"}
            />
            <StatCard
              label="Prompt tokens"
              value={formatTokens(promptTokens)}
              tone="accent"
              icon={<ArrowUpRight className="size-4" />}
              hint="送进模型的上下文"
            />
            <StatCard
              label="Completion tokens"
              value={formatTokens(completionTokens)}
              tone="accent"
              icon={<ArrowDownRight className="size-4" />}
              hint="模型写出来的内容"
            />
            <StatCard
              label="估算成本"
              value={formatCost(cost)}
              tone="warning"
              icon={<Coins className="size-4" />}
              hint={cost > 0 ? "按已填写的单价估算" : "还没有填写模型单价"}
            />
          </div>

          <ModelPicker
            providers={providers ?? []}
            activeProviderId={settings.activeProviderId}
            activeModel={settings.activeModel}
            onSelect={(providerId, model) => {
              updateSettings({ activeProviderId: providerId, activeModel: model });
              notify("success", "已切换当前模型", model);
            }}
            onOpenSettings={() => setSettingsOpen(true)}
          />

          {calls === 0 ? (
            <Card className="p-6">
              <EmptyHint
                icon={<Sparkles className="size-8" />}
                title="还没有 AI 调用记录"
                description="去 AI 工作室聊两句，或者用「一句话成书」生成故事圣经，所有用量都会自动统计在这里。"
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="primary" onPress={() => navigate(ROUTES.ai(projectId))}>
                      去 AI 工作室
                    </Button>
                    <Button variant="outline" onPress={() => navigate(ROUTES.genesis(projectId))}>
                      一句话成书
                    </Button>
                  </div>
                }
              />
            </Card>
          ) : (
            <>
              <div className="grid gap-4 xl:grid-cols-2">
                <TaskBars items={summary.byTask} />
                <DailyLine points={summary.byDay} />
              </div>
              <GenerationsTable rows={generations ?? []} />
            </>
          )}

          <PricingNote rows={pricing ?? []} onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      )}
    </PageScaffold>
  );
}
