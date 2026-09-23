import { useState } from "react";
import { Button, Chip, Modal, TextArea } from "@heroui/react";
import { Globe2, Sparkles, TriangleAlert } from "lucide-react";
import type { ID, WorldCategory } from "@/core";
import { WORLD_CATEGORY_LABELS } from "@/db/defaults";
import { generateWorldEntries, type GeneratedWorldEntry } from "@/ai/cast-gen";
import { upsertWorldEntry } from "@/db/repo/world";
import { useAppStore } from "@/app/store";

/**
 * AI 生成一批世界观条目。
 *
 * 与「一句话成书」的分工：那边是五阶段流水线（会连带改书名、分卷、章节），
 * 这里只补世界观，不动其它任何东西。
 *
 * 交互沿用项目既有做法：先生成候选、勾选后再落库。
 * 落库走 upsertWorldEntry（按标题匹配），重复生成不会产生重复条目。
 */
export function WorldGenDialog({
  open,
  onOpenChange,
  projectId,
  defaultCategory,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: ID;
  /** 从某个分类进来时预选该类 */
  defaultCategory?: WorldCategory;
  onApplied?: () => void;
}) {
  const notify = useAppStore((s) => s.notify);
  const [instruction, setInstruction] = useState("");
  /** 字符串草稿：清空时不会被 || 回填，避免输入 1 变成 12/8 这类钳制错值 */
  const [countDraft, setCountDraft] = useState("3");
  const count = Math.max(1, Math.min(12, Number(countDraft) || 3));
  const [category, setCategory] = useState<WorldCategory | "auto">(defaultCategory ?? "auto");
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [rows, setRows] = useState<GeneratedWorldEntry[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [existingTitles, setExistingTitles] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [error, setError] = useState("");

  const run = async () => {
    setRunning(true);
    setError("");
    setRows([]);
    try {
      const res = await generateWorldEntries({
        projectId,
        instruction,
        count,
        category: category === "auto" ? undefined : category,
      });
      if (!res.ok) {
        setError(res.error ?? "生成失败");
        return;
      }
      setExistingTitles(res.existingTitles);
      setModel(res.model);
      setRows(res.entries);
      setChecked(res.entries.map((e) => e.title));
      if (!res.entries.length) setError("模型没有给出可用条目，可以换个说法再试一次。");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    let created = 0;
    let merged = 0;
    try {
      for (const row of rows) {
        if (!checked.includes(row.title)) continue;
        // upsertWorldEntry 按标题匹配：同名条目会被更新而不是新增
        await upsertWorldEntry(projectId, {
          title: row.title,
          category: row.category,
          body: row.body,
          importance: row.importance,
          tags: ["AI 建档"],
        });
        if (existingTitles.includes(row.title)) merged += 1;
        else created += 1;
      }
      notify(
        "success",
        "已加入 " + (created + merged) + " 个条目",
        merged ? created + " 个新建，" + merged + " 个同名已更新" : "可以到世界观页继续补规则",
      );
      onOpenChange(false);
      setRows([]);
      onApplied?.();
    } catch (e) {
      notify("danger", "写入失败", e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const reused = rows.filter((r) => existingTitles.includes(r.title));

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog aria-label="AI 生成世界观">
            <Modal.Header>
              <Modal.Heading>AI 生成世界观</Modal.Heading>
              <p className="mt-1 text-xs leading-relaxed opacity-55">
                按这本书的设定补条目。生成时会带上已有条目与人物，避免重复主题；
                结果先预览、勾选后才入库。同名条目会被更新，不会重复新增。
              </p>
            </Modal.Header>

            <Modal.Body>
              <div className="space-y-3">
                <div>
                  <p className="mb-1.5 text-xs font-medium">想要什么样的设定（可选）</p>
                  <TextArea
                    rows={2}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="例如：补一条有代价的传送方式；或：雾港的海禁制度怎么运作"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="flex items-center gap-1.5">
                    分类
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as WorldCategory | "auto")}
                      className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/15"
                    >
                      <option value="auto">按内容自动判断</option>
                      {(Object.keys(WORLD_CATEGORY_LABELS) as WorldCategory[]).map((c) => (
                        <option key={c} value={c}>
                          {WORLD_CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5">
                    生成
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={countDraft}
                      onChange={(e) => setCountDraft(e.target.value)}
                      onBlur={() => setCountDraft(String(Math.max(1, Math.min(12, Number(countDraft) || 3))))}
                      className="tabular w-14 rounded border border-black/10 bg-transparent px-1.5 py-0.5 text-center dark:border-white/15"
                    />
                    条
                  </label>
                  <Button className="ml-auto" size="sm" variant="primary" isPending={running} onPress={() => void run()}>
                    <Sparkles className="size-3.5" />
                    {rows.length ? "重新生成" : "开始生成"}
                  </Button>
                </div>

                {error && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-600 dark:text-rose-300">
                    {error}
                  </div>
                )}

                {reused.length > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                    <TriangleAlert className="mr-1 inline size-3" />
                    有 {reused.length} 个条目与已有同名（{reused.map((r) => r.title).join("、")}）：入库时只会更新，不会重复新增。
                  </div>
                )}

                {rows.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium">
                        生成结果 · 已选 {checked.length} / {rows.length}
                      </p>
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="ghost" onPress={() => setChecked(rows.map((r) => r.title))}>
                          全选
                        </Button>
                        <Button size="sm" variant="ghost" onPress={() => setChecked([])}>
                          全不选
                        </Button>
                      </div>
                    </div>
                    {rows.map((row) => (
                      <label
                        key={row.title}
                        className="flex cursor-pointer items-start gap-2 rounded-lg border border-black/8 px-3 py-2 dark:border-white/10"
                      >
                        <input
                          type="checkbox"
                          checked={checked.includes(row.title)}
                          onChange={() =>
                            setChecked((s) => (s.includes(row.title) ? s.filter((x) => x !== row.title) : [...s, row.title]))
                          }
                          className="mt-0.5 accent-neutral-900"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-medium">{row.title}</span>
                            <Chip size="sm" color="accent">
                              {WORLD_CATEGORY_LABELS[row.category] ?? row.category}
                            </Chip>
                            <Chip size="sm" color={row.importance >= 4 ? "success" : "default"}>
                              重要度 {row.importance}
                            </Chip>
                            {existingTitles.includes(row.title) && (
                              <Chip size="sm" color="warning">
                                同名将更新
                              </Chip>
                            )}
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed opacity-70">{row.body}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}

                {rows.length === 0 && !running && !error && (
                  <div className="rounded-xl border border-dashed border-black/10 px-4 py-8 text-center dark:border-white/15">
                    <Globe2 className="mx-auto mb-2 size-7 opacity-25" />
                    <p className="text-xs opacity-55">
                      点「开始生成」，模型会读这本书的人物与已有设定，优先补后续情节一定会用到的部分。
                    </p>
                  </div>
                )}
              </div>
            </Modal.Body>

            <Modal.Footer>
              {model && <span className="mr-auto text-[10px] opacity-40">{model}</span>}
              <Button size="sm" variant="ghost" onPress={() => onOpenChange(false)}>
                关闭
              </Button>
              <Button size="sm" variant="primary" isDisabled={!checked.length} isPending={applying} onPress={() => void apply()}>
                加入选中的 {checked.length} 条
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
