import { useCallback, useEffect, useState } from "react";
import { Button, Card, Modal } from "@heroui/react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { auditForeshadowing } from "@/ai/analysis";
import { Loading } from "@/components/common/ui";
import { useAppStore } from "@/app/store";
import { DIVIDER_CLASS } from "./styles";

interface AuditFinding {
  title: string;
  problem: string;
  advice: string;
}

type AuditState = { kind: "idle" } | { kind: "loading" } | { kind: "done"; findings: AuditFinding[] } | { kind: "error"; message: string };

/** AI 伏笔审计：LLM 视角的风险补充（本地硬规则由 auditThreads 负责）。 */
export function ThreadAuditModal({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const notify = useAppStore((s) => s.notify);
  const [state, setState] = useState<AuditState>({ kind: "idle" });

  const run = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await auditForeshadowing(projectId);
      if (res.ok) setState({ kind: "done", findings: res.findings });
      else setState({ kind: "error", message: res.error });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [projectId]);

  // 打开弹窗时自动跑一次
  useEffect(() => {
    if (open && state.kind === "idle") void run();
  }, [open, run, state.kind]);

  const handleOpenChange = (next: boolean) => {
    if (!next) setState({ kind: "idle" });
    onOpenChange(next);
  };

  const findings = state.kind === "done" ? state.findings : [];

  return (
    <Modal isOpen={open} onOpenChange={handleOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>AI 伏笔审计</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {state.kind === "loading" && <Loading label="正在让结构编辑通读全部伏笔…" />}

              {state.kind === "error" && (
                <div className="rounded-lg bg-rose-500/[0.08] p-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-rose-600 dark:text-rose-300">
                    <TriangleAlert className="size-4" />
                    审计失败
                  </p>
                  <p className="mt-2 text-xs leading-relaxed opacity-70">{state.message}</p>
                  <p className="mt-2 text-[11px] leading-relaxed opacity-50">
                    请确认「设置 → 模型供应商」里已经配置了可用的模型与 API Key，然后重试。
                  </p>
                </div>
              )}

              {state.kind === "done" && findings.length === 0 && (
                <div className="rounded-lg bg-emerald-500/[0.08] p-4">
                  <p className="text-sm font-medium text-emerald-600 dark:text-emerald-300">没有发现明显风险</p>
                  <p className="mt-1.5 text-xs leading-relaxed opacity-70">
                    模型认为当前待回收的伏笔埋设与回收节奏都是合理的，可以放心继续写。
                  </p>
                </div>
              )}

              {state.kind === "done" && findings.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs opacity-55">共 {findings.length} 条风险提示，按重要性自行取舍。</p>
                  {findings.map((f, i) => (
                    <Card key={f.title + "-" + i} className="p-3.5">
                      <div className="flex items-start gap-2">
                        <span className="tabular mt-0.5 text-[11px] opacity-35">{String(i + 1).padStart(2, "0")}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{f.title || "（未命名伏笔）"}</p>
                          <p className="mt-1.5 text-xs leading-relaxed opacity-75">{f.problem}</p>
                          {f.advice && (
                            <p className={"mt-2 border-t pt-2 text-xs leading-relaxed text-violet-600 dark:text-violet-300 " + DIVIDER_CLASS}>
                              建议：{f.advice}
                            </p>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {state.kind === "idle" && <Loading label="准备中…" />}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => handleOpenChange(false)}>
                关闭
              </Button>
              <Button
                variant="outline"
                isPending={state.kind === "loading"}
                onPress={() => {
                  notify("info", "重新进行伏笔审计");
                  void run();
                }}
              >
                <RefreshCw className="size-4" />
                重新审计
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
