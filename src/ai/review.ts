import type { ChapterComment, ID } from "@/core";
import { BUILTIN_CHECKLIST } from "@/core";
import { db } from "@/db/database";
import { runJson, systemWithProject } from "./runner";
import { asArray, asString, pickStr } from "./json";

const NL = String.fromCharCode(10);

export interface ChecklistResult {
  id: string;
  label: string;
  pass: boolean;
  comment: string;
  /** 支撑判断的原文片段（模型必须逐字引用） */
  quote?: string;
  severity?: "info" | "warn" | "error";
}

/**
 * AI 审稿清单：按内置清单逐项检查本章，未通过的项会带上原文依据。
 * 结果由调用方决定落成批注还是仅展示。
 */
export async function verifyChecklist(opts: {
  projectId: ID;
  chapterId: ID;
  text?: string;
  signal?: AbortSignal;
  /** 只查这些清单项（默认全部逐章项） */
  itemIds?: string[];
}): Promise<{ ok: boolean; items: ChecklistResult[]; error?: string; model?: string }> {
  const content = opts.text ?? (await db.chapterContents.get(opts.chapterId))?.text ?? "";
  if (!content.trim()) return { ok: false, items: [], error: "本章还没有正文" };

  const items = BUILTIN_CHECKLIST.filter(
    (i) => (i.perChapter || i.scope === "book") && (!opts.itemIds || opts.itemIds.includes(i.id)),
  );

  const system = await systemWithProject(
    opts.projectId,
    [
      "你是一位极其挑剔的文学编辑，正在做退稿前的最后一遍检查。",
      "对每一项检查项，你都要给出明确结论：通过或不通过。",
      "判定不通过时，必须从原文里逐字摘录一句话作为证据，不得改写、不得拼凑。",
      "不要为了凑数而挑刺：真正通过的就判通过。宁可放过，不可诬告。",
    ].join(NL),
  );

  const user = [
    "### 待审正文",
    content.slice(0, 20000),
    "",
    "### 检查项",
    items.map((i) => "- " + i.id + "：" + i.label + (i.hint ? "（" + i.hint + "）" : "")).join(NL),
    "",
    "### 输出要求",
    "只输出 JSON，结构如下：",
    "{",
    '  "items": [',
    '    { "id": "检查项 id", "pass": true 或 false, "comment": "不通过时的具体说明，通过时留空", "quote": "不通过时的原文证据（逐字摘录）", "severity": "info|warn|error" }',
    "  ]",
    "}",
  ].join(NL);

  const res = await runJson({
    taskKind: "critique",
    projectId: opts.projectId,
    chapterId: opts.chapterId,
    system,
    user,
    jsonSchemaHint: "",
    // 审稿需要人物与设定背景，但不需要整本书的召回，控制预算
    context: {
      projectId: opts.projectId,
      chapterId: opts.chapterId,
      sections: ["profile", "characters", "rules"],
      budget: 6000,
    },
    signal: opts.signal,
  });

  if (!res.ok || !res.parsed?.ok) {
    return { ok: false, items: [], error: res.error ?? "解析失败", model: res.model };
  }
  const data = res.parsed.data as Record<string, unknown>;
  const raw = asArray<Record<string, unknown>>(data.items ?? data);
  const byId = new Map(items.map((i) => [i.id, i]));

  const out: ChecklistResult[] = [];
  for (const r of raw) {
    const id = pickStr(r, "id");
    const meta = byId.get(id);
    if (!meta) continue;
    const pass = r.pass === true || String(r.pass).toLowerCase() === "true";
    out.push({
      id,
      label: meta.label,
      pass,
      comment: asString(r.comment ?? r.detail),
      quote: asString(r.quote ?? r.evidence) || undefined,
      severity: (asString(r.severity) || "warn") as ChecklistResult["severity"],
    });
  }
  // 模型漏答的项按"通过"处理，不制造假问题
  for (const i of items) {
    if (!out.some((o) => o.id === i.id)) out.push({ id: i.id, label: i.label, pass: true, comment: "" });
  }
  return { ok: true, items: out, model: res.model };
}

/** 把一个一致性问题转成带锚点的批注（一致性报告页用） */
export function issueToCommentInput(issue: {
  projectId: ID;
  chapterId?: ID;
  id: ID;
  title: string;
  detail: string;
  suggestion?: string;
}): Omit<ChapterComment, "id" | "createdAt" | "updatedAt" | "replies" | "author" | "resolved"> | null {
  if (!issue.chapterId) return null;
  return {
    projectId: issue.projectId,
    chapterId: issue.chapterId,
    body: issue.title + (issue.detail ? NL + NL + issue.detail : "") + (issue.suggestion ? NL + NL + "建议：" + issue.suggestion : ""),
    kind: "issue",
    issueId: issue.id,
  };
}