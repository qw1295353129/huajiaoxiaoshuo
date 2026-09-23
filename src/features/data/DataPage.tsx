import { useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Chip, Label, TextArea, TextField, Input } from "@heroui/react";
import { BookMarked, Download, FileJson, FileText, Upload, Database, AlertTriangle, Check } from "lucide-react";
import { PageScaffold } from "@/components/common/PageScaffold";
import { EmptyHint, SectionTitle, StatCard } from "@/components/common/ui";
import { useAppStore } from "@/app/store";
import { useChapters } from "@/app/hooks";
import { createChapter, deleteChapter, saveChapterContent, updateChapter } from "@/db/repo/outline";
import { recomputeProjectStats } from "@/db/repo/projects";
import { db } from "@/db/database";
import { formatWords } from "@/utils/format";
import { countWords } from "@/utils/text";
import {
  buildBackup, buildBibleMarkdown, downloadBlob, downloadText, exportProject,
  gzipText, previewTextImport, readTextFile, restoreBackup, BACKUP_FORMAT,
  type BackupFile, type ExportFormat, type ImportPreview,
} from "./exporters";

type Tab = "export" | "import" | "backup" | "bible";

export function DataPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const [tab, setTab] = useState<Tab>("export");
  const project = useAppStore((s) => s.project);

  return (
    <PageScaffold title="数据与导出" description={project?.title}>
      <div className="mb-5 flex gap-1.5">
        {([
          ["export", "导出作品"],
          ["import", "导入稿件"],
          ["backup", "备份与恢复"],
          ["bible", "故事圣经"],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              "rounded-lg px-3 py-1.5 text-sm transition " +
              (tab === key ? "bg-black/[0.06] font-medium dark:bg-white/10" : "opacity-60 hover:opacity-100")
            }
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "export" && <ExportTab projectId={projectId} />}
      {tab === "import" && <ImportTab projectId={projectId} />}
      {tab === "backup" && <BackupTab projectId={projectId} />}
      {tab === "bible" && <BibleTab projectId={projectId} />}
    </PageScaffold>
  );
}

