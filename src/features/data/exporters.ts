import type { Chapter, ID, Project } from "@/core";
import { db } from "@/db/database";
import { listArcs, listChapters } from "@/db/repo/outline";
import { stripHtml } from "@/utils/text";

/** 导出与备份：全部在浏览器内完成，数据不经过任何服务器。 */

export type ExportFormat = "txt" | "md" | "html" | "json";

export interface ExportOptions {
  projectId: ID;
  format: ExportFormat;
  includeTitles: boolean;
  includeArcTitles: boolean;
  includeSummaries: boolean;
  chapterIds?: ID[];
  pageBreak: boolean;
  filename?: string;
}

export interface ExportBundle {
  filename: string;
  mime: string;
  content: string;
  words: number;
}

export async function exportProject(opts: ExportOptions): Promise<ExportBundle> {
  const project = await db.projects.get(opts.projectId);
  if (!project) throw new Error("作品不存在");
  const [arcs, allChapters] = await Promise.all([listArcs(opts.projectId), listChapters(opts.projectId)]);
  const chapters = opts.chapterIds?.length ? allChapters.filter((c) => opts.chapterIds!.includes(c.id)) : allChapters;

  const contents = new Map<ID, string>();
  for (const c of chapters) {
    const row = await db.chapterContents.get(c.id);
    contents.set(c.id, row ? row.text || stripHtml(row.html) : "");
  }

  const baseName = sanitizeFilename(opts.filename || project.title);
  const words = chapters.reduce((n, c) => n + c.wordCount, 0);

  if (opts.format === "txt") {
    return { filename: baseName + ".txt", mime: "text/plain;charset=utf-8", content: buildText(project, arcs, chapters, contents, opts), words };
  }
  if (opts.format === "md") {
    return { filename: baseName + ".md", mime: "text/markdown;charset=utf-8", content: buildMarkdown(project, arcs, chapters, contents, opts), words };
  }
  if (opts.format === "html") {
    return { filename: baseName + ".html", mime: "text/html;charset=utf-8", content: buildHtml(project, arcs, chapters, contents, opts), words };
  }
  return {
    filename: baseName + ".json",
    mime: "application/json;charset=utf-8",
    content: JSON.stringify(await buildBackup([opts.projectId]), null, 2),
    words,
  };
}

function buildText(
  project: Project,
  arcs: { id: ID; title: string }[],
  chapters: Chapter[],
  contents: Map<ID, string>,
  opts: ExportOptions,
): string {
  const out: string[] = [project.title];
  if (project.author) out.push("作者：" + project.author);
  if (project.logline) out.push("", project.logline);
  out.push("", "".padEnd(40, "="), "");

  let lastArc = "";
  for (const c of chapters) {
    if (opts.includeArcTitles && c.arcId && c.arcId !== lastArc) {
      const arc = arcs.find((a) => a.id === c.arcId);
      if (arc) out.push("", "【" + arc.title + "】", "");
      lastArc = c.arcId;
    }
    if (opts.includeTitles) out.push("", c.title, "");
    if (opts.includeSummaries && c.summary) out.push("（梗概：" + c.summary + "）", "");
    out.push(indent(contents.get(c.id) ?? ""), "");
  }
  return out.join("\n");
}

function buildMarkdown(
  project: Project,
  arcs: { id: ID; title: string; summary?: string }[],
  chapters: Chapter[],
  contents: Map<ID, string>,
  opts: ExportOptions,
): string {
  const out: string[] = ["# " + project.title];
  if (project.author) out.push("", "*作者：" + project.author + "*");
  if (project.logline) out.push("", "> " + project.logline);
  if (project.synopsis) out.push("", project.synopsis);
  out.push("", "---");

  let lastArc = "";
  for (const c of chapters) {
    if (opts.includeArcTitles && c.arcId && c.arcId !== lastArc) {
      const arc = arcs.find((a) => a.id === c.arcId);
      if (arc) {
        out.push("", "## " + arc.title);
        if (arc.summary) out.push("", arc.summary);
      }
      lastArc = c.arcId;
    }
    out.push("", "### " + c.title, "");
    if (opts.includeSummaries && c.summary) out.push("> " + c.summary, "");
    const body = contents.get(c.id) ?? "";
    out.push(
      body
        .split(/\n+/)
        .filter(Boolean)
        .map((p) => p.trim())
        .join("\n\n"),
    );
  }
  return out.join("\n");
}

