import { useCallback, useEffect, useState } from "react";
import { Button, Chip, Modal } from "@heroui/react";
import { RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import type { Character, CharacterVoice } from "@/core";
import { runJson, systemWithProject } from "@/ai/runner";
import { Loading } from "@/components/common/ui";
import { useAppStore } from "@/app/store";
import { SENTENCE_LENGTH_LABEL, splitTags } from "./meta";

/**
 * AI 补全人物卡：把缺失字段一次性生成出来，用 diff 式预览让作者逐条勾选。
 * 只通过 runJson 调模型，写库由父组件用 updateCharacter 完成。
 */

type Suggestion = Record<string, unknown>;
type SentenceLength = "short" | "medium" | "long";

const PROFILE_FIELDS: { field: string; label: string; hint?: string }[] = [
  { field: "tagline", label: "一句话定位", hint: "20 字以内" },
  { field: "appearance", label: "外貌" },
  { field: "personality", label: "性格" },
  { field: "want", label: "欲望（表层想要）", hint: "他嘴上说要什么" },
  { field: "need", label: "需要（深层缺失）", hint: "他真正缺什么" },
  { field: "fear", label: "恐惧" },
  { field: "flaw", label: "缺陷" },
  { field: "arc", label: "人物弧光", hint: "从什么状态走到什么状态" },
];

const VOICE_FIELDS: { field: keyof CharacterVoice; label: string; kind: RowKind; hint?: string }[] = [
  { field: "tone", label: "语气", kind: "text" },
  { field: "register", label: "语域", kind: "text", hint: "日常 / 文雅 / 古风 / 粗俗…" },
  { field: "verbalTics", label: "口癖", kind: "list" },
  { field: "favoriteWords", label: "爱用词", kind: "list" },
  { field: "neverSays", label: "绝不会说的话", kind: "list" },
  { field: "sentenceLength", label: "句长偏好", kind: "sentenceLength" },
  { field: "sampleLines", label: "台词样例", kind: "list" },
  { field: "subtext", label: "潜台词习惯", kind: "text" },
];

type RowKind = "text" | "list" | "sentenceLength";

interface SuggestRow {
  key: string;
  group: "profile" | "voice";
  field: string;
  label: string;
  hint?: string;
  /** 数据库里的现值（展示用） */
  current: string;
  /** 建议值（展示用，可编辑） */
  suggestion: string;
  /** 应用时真正写入的值 */
  raw: unknown;
  kind: RowKind;
  checked: boolean;
}

const JSON_HINT = `只输出一个 JSON 对象，不要解释、不要代码块。结构：
{
  "tagline": "一句话定位，20 字以内",
  "appearance": "外貌，40-120 字",
  "personality": "性格，60-160 字",
  "want": "表层欲望，一句话",
  "need": "深层需要，一句话",
  "fear": "内心恐惧，一句话",
  "flaw": "致命缺陷，一句话",
  "arc": "人物弧光，60-150 字，写清从什么状态走到什么状态",
  "voice": {
    "tone": "语气，6-12 字",
    "register": "语域，如 日常口语 / 文雅书面 / 古风文言",
    "verbalTics": ["口癖 1", "口癖 2"],
    "favoriteWords": ["常用词 1", "常用词 2"],
    "neverSays": ["绝不会说的词或句式"],
    "sentenceLength": "short | medium | long",
    "sampleLines": ["能代表他说话方式的台词 1", "台词 2", "台词 3"],
    "subtext": "潜台词习惯，一句话"
  }
}`;

const SYSTEM_EXTRA = [
  "你是一位擅长人物塑造的资深小说编辑。",
  "任务：为作者已有的人物卡补齐缺失的设定字段，让它立体、可信、可直接用于写作。",
  "要求：",
  "1. 与已有设定（姓名、角色类型、定位、外貌、性格等）保持一致，不要自相矛盾；",
  "2. 全部使用简体中文，语气克制、具体，避免空话套话；",
  "3. 口吻卡的台词样例要真的像这个人说话，能体现他的身份、教养与处境；",
  "4. 已经写好的字段也给出更好的版本，作者会自行决定是否采用；",
  "5. 只输出 JSON。",
].join("\n");

function asText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join("、");
  return "";
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(asText).filter(Boolean);
  const text = asText(v);
  return text ? splitTags(text) : [];
}