function ExportTab({ projectId }: { projectId: string }) {
  const notify = useAppStore((s) => s.notify);
  const chapters = useChapters(projectId);
  const [format, setFormat] = useState<ExportFormat>("txt");
  const [includeTitles, setIncludeTitles] = useState(true);
  const [includeArcTitles, setIncludeArcTitles] = useState(true);
  const [includeSummaries, setIncludeSummaries] = useState(false);
  const [pageBreak, setPageBreak] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const run = async () => {
    setBusy(true);
    try {
      const bundle = await exportProject({
        projectId,
        format,
        includeTitles,
        includeArcTitles,
        includeSummaries,
        pageBreak,
        chapterIds: selected.length ? selected : undefined,
      });
      if (bundle.blob) downloadBlob(bundle.blob, bundle.filename);
      else downloadText(bundle.content ?? "", bundle.filename, bundle.mime);
      notify("success", "已导出 " + bundle.filename, formatWords(bundle.words));
    } catch (e) {
      notify("danger", "导出失败", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="章节" value={chapters.length} />
        <StatCard label="总字数" value={formatWords(chapters.reduce((n, c) => n + c.wordCount, 0))} />
        <StatCard label="已选章节" value={selected.length || "全部"} tone="accent" />
        <StatCard label="预计页数" value={Math.max(1, Math.round(chapters.reduce((n, c) => n + c.wordCount, 0) / 900))} hint="A4 五号字约 900 字/页" />
      </div>

      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <SectionTitle hint="epub 适合阅读器与自出版；docx 适合投稿给编辑；txt 最通用；md 适合 Obsidian/Notion；html 可打印成 PDF；json 是完整结构化备份">
          导出格式
        </SectionTitle>
        <div className="flex flex-wrap gap-2">
          {([
            ["txt", "纯文本 .txt", FileText],
            ["md", "Markdown .md", FileText],
            ["html", "网页 .html", FileText],
            ["epub", "电子书 .epub", BookMarked],
            ["docx", "Word .docx", FileText],
            ["json", "结构化 .json", FileJson],
          ] as [ExportFormat, string, typeof FileText][]).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFormat(key)}
              className={
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition " +
                (format === key
                  ? "border-black/40 bg-black/[0.05] font-medium"
                  : "border-black/10 hover:border-black/25 dark:border-white/15 dark:hover:border-white/30")
              }
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-2 text-xs">
          <Check2 label="包含章节标题" value={includeTitles} onChange={setIncludeTitles} />
          <Check2 label="包含卷名" value={includeArcTitles} onChange={setIncludeArcTitles} />
          <Check2 label="包含章节梗概" value={includeSummaries} onChange={setIncludeSummaries} />
          <Check2 label="章与章之间分页" value={pageBreak} onChange={setPageBreak} disabled={format !== "html"} />
        </div>

        <Button className="mt-4" variant="primary" isPending={busy} onPress={() => void run()}>
          <Download className="size-4" />
          导出
        </Button>
      </section>

      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <SectionTitle hint="不选则导出全部章节">选择章节</SectionTitle>
        {chapters.length === 0 ? (
          <EmptyHint title="还没有章节" description="先到写作页写点内容吧。" />
        ) : (
          <div className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
            {chapters.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={() =>
                    setSelected((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))
                  }
                  className="accent-neutral-900"
                />
                <span className="tabular w-8 opacity-45">{c.order + 1}</span>
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="tabular opacity-45">{c.wordCount} 字</span>
              </label>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Check2({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={"flex items-center gap-2 " + (disabled ? "opacity-40" : "cursor-pointer")}>
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-neutral-900"
      />
      {label}
    </label>
  );
}

function ImportTab({ projectId }: { projectId: string }) {
  const notify = useAppStore((s) => s.notify);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"append" | "replace">("append");

  const analyze = async (raw?: string) => {
    const source = raw ?? text;
    if (!source.trim()) return;
    const p = await previewTextImport(source, "导入作品");
    setPreview(p);
  };

  const onFile = async (file: File) => {
    const raw = await file.text();
    setText(raw);
    await analyze(raw);
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      // 删章 + 导入必须同事务：中途失败不能留下「删了一半」的状态。
      // 表清单须覆盖嵌套的 deleteChapter / createChapter / saveChapterContent 所需的全部表，
      // 嵌套事务才会并入此外层事务（Dexie 约定：transaction 传表数组）。
      let n = 0;
      await db.transaction(
        "rw",
        [
          db.chapters, db.chapterContents, db.snapshots, db.metrics, db.characterAppearances,
          db.comments, db.reviewSuggestions, db.entityMentions,
        ],
        async () => {
          if (mode === "replace") {
            const existing = await db.chapters.where("projectId").equals(projectId).toArray();
            for (const c of existing) await deleteChapter(c.id);
          }
          for (const c of preview.chapters) {
            const chapter = await createChapter(projectId, { title: c.title });
            await saveChapterContent(chapter.id, textToHtmlLocal(c.content), { touchStatus: false });
            await updateChapter(chapter.id, { status: "drafted", wordCount: countWords(c.content) });
            n += 1;
          }
        },
      );
      await recomputeProjectStats(projectId);
      notify("success", "已导入 " + n + " 章", formatWords(preview.totalWords));
      setPreview(null);
      setText("");
    } catch (e) {
      notify("danger", "导入失败", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <SectionTitle hint="把整本书粘进来自动切分章节，或上传 txt/md 文件">导入已有稿件</SectionTitle>
        <TextArea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"直接粘贴全文即可，系统会按「第X章」自动切分。也支持上传 txt / md 文件。"}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onPress={() => void analyze()}>
            识别章节
          </Button>
          <label className="cursor-pointer rounded-lg border border-black/10 px-3 py-1.5 text-xs transition hover:border-black/25 dark:border-white/15">
            上传文件
            <input
              type="file"
              accept=".txt,.md,.markdown,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </label>
          <span className="text-xs opacity-50">{text ? countWords(text) + " 字" : ""}</span>
        </div>
      </section>

      {preview && (
        <section className="rounded-xl border border-black/25 bg-black/[0.03] p-4">
          <SectionTitle hint={"共 " + preview.chapters.length + " 章 · " + formatWords(preview.totalWords)}>识别结果预览</SectionTitle>
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {preview.chapters.map((c, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-white/60 px-2.5 py-1.5 text-xs dark:bg-white/[0.04]">
                <span className="tabular w-8 opacity-45">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                <span className="tabular opacity-45">{c.words} 字</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input type="radio" checked={mode === "append"} onChange={() => setMode("append")} className="accent-neutral-900" />
              追加到现有章节之后
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} className="accent-rose-500" />
              替换现有全部章节
            </label>
            <Button size="sm" variant="primary" isPending={busy} onPress={() => void commit()}>
              <Check className="size-3.5" />
              确认导入
            </Button>
          </div>
          {mode === "replace" && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-600 dark:text-rose-400">
              <AlertTriangle className="size-3" />
              替换会删除当前作品的所有章节与正文，且无法撤销。
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function BackupTab({ projectId }: { projectId: string }) {
  const notify = useAppStore((s) => s.notify);
  const [busy, setBusy] = useState<string | null>(null);
  const [inspect, setInspect] = useState<BackupFile | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");

  const doBackup = async (scope: "all" | "project", compress: boolean) => {
    setBusy(compress ? "gz" : "json");
    try {
      const backup = await buildBackup(scope === "project" ? [projectId] : undefined);
      const json = JSON.stringify(backup);
      const stamp = new Date().toISOString().slice(0, 10);
      if (compress) {
        const blob = await gzipText(json);
        downloadBlob(blob, "huajiao-backup-" + stamp + ".json.gz");
      } else {
        downloadText(JSON.stringify(backup, null, 2), "huajiao-backup-" + stamp + ".json", "application/json");
      }
      notify("success", "备份已生成", Object.values(backup.counts).reduce((a, b) => a + b, 0) + " 条记录");
    } catch (e) {
      notify("danger", "备份失败", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <SectionTitle hint="建议每周做一次完整备份，存到本地磁盘或私有云">导出备份</SectionTitle>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" isPending={busy === "gz"} onPress={() => void doBackup("all", true)}>
            <Database className="size-4" />
            全部数据（压缩 .gz）
          </Button>
          <Button variant="outline" isPending={busy === "json"} onPress={() => void doBackup("all", false)}>
            全部数据（可读 .json）
          </Button>
          <Button variant="ghost" onPress={() => void doBackup("project", false)}>
            仅当前作品
          </Button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed opacity-55">
          备份包含全部作品、章节正文、人物卡、世界观、伏笔、AI 记录与设置。压缩包体积通常只有原稿的十分之一左右。
        </p>
      </section>

      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <SectionTitle hint="先选择文件查看内容，再决定覆盖还是合并">恢复备份</SectionTitle>
        <label className="inline-block cursor-pointer rounded-lg border border-black/10 px-3 py-2 text-sm transition hover:border-black/25 dark:border-white/15">
          <Upload className="mr-1.5 inline size-3.5" />
          选择备份文件
          <input
            type="file"
            accept=".json,.gz,application/json,application/gzip"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const raw = await readTextFile(f);
                const parsed = JSON.parse(raw) as BackupFile;
                if (parsed.format !== BACKUP_FORMAT && parsed.format !== "novelforge-backup") {
                  throw new Error("这不是花椒写作平台的备份文件");
                }
                setInspect(parsed);
              } catch (err) {
                notify("danger", "无法读取备份", err instanceof Error ? err.message : String(err));
              }
            }}
          />
        </label>

        {inspect && (
          <div className="mt-4 rounded-xl border border-black/25 bg-black/[0.03] p-3">
            <p className="text-xs font-medium">
              备份时间：{new Date(inspect.createdAt).toLocaleString("zh-CN")} · schema v{inspect.version}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] sm:grid-cols-4">
              {Object.entries(inspect.counts)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => (
                  <div key={k} className="flex items-center justify-between rounded bg-white/60 px-2 py-1 dark:bg-white/[0.05]">
                    <span className="opacity-55">{k}</span>
                    <span className="tabular">{n}</span>
                  </div>
                ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                <input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} className="accent-neutral-900" />
                合并（保留现有数据）
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} className="accent-rose-500" />
                覆盖（清空后恢复）
              </label>
              <Button
                size="sm"
                variant={mode === "replace" ? "danger" : "primary"}
                onPress={async () => {
                  if (mode === "replace" && !confirm("覆盖会清空当前所有数据，确定继续？")) return;
                  setBusy("restore");
                  try {
                    const res = await restoreBackup(inspect, { mode });
                    const total = Object.values(res.restored).reduce((a, b) => a + b, 0);
                    notify("success", "恢复完成", total + " 条记录");
                    setTimeout(() => location.reload(), 1200);
                  } catch (err) {
                    notify("danger", "恢复失败", err instanceof Error ? err.message : String(err));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                开始恢复
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function BibleTab({ projectId }: { projectId: string }) {
  const notify = useAppStore((s) => s.notify);
  const [md, setMd] = useState("");
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      const out = await buildBibleMarkdown(projectId);
      setMd(out);
      if (!out) notify("warning", "还没有可汇总的设定", "先去建人物卡与世界观条目");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <SectionTitle hint="把所有人物、世界观、伏笔、时间线与章节脉络汇总成一份可读文档，方便你自己校对或交给合作者">故事圣经</SectionTitle>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" isPending={busy} onPress={() => void generate()}>
            <BookMarked className="size-4" />
            生成故事圣经
          </Button>
          {md && (
            <>
              <Button variant="outline" onPress={() => downloadText(md, "故事圣经.md", "text/markdown;charset=utf-8")}>
                <Download className="size-4" />
                下载 Markdown
              </Button>
              <Button
                variant="ghost"
                onPress={async () => {
                  await navigator.clipboard.writeText(md);
                  notify("success", "已复制全文");
                }}
              >
                复制全文
              </Button>
            </>
          )}
        </div>
      </section>

      {md ? (
        <pre className="manuscript max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-xl border border-black/8 p-5 text-[13px] leading-relaxed dark:border-white/10">
          {md}
        </pre>
      ) : (
        <EmptyHint icon={<BookMarked className="size-7" />} title="还没有生成" description="点上面的按钮，把当前设定汇总成一份圣经文档。" />
      )}
    </div>
  );
}

function textToHtmlLocal(text: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const NL = String.fromCharCode(10);
  return text
    .split(NL)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => "<p>" + escape(l) + "</p>")
    .join("");
}

void TextField;
void Label;
void Input;
void Chip;