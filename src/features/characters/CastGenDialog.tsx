import { useState } from "react";
import { Button, Chip, Modal, TextArea } from "@heroui/react";
import { Sparkles, TriangleAlert, Users } from "lucide-react";
import type { ID } from "@/core";
import { ROLE_LABEL } from "./meta";
import { generateCharacters, type GeneratedCharacter } from "@/ai/cast-gen";
import { createCharacter, listCharacters, updateCharacter } from "@/db/repo/cast";
import { upsertGlossary } from "@/db/repo/world";
import { useAppStore } from "@/app/store";

/**
 * AI 生成一批人物。
 *
 * 与「一句话成书」的分工：那边是五阶段流水线（会连带改书名、分卷、章节），
 * 代价大；这里只补人物，不动其它任何东西 —— 作者常常只是"再给我两个反派"。
 *
 * 交互沿用项目里的既有做法：**先生成候选、勾选后再落库**，
 * 不让模型直接改数据库。落库时按名字匹配，重名则更新，重复生成不会产生重复人物。
 */
export function CastGenDialog({
  open,
  onOpenChange,
  projectId,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: ID;
  onApplied?: () => void;
}) {
  const notify = useAppStore((s) => s.notify);
  const [instruction, setInstruction] = useState("");
  const [count, setCount] = useState(3);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [rows, setRows] = useState<GeneratedCharacter[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [existingNames, setExistingNames] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [error, setError] = useState("");

  const run = async () => {
    setRunning(true);
    setError("");
    setRows([]);
    try {
      const res = await generateCharacters({ projectId, instruction, count });
      if (!res.ok) {
        setError(res.error ?? "生成失败");
        return;
      }
      setExistingNames(res.existingNames);
      setModel(res.model);
      setRows(res.characters);
      setChecked(res.characters.map((c) => c.name));
      if (!res.characters.length) setError("模型没有给出可用的人物，可以换个说法再试一次。");
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
      // 落库前重新读一次：生成期间作者可能在别处加过人物
      const current = await listCharacters(projectId);
      const byName = new Map(current.map((c) => [c.name, c]));
      for (const row of rows) {
        if (!checked.includes(row.name)) continue;
        const patch = {
          name: row.name,
          aliases: row.aliases,
          role: row.role,
          tagline: row.tagline,
          age: row.age,
          gender: row.gender,
          appearance: row.appearance,
          personality: row.personality,
          want: row.want,
          need: row.need,
          fear: row.fear,
          flaw: row.flaw,
          arc: row.arc,
          secrets: row.secrets,
          voice: row.voice,
          tags: ["AI 建档"],
        };
        const hit = byName.get(row.name);
        if (hit) {
          await updateCharacter(hit.id, patch);
          merged += 1;
        } else {
          const made = await createCharacter(projectId, patch);
          byName.set(made.name, made);
          created += 1;
        }
        // 主要人物名进名词表，后续一致性检查能直接用
        await upsertGlossary(projectId, row.name, row.aliases);
      }
      notify(
        "success",
        "已加入 " + (created + merged) + " 位人物",
        merged ? created + " 位新建，" + merged + " 位同名已更新" : "可以到人物页继续补细节",
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

  const reused = rows.filter((r) => existingNames.includes(r.name));

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog aria-label="AI 生成人物">
            <Modal.Header>
              <Modal.Heading>AI 生成人物</Modal.Heading>
              <p className="mt-1 text-xs leading-relaxed opacity-55">
                按这本书的设定补人物。生成时会带上已有的人物与大纲，避免重名与重复设计；
                结果先预览、勾选后才入库。已有的人物不会被删改。
              </p>
            </Modal.Header>

            <Modal.Body>
              <div className="space-y-3">
                <div>
                  <p className="mb-1.5 text-xs font-medium">想要什么样的人物（可选）</p>
                  <TextArea
                    rows={2}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="例如：两个立场相反的海禁执行者；或：补一个和主角有旧怨的导师"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs">
                  生成
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={count}
                    onChange={(e) => setCount(Math.max(1, Math.min(8, Number(e.target.value) || 3)))}
                    className="tabular w-14 rounded border border-black/10 bg-transparent px-1.5 py-0.5 text-center dark:border-white/15"
                  />
                  位
                  <Button className="ml-auto" size="sm" variant="primary" isPending={running} onPress={() => void run()}>
                    <Sparkles className="size-3.5" />
                    {rows.length ? "重新生成" : "开始生成"}
                  </Button>
                </label>

                {error && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-600 dark:text-rose-300">
                    {error}
                  </div>
                )}

                {reused.length > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                    <TriangleAlert className="mr-1 inline size-3" />
                    有 {reused.length} 位与已有人物同名（{reused.map((r) => r.name).join("、")}）：
                    入库时只更新那条记录，不会新增重复人物。
                  </div>
                )}

                {rows.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium">
                        生成结果 · 已选 {checked.length} / {rows.length}
                      </p>
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="ghost" onPress={() => setChecked(rows.map((r) => r.name))}>
                          全选
                        </Button>
                        <Button size="sm" variant="ghost" onPress={() => setChecked([])}>
                          全不选
                        </Button>
                      </div>
                    </div>
                    {rows.map((row) => (
                      <label
                        key={row.name}
                        className="flex cursor-pointer items-start gap-2 rounded-lg border border-black/8 px-3 py-2 dark:border-white/10"
                      >
                        <input
                          type="checkbox"
                          checked={checked.includes(row.name)}
                          onChange={() =>
                            setChecked((s) => (s.includes(row.name) ? s.filter((x) => x !== row.name) : [...s, row.name]))
                          }
                          className="mt-0.5 accent-violet-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-medium">{row.name}</span>
                            <Chip size="sm" color="accent">
                              {ROLE_LABEL[row.role] ?? row.role}
                            </Chip>
                            {existingNames.includes(row.name) && (
                              <Chip size="sm" color="warning">
                                同名将更新
                              </Chip>
                            )}
                            {row.aliases.length > 0 && (
                              <span className="text-[10px] opacity-50">别名 {row.aliases.join("、")}</span>
                            )}
                          </div>
                          {row.tagline && <p className="mt-0.5 text-[11px] opacity-70">{row.tagline}</p>}
                          <div className="mt-1 grid gap-x-4 gap-y-0.5 text-[11px] leading-relaxed opacity-65 sm:grid-cols-2">
                            {row.want && <span>想要：{row.want}</span>}
                            {row.need && <span>需要：{row.need}</span>}
                            {row.fear && <span>恐惧：{row.fear}</span>}
                            {row.flaw && <span>缺陷：{row.flaw}</span>}
                          </div>
                          {row.voice.sampleLines.length > 0 && (
                            <p className="mt-1 text-[11px] italic opacity-55">「{row.voice.sampleLines[0]}」</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                )}

                {rows.length === 0 && !running && !error && (
                  <div className="rounded-xl border border-dashed border-black/10 px-4 py-8 text-center dark:border-white/15">
                    <Users className="mx-auto mb-2 size-7 opacity-25" />
                    <p className="text-xs opacity-55">点「开始生成」，模型会读这本书的设定与已有人物，给出候选。</p>
                  </div>
                )}
              </div>
            </Modal.Body>

            <Modal.Footer>
              {model && <span className="mr-auto text-[10px] opacity-40">{model}</span>}
              <Button size="sm" variant="ghost" onPress={() => onOpenChange(false)}>
                关闭
              </Button>
              <Button
                size="sm"
                variant="primary"
                isDisabled={!checked.length}
                isPending={applying}
                onPress={() => void apply()}
              >
                加入选中的 {checked.length} 位
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