function normalizeSentenceLength(v: unknown): SentenceLength | "" {
  const text = asText(v).toLowerCase();
  if (text === "short" || text.includes("短")) return "short";
  if (text === "long" || text.includes("长")) return "long";
  if (text === "medium" || text.includes("中") || text.includes("交替")) return "medium";
  return "";
}

function sentenceLengthText(v: unknown): string {
  const key = normalizeSentenceLength(v);
  return key ? SENTENCE_LENGTH_LABEL[key] : asText(v);
}

/** 把模型返回的 JSON 摊平成可勾选的行 */
function buildRows(data: Suggestion, c: Character): SuggestRow[] {
  const rows: SuggestRow[] = [];
  const source = c as unknown as Record<string, unknown>;

  for (const meta of PROFILE_FIELDS) {
    const value = asText(data[meta.field]);
    if (!value) continue;
    const current = asText(source[meta.field]);
    rows.push({
      key: "p:" + meta.field,
      group: "profile",
      field: meta.field,
      label: meta.label,
      hint: meta.hint,
      current,
      suggestion: value,
      raw: value,
      kind: "text",
      checked: !current,
    });
  }

  const voiceData = (data.voice ?? {}) as Record<string, unknown>;
  const existing = (c.voice ?? {}) as Record<string, unknown>;
  for (const meta of VOICE_FIELDS) {
    const from = voiceData[meta.field];
    let raw: unknown;
    let display: string;
    if (meta.kind === "list") {
      const list = asList(from);
      if (!list.length) continue;
      raw = list;
      display = list.join("、");
    } else if (meta.kind === "sentenceLength") {
      const key = normalizeSentenceLength(from);
      if (!key) continue;
      raw = key;
      display = SENTENCE_LENGTH_LABEL[key];
    } else {
      const text = asText(from);
      if (!text) continue;
      raw = text;
      display = text;
    }
    const current = meta.kind === "sentenceLength" ? sentenceLengthText(existing[meta.field]) : asText(existing[meta.field]);
    rows.push({
      key: "v:" + meta.field,
      group: "voice",
      field: meta.field,
      label: meta.label,
      hint: meta.hint,
      current,
      suggestion: display,
      raw,
      kind: meta.kind,
      checked: !current,
    });
  }

  return rows;
}

/** 勾选的行 -> updateCharacter 补丁 */
function buildPatch(rows: SuggestRow[], c: Character): Partial<Character> {
  const patch: Record<string, unknown> = {};
  const voice = { ...(c.voice ?? {}) } as Record<string, unknown>;
  let voiceTouched = false;

  for (const row of rows) {
    if (!row.checked) continue;
    if (row.group === "profile") {
      const text = asText(row.raw);
      if (!text) continue;
      patch[row.field] = text;
      continue;
    }
    if (row.kind === "list") {
      const list = Array.isArray(row.raw) ? (row.raw as string[]) : [];
      if (!list.length) continue;
      voice[row.field] = list;
    } else if (row.kind === "sentenceLength") {
      const key = normalizeSentenceLength(row.raw);
      if (!key) continue;
      voice.sentenceLength = key;
    } else {
      const text = asText(row.raw);
      if (!text) continue;
      voice[row.field] = text;
    }
    voiceTouched = true;
  }

  if (voiceTouched) patch.voice = voice as CharacterVoice;
  return patch as Partial<Character>;
}

