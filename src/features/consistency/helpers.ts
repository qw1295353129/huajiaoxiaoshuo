import { useEffect, useState } from "react";
import type { Issue, IssueKind, IssueSeverity } from "@/core";
import { ROUTES } from "@/app/routes";

/** 一致性报告页共用的小工具与文案表。 */

export const KIND_LABELS: Record<IssueKind, string> = {
  continuity: "前后矛盾",
  "character-voice": "人物口吻",
  timeline: "时间线",
  "world-rule": "世界观规则",
  "name-variant": "名词不统一",
  pov: "视角越界",
  style: "文风问题",
  pacing: "节奏问题",
  repetition: "自我重复",
  logic: "逻辑漏洞",
  foreshadow: "伏笔问题",
  grammar: "文字规范",
  sensitive: "敏感内容",
};

export const STATUS_LABELS: Record<Issue["status"], string> = {
  open: "待处理",
  fixed: "已修复",
  ignored: "已忽略",
  "false-positive": "误报",
};

export const STATUS_COLORS: Record<Issue["status"], "default" | "accent" | "success" | "warning" | "danger"> = {
  open: "warning",
  fixed: "success",
  ignored: "default",
  "false-positive": "default",
};

export const SOURCE_LABELS: Record<Issue["source"], string> = {
  rule: "规则检测",
  llm: "模型检测",
  heuristic: "本地启发式",
};

/** 展示顺序：越靠前越严重 */
export const SEVERITY_ORDER: IssueSeverity[] = ["blocker", "error", "warn", "info"];

export const SEVERITY_TITLES: Record<IssueSeverity, string> = {
  blocker: "阻断级（必须改，否则设定崩塌）",
  error: "严重（明显矛盾，读者能察觉）",
  warn: "警告（可疑，建议核对）",
  info: "提示（风格与规范建议）",
};

/** 复制文本到剪贴板（带 execCommand 降级），返回是否成功。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒时走降级路径
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 首帧后短暂延迟，避免 liveQuery 尚未回填时闪空状态 */
export function useSettle(ms = 120): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return settled;
}

export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("zh-CN");
}

export function fmtPct(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return "0%";
  return (v * 100).toFixed(digits) + "%";
}

/** 问题涉及章节的跳转地址：带上定位偏移与原文，写作页接手后可高亮定位 */
export function writeUrlWithQuote(projectId: string, chapterId: string, from?: number, to?: number, quote?: string): string {
  const params = new URLSearchParams();
  if (from !== undefined) params.set("from", String(from));
  if (to !== undefined) params.set("to", String(to));
  if (quote) params.set("quote", quote.slice(0, 120));
  const qs = params.toString();
  return ROUTES.write(projectId, chapterId) + (qs ? "?" + qs : "");
}