function buildHtml(
  project: Project,
  arcs: { id: ID; title: string }[],
  chapters: Chapter[],
  contents: Map<ID, string>,
  opts: ExportOptions,
): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body: string[] = [];
  let lastArc = "";
  for (const c of chapters) {
    if (opts.includeArcTitles && c.arcId && c.arcId !== lastArc) {
      const arc = arcs.find((a) => a.id === c.arcId);
      if (arc) body.push('<h2 class="arc">' + esc(arc.title) + "</h2>");
      lastArc = c.arcId;
    }
    body.push('<section class="chapter' + (opts.pageBreak ? " page-break" : "") + '">');
    if (opts.includeTitles) body.push("<h3>" + esc(c.title) + "</h3>");
    if (opts.includeSummaries && c.summary) body.push('<p class="summary">' + esc(c.summary) + "</p>");
    body.push(
      (contents.get(c.id) ?? "")
        .split(/\n+/)
        .filter(Boolean)
        .map((p) => "<p>" + esc(p.trim()) + "</p>")
        .join("\n"),
    );
    body.push("</section>");
  }

  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>',
    "<title>" + esc(project.title) + "</title>",
    "<style>",
    "body{max-width:42em;margin:4rem auto;padding:0 1.5rem;font-family:'Songti SC','Source Han Serif SC',serif;font-size:17px;line-height:2;color:#1a1a1a}",
    "h1{font-family:system-ui,sans-serif;font-size:2rem;text-align:center}",
    ".logline{text-align:center;color:#666;font-style:italic;margin-bottom:3rem}",
    "h2.arc{font-family:system-ui,sans-serif;font-size:1.5rem;margin:4rem 0 2rem;text-align:center}",
    "h3{font-family:system-ui,sans-serif;font-size:1.15rem;margin:3rem 0 1.4rem}",
    "p{margin:0 0 1.1em;text-indent:2em}",
    ".summary{color:#777;font-size:.9em;font-style:italic}",
    ".page-break{page-break-before:always}",
    "@media print{body{margin:0;max-width:none}}",
    "</style></head><body>",
    "<h1>" + esc(project.title) + "</h1>",
    project.logline ? '<p class="logline">' + esc(project.logline) + "</p>" : "",
    body.join("\n"),
    "</body></html>",
  ].join("\n");
}

function indent(text: string): string {
  return text
    .split(/\n/)
    .map((line) => (line.trim() ? "\u3000\u3000" + line.trim() : ""))
    .join("\n");
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "未命名";
}

// ==================== 备份 / 恢复 ====================

export interface BackupFile {
  format: "novelforge-backup";
  version: number;
  createdAt: string;
  app: string;
  counts: Record<string, number>;
  data: Record<string, unknown[]>;
}

/** 全量备份：所有表导出为 JSON，可跨版本恢复 */
export async function buildBackup(projectIds?: ID[]): Promise<BackupFile> {
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const table of db.tables) {
    let rows = (await table.toArray()) as Record<string, unknown>[];
    if (projectIds?.length) {
      rows = rows.filter((r) => {
        if (table.name === "projects") return projectIds.includes(String(r.id));
        if (!("projectId" in r)) return true;
        return projectIds.includes(String(r.projectId));
      });
    }
    data[table.name] = rows;
    counts[table.name] = rows.length;
  }
  return {
    format: "novelforge-backup",
    version: db.verno,
    createdAt: new Date().toISOString(),
    app: "novelforge",
    counts,
    data,
  };
}

/** 浏览器原生 gzip 压缩（无第三方依赖） */
export async function gzipText(text: string): Promise<Blob> {
  if (typeof CompressionStream === "undefined") return new Blob([text], { type: "application/json" });
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

export async function readTextFile(file: File): Promise<string> {
  const isGzip = file.name.endsWith(".gz") || file.type.includes("gzip");
  if (!isGzip || typeof DecompressionStream === "undefined") return file.text();
  const stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export interface RestoreOptions {
  mode: "replace" | "merge";
}

export interface RestoreResult {
  restored: Record<string, number>;
  skipped: string[];
}

export async function restoreBackup(backup: BackupFile, opts: RestoreOptions): Promise<RestoreResult> {
  if (backup.format !== "novelforge-backup") throw new Error("这不是花椒的备份文件");
  const restored: Record<string, number> = {};
  const skipped: string[] = [];

  await db.transaction("rw", db.tables, async () => {
    if (opts.mode === "replace") {
      for (const table of db.tables) await table.clear();
    }
    for (const [name, rows] of Object.entries(backup.data)) {
      const table = db.table(name);
      if (!table) {
        skipped.push(name);
        continue;
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        restored[name] = 0;
        continue;
      }
      await table.bulkPut(rows);
      restored[name] = rows.length;
    }
  });

  return { restored, skipped };
}

// ==================== 纯文本导入 ====================

export interface ImportPreview {
  title: string;
  chapters: { title: string; content: string; words: number }[];
  totalWords: number;
}

export async function previewTextImport(text: string, fallbackTitle: string): Promise<ImportPreview> {
  const { splitIntoChapters, countWords } = await import("@/utils/text");
  const parts = splitIntoChapters(text);
  const chapters = parts.map((p, i) => ({
    title: p.title || "第" + (i + 1) + "章",
    content: p.content,
    words: countWords(p.content),
  }));
  return { title: fallbackTitle, chapters, totalWords: chapters.reduce((n, c) => n + c.words, 0) };
}

export async function buildBibleMarkdown(projectId: ID): Promise<string> {
  const { buildStoryBible } = await import("@/ai/extract");
  const bible = await buildStoryBible(projectId);
  return bible?.markdown ?? "";
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(content: string, filename: string, mime = "text/plain;charset=utf-8"): void {
  downloadBlob(new Blob([content], { type: mime }), filename);
}