export function AiFillDialog({
  open,
  onOpenChange,
  projectId,
  character,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  character: Character;
  onApplied: (patch: Partial<Character>) => Promise<void> | void;
}) {
  const notify = useAppStore((s) => s.notify);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [rows, setRows] = useState<SuggestRow[]>([]);
  const [error, setError] = useState<string>("");
  const [model, setModel] = useState("");

  const run = useCallback(async () => {
    setRunning(true);
    setError("");
    try {
      const system = await systemWithProject(projectId, SYSTEM_EXTRA);
      const res = await runJson<Suggestion>({
        taskKind: "character-arc",
        projectId,
        system,
        user: userPrompt(character),
        jsonSchemaHint: JSON_HINT,
        params: { temperature: 0.7 },
        context: { projectId, sections: ["profile", "rules"] },
      });
      if (!res.ok) {
        setError(res.error ?? "模型调用失败");
        return;
      }
      const data = res.parsed?.ok ? res.parsed.data : undefined;
      if (!data || typeof data !== "object") {
        setError(res.parsed?.error ?? "模型返回的内容不是合法 JSON");
        return;
      }
      const next = buildRows(data, character);
      setModel(res.model);
      setRows(next);
      if (!next.length) setError("模型没有给出可用的建议字段，可以再试一次。");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [projectId, character]);

  // 打开即生成；已经有结果时保留，让作者决定要不要重新生成
  useEffect(() => {
    if (!open) return;
    if (rows.length) return;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (key: string, checked: boolean) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, checked } : r)));

  const edit = (key: string, text: string) =>
    setRows((list) =>
      list.map((r) =>
        r.key === key
          ? { ...r, suggestion: text, raw: r.kind === "list" ? splitTags(text) : text }
          : r,
      ),
    );

  const setAll = (mode: "all" | "empty" | "none") =>
    setRows((list) =>
      list.map((r) => ({ ...r, checked: mode === "all" ? true : mode === "none" ? false : !r.current })),
    );

  const checkedCount = rows.filter((r) => r.checked).length;

  const apply = async () => {
    if (!checkedCount) {
      notify("warning", "先勾选要采用的字段");
      return;
    }
    setApplying(true);
    try {
      const patch = buildPatch(rows, character);
      await onApplied(patch);
      notify("success", "已应用到人物卡", "共 " + checkedCount + " 个字段");
      onOpenChange(false);
      setRows([]);
    } catch (e) {
      notify("danger", "应用失败", e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onOpenChange={(next) => {
        if (!next && applying) return;
        onOpenChange(next);
      }}
    >
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog aria-label="AI 补全人物卡">
            <Modal.Header>
              <Modal.Heading>AI 补全人物卡</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {running ? (
                <Loading label={"正在为「" + character.name + "」补全设定…"} />
              ) : error ? (
                <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] p-3 text-xs leading-relaxed">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-rose-500" />
                  <div>
                    <p className="font-medium">没有拿到可用的结果</p>
                    <p className="mt-1 opacity-70">{error}</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] opacity-60">
                    <Chip size="sm" color="accent">
                      <Sparkles className="size-3" />
                      {model || "模型"}
                    </Chip>
                    <span>左边是现有设定，右边是建议值，可以直接改；勾选后才写入人物卡。</span>
                  </div>
                  <div className="max-h-[58vh] space-y-2.5 overflow-y-auto pr-1">
                    {rows.map((row) => (
                      <div key={row.key} className="rounded-lg border border-black/5 p-3 dark:border-white/5">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="checkbox"
                            className="size-4 accent-neutral-900"
                            checked={row.checked}
                            aria-label={"采用 " + row.label}
                            onChange={(e) => toggle(row.key, e.target.checked)}
                          />
                          <span className="text-sm font-medium">{row.label}</span>
                          {row.hint ? <span className="text-[11px] opacity-45">{row.hint}</span> : null}
                          {row.current ? (
                            <Chip size="sm" color="warning">
                              会覆盖现有内容
                            </Chip>
                          ) : (
                            <Chip size="sm" color="accent">
                              当前为空
                            </Chip>
                          )}
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-md bg-black/[0.03] p-2 dark:bg-white/[0.04]">
                            <p className="mb-1 text-[11px] opacity-45">现有</p>
                            <p className="text-xs leading-relaxed whitespace-pre-wrap opacity-70">
                              {row.current || "（空）"}
                            </p>
                          </div>
                          <div className="rounded-md bg-black/[0.05] p-2 ring-1 ring-neutral-900/15">
                            <p className="mb-1 text-[11px] text-neutral-700">AI 建议</p>
                            {row.kind === "sentenceLength" ? (
                              <select
                                className="w-full rounded-md border border-black/10 bg-white px-2 py-1 text-xs dark:border-white/10 dark:bg-neutral-900"
                                value={normalizeSentenceLength(row.raw)}
                                onChange={(e) => edit(row.key, e.target.value)}
                              >
                                <option value="short">{SENTENCE_LENGTH_LABEL.short}</option>
                                <option value="medium">{SENTENCE_LENGTH_LABEL.medium}</option>
                                <option value="long">{SENTENCE_LENGTH_LABEL.long}</option>
                              </select>
                            ) : (
                              <textarea
                                className="w-full resize-y rounded-md border border-black/10 bg-white px-2 py-1 text-xs leading-relaxed outline-none focus:border-black/40 dark:border-white/10 dark:bg-neutral-900"
                                rows={row.kind === "list" ? 2 : 3}
                                value={row.suggestion}
                                onChange={(e) => edit(row.key, e.target.value)}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Modal.Body>
            <Modal.Footer>
              <div className="flex flex-1 flex-wrap items-center gap-1.5">
                {!running && rows.length > 0 && (
                  <>
                    <Button size="sm" variant="ghost" onPress={() => setAll("empty")}>
                      只勾空缺
                    </Button>
                    <Button size="sm" variant="ghost" onPress={() => setAll("all")}>
                      全选
                    </Button>
                    <Button size="sm" variant="ghost" onPress={() => setAll("none")}>
                      全不选
                    </Button>
                    <Button size="sm" variant="ghost" isDisabled={running} onPress={() => void run()}>
                      <RefreshCw className="size-3.5" />
                      重新生成
                    </Button>
                  </>
                )}
              </div>
              <Button variant="ghost" size="sm" isDisabled={applying} onPress={() => onOpenChange(false)}>
                关闭
              </Button>
              <Button
                variant="primary"
                size="sm"
                isDisabled={running || !checkedCount}
                isPending={applying}
                onPress={() => void apply()}
              >
                应用选中 {checkedCount} 项
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/** 把已有设定写成提示词，明确告诉模型"哪些已经有了" */
function userPrompt(c: Character): string {
  const lines = [
    "【人物现状】",
    "姓名：" + c.name,
    c.aliases?.length ? "别名：" + c.aliases.join("、") : "",
    "角色类型：" + c.role,
    c.tagline ? "定位：" + c.tagline : "",
    c.age ? "年龄：" + c.age : "",
    c.gender ? "性别：" + c.gender : "",
    c.appearance ? "外貌：" + c.appearance : "外貌：（尚未填写）",
    c.personality ? "性格：" + c.personality : "性格：（尚未填写）",
    c.want ? "欲望：" + c.want : "欲望：（尚未填写）",
    c.need ? "需要：" + c.need : "需要：（尚未填写）",
    c.fear ? "恐惧：" + c.fear : "恐惧：（尚未填写）",
    c.flaw ? "缺陷：" + c.flaw : "缺陷：（尚未填写）",
    c.arc ? "弧光：" + c.arc : "弧光：（尚未填写）",
    c.background ? "背景：" + c.background : "",
    c.voice?.sampleLines?.length ? "已有台词样例：" + c.voice.sampleLines.join(" / ") : "口吻卡：（尚未填写）",
  ].filter(Boolean);

  return [
    lines.join("\n"),
    "",
    "【任务】补齐上面标着「尚未填写」的字段，并为已有内容的字段给出更好的版本。",
    "如果这个人物的角色类型是配角或龙套，设定可以更精简，但仍然要具体。",
  ].join("\n");
}
