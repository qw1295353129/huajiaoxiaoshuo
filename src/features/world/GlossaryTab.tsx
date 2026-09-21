import { useMemo, useState } from "react";
import { Button, Card, Chip } from "@heroui/react";
import { Check, Pencil, Plus, ScanSearch, Trash2, X } from "lucide-react";
import type { GlossaryTerm, ID, WorldEntry } from "@/core";
import { deleteGlossary, upsertGlossary } from "@/db/repo/world";
import { useCharacters } from "@/app/hooks";
import { useAppStore } from "@/app/store";
import type { KnownName } from "@/utils/entity-scan";
import { normalizeForCompare } from "@/utils/text";
import { EmptyHint, Loading, SectionTitle } from "@/components/common/ui";
import { INPUT_CLASS } from "./world-labels";
import { parseTags } from "./world-links";
import { rowKey, scanProjectVariants, type VariantRow, type VariantScanResult } from "./glossary-scan";

interface Props {
  projectId: ID;
  glossary: GlossaryTerm[];
  entries: WorldEntry[];
}

const ROW_GRID = "grid grid-cols-1 gap-2 px-3 py-2.5 sm:grid-cols-[1.1fr_1.3fr_68px_1.1fr_92px] sm:items-center";

/** 名词表：统一标准写法与变体，并扫描正文找出可能的写错 */
export function GlossaryTab({ projectId, glossary, entries }: Props) {
  const notify = useAppStore((s) => s.notify);
  const characters = useCharacters(projectId);

  const [canonical, setCanonical] = useState("");
  const [variants, setVariants] = useState("");
  const [note, setNote] = useState("");
  const [strict, setStrict] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<ID | undefined>(undefined);
  const [edit, setEdit] = useState({ canonical: "", variants: "", note: "", strict: true });

  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<VariantScanResult | undefined>(undefined);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const sorted = useMemo(
    () => [...glossary].sort((a, b) => a.canonical.localeCompare(b.canonical, "zh")),
    [glossary],
  );

  /** 已登记的组合，用于过滤扫描结果里的重复项 */
  const registered = useMemo(() => {
    const set = new Set<string>();
    for (const term of glossary) {
      for (const variant of term.variants) set.add(rowKey(term.canonical, variant));
    }
    return set;
  }, [glossary]);

  const pendingRows = useMemo(() => {
    if (!scan) return [];
    return scan.rows.filter((row) => !registered.has(rowKey(row.canonical, row.variant)));
  }, [scan, registered]);

  async function handleAdd() {
    const name = canonical.trim();
    if (!name) {
      notify("warning", "请填写标准写法");
      return;
    }
    setSaving(true);
    try {
      await upsertGlossary(projectId, name, parseTags(variants), {
        strict: strict,
        // 留空表示不动已有备注（upsertGlossary 会保留原值）
        note: note.trim() || undefined,
      });
      notify("success", "已加入名词表", name);
      setCanonical("");
      setVariants("");
      setNote("");
      setStrict(true);
    } catch (e) {
      notify("danger", "保存失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(term: GlossaryTerm) {
    setEditingId(term.id);
    setEdit({
      canonical: term.canonical,
      variants: term.variants.join("、"),
      note: term.note ?? "",
      strict: term.strict,
    });
  }

  async function saveEdit(term: GlossaryTerm) {
    const nextCanonical = edit.canonical.trim();
    if (!nextCanonical) {
      notify("warning", "标准写法不能为空");
      return;
    }
    const nextVariants = parseTags(edit.variants);
    const renamed = normalizeForCompare(nextCanonical) !== normalizeForCompare(term.canonical);
    const variantsChanged =
      nextVariants.map(normalizeForCompare).sort().join(",") !== term.variants.map(normalizeForCompare).sort().join(",");
    try {
      if (renamed || variantsChanged) {
        // upsertGlossary 对变体做并集合并，删掉重建才能精确表达「移除某个变体」
        await deleteGlossary(term.id);
        await upsertGlossary(projectId, nextCanonical, nextVariants, {
          strict: edit.strict,
          note: edit.note.trim(),
        });
      } else {
        // 这里语义是精确编辑，备注清空就是清空（空串非 nullish，会覆盖原值）
        await upsertGlossary(projectId, nextCanonical, [], {
          strict: edit.strict,
          note: edit.note.trim(),
        });
      }
      notify("success", renamed ? "已重命名" : "已更新", nextCanonical);
      setEditingId(undefined);
    } catch (e) {
      notify("danger", "保存失败", e instanceof Error ? e.message : String(e));
    }
  }

  async function removeTerm(term: GlossaryTerm) {
    if (!window.confirm("从名词表移除「" + term.canonical + "」？")) return;
    await deleteGlossary(term.id);
    notify("success", "已移除", term.canonical);
  }

  async function toggleStrict(term: GlossaryTerm) {
    await upsertGlossary(projectId, term.canonical, [], { strict: !term.strict });
  }

  async function runScan() {
    setScanning(true);
    setAdded(new Set());
    try {
      // 先让 Loading 渲染出来，再做重活
      await new Promise((resolve) => setTimeout(resolve, 40));
      const names: KnownName[] = [];
      for (const c of characters) names.push({ id: c.id, name: c.name, aliases: c.aliases, kind: "character" });
      for (const e of entries) names.push({ id: e.id, name: e.title, aliases: e.aliases, kind: e.category });
      for (const g of glossary) names.push({ id: g.id, name: g.canonical, aliases: g.variants, kind: "glossary" });
      const result = await scanProjectVariants(projectId, names);
      setScan(result);
      notify(
        result.rows.length ? "info" : "success",
        result.rows.length ? "发现 " + result.rows.length + " 条可疑写法" : "没有发现可疑写法",
        "扫描 " + result.chapters + " 章 · " + result.chars + " 字",
      );
    } catch (e) {
      notify("danger", "扫描失败", e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  async function addVariant(row: VariantRow) {
    const key = rowKey(row.canonical, row.variant);
    try {
      await upsertGlossary(projectId, row.canonical, [row.variant]);
      setAdded((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      notify("success", "已加入名词表", row.canonical + " ← " + row.variant);
    } catch (e) {
      notify("danger", "加入失败", e instanceof Error ? e.message : String(e));
    }
  }

  async function addAll() {
    const targets = pendingRows.filter((row) => !added.has(rowKey(row.canonical, row.variant)));
    for (const row of targets) await addVariant(row);
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <SectionTitle hint="统一同一概念的各种叫法，AI 生成时会按标准写法落笔（名词表会进入 AI 上下文）">
          名词表 · {glossary.length} 条
        </SectionTitle>
        <div className="grid gap-2 sm:grid-cols-[1.1fr_1.3fr_1.1fr_auto]">
          <input
            value={canonical}
            onChange={(e) => setCanonical(e.target.value)}
            placeholder="标准写法，如：青云山"
            aria-label="标准写法"
            className={INPUT_CLASS}
          />
          <input
            value={variants}
            onChange={(e) => setVariants(e.target.value)}
            placeholder="变体/错误写法，逗号分隔，如：青去山、青云峰"
            aria-label="变体"
            className={INPUT_CLASS}
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="备注（可选）"
            aria-label="备注"
            className={INPUT_CLASS}
          />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 whitespace-nowrap text-xs opacity-70">
              <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
              强制统一
            </label>
            <Button variant="primary" size="sm" onPress={() => void handleAdd()} isPending={saving}>
              <Plus className="size-3.5" />
              添加
            </Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="px-4 pt-4">
          <SectionTitle hint="强制统一的写法会在校验与 AI 生成中被要求改正">词条</SectionTitle>
        </div>
        {sorted.length === 0 ? (
          <div className="px-4 pb-4">
            <EmptyHint
              title="名词表还是空的"
              description="把容易写混的名字登记进来，比如「青云山」不要写成「青去山」。也可以点下面的扫描按钮，让工具帮你找。"
            />
          </div>
        ) : (
          <div className="pb-2">
            <div className={ROW_GRID + " border-b border-black/5 text-[11px] font-medium uppercase tracking-wider opacity-45 dark:border-white/5"}>
              <span>标准写法</span>
              <span>变体</span>
              <span>强制</span>
              <span>备注</span>
              <span className="sm:text-right">操作</span>
            </div>
            {sorted.map((term) =>
              editingId === term.id ? (
                <div key={term.id} className={ROW_GRID + " border-b border-black/5 dark:border-white/5"}>
                  <input value={edit.canonical} onChange={(e) => setEdit({ ...edit, canonical: e.target.value })} className={INPUT_CLASS} aria-label="标准写法" />
                  <input value={edit.variants} onChange={(e) => setEdit({ ...edit, variants: e.target.value })} className={INPUT_CLASS} aria-label="变体" />
                  <label className="flex items-center gap-1.5 text-xs opacity-70">
                    <input type="checkbox" checked={edit.strict} onChange={(e) => setEdit({ ...edit, strict: e.target.checked })} />
                    强制
                  </label>
                  <input value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} className={INPUT_CLASS} aria-label="备注" />
                  <div className="flex items-center gap-1 sm:justify-end">
                    <Button size="sm" variant="primary" isIconOnly aria-label="保存" onPress={() => void saveEdit(term)}>
                      <Check className="size-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" isIconOnly aria-label="取消" onPress={() => setEditingId(undefined)}>
                      <X className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div key={term.id} className={ROW_GRID + " border-b border-black/5 text-sm last:border-b-0 dark:border-white/5"}>
                  <span className="min-w-0 truncate font-medium">{term.canonical}</span>
                  <span className="flex flex-wrap items-center gap-1">
                    {term.variants.length === 0 ? (
                      <span className="text-xs opacity-40">—</span>
                    ) : (
                      term.variants.map((v) => (
                        <span key={v} className="rounded bg-black/5 px-1 text-xs opacity-75 dark:bg-white/10">
                          {v}
                        </span>
                      ))
                    )}
                  </span>
                  <span>
                    <button
                      type="button"
                      onClick={() => void toggleStrict(term)}
                      title="点击切换是否强制统一"
                      className="inline-flex items-center"
                    >
                      {term.strict ? (
                        <Chip size="sm" color="success">
                          强制
                        </Chip>
                      ) : (
                        <Chip size="sm" color="default">
                          宽松
                        </Chip>
                      )}
                    </button>
                  </span>
                  <span className="truncate text-xs opacity-60">{term.note || "—"}</span>
                  <div className="flex items-center gap-1 sm:justify-end">
                    <Button size="sm" variant="ghost" isIconOnly aria-label="编辑" onPress={() => startEdit(term)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" isIconOnly aria-label="删除" onPress={() => void removeTerm(term)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <SectionTitle
          hint="在全部章节正文里比对人物名、世界观条目名与名词表，找出形近/不一致的写法"
          action={
            <div className="flex items-center gap-2">
              {scan && pendingRows.length > 1 && (
                <Button size="sm" variant="secondary" onPress={() => void addAll()}>
                  全部加入
                </Button>
              )}
              <Button size="sm" variant="outline" onPress={() => void runScan()} isPending={scanning}>
                <ScanSearch className="size-3.5" />
                扫描正文找变体
              </Button>
            </div>
          }
        >
          变体扫描
        </SectionTitle>

        {scanning ? (
          <Loading label="正在扫描全部章节…" />
        ) : !scan ? (
          <p className="py-2 text-xs leading-relaxed opacity-55">
            点击「扫描正文找变体」，工具会把已登记的人物名、世界观条目标题与名词表当成标准写法，在正文里找疑似写错或有别的叫法的地方。
            扫描只在本机进行，不消耗 token。
          </p>
        ) : pendingRows.length === 0 ? (
          <EmptyHint
            title={scan.rows.length > 0 ? "可疑写法都已登记" : "没有发现可疑写法"}
            description={
              "已扫描 " + scan.chapters + " 章 / " + scan.chars + " 字" + (scan.truncated ? "（正文体量较大，只扫描了前一部分）" : "")
            }
          />
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] opacity-50">
              已扫描 {scan.chapters} 章 / {scan.chars} 字
              {scan.truncated ? "（正文体量较大，只扫描了前面的部分）" : ""} · 找到 {pendingRows.length} 条待确认
            </p>
            <div className="space-y-1.5">
              {pendingRows.map((row) => (
                <div
                  key={rowKey(row.canonical, row.variant)}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-black/5 px-3 py-2 dark:border-white/5"
                >
                  <Chip size="sm" color={row.source === "alias" ? "accent" : "warning"}>
                    {row.source === "alias" ? "别名" : "疑似写错"}
                  </Chip>
                  <span className="text-sm">
                    <span className="font-medium">{row.variant}</span>
                    <span className="mx-1 opacity-45">→</span>
                    <span className="opacity-75">{row.canonical}</span>
                  </span>
                  <span className="tabular text-xs opacity-55">出现 {row.count} 次</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] opacity-45">{row.sample}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    isDisabled={added.has(rowKey(row.canonical, row.variant))}
                    onPress={() => void addVariant(row)}
                  >
                    {added.has(rowKey(row.canonical, row.variant)) ? "已加入" : "加入名词表"}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
