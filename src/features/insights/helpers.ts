import { useEffect, useState } from "react";

/** 写作分析页共用的小工具。 */

/** 复制文本到剪贴板（带 execCommand 降级），返回是否成功。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 剪贴板权限被拒时走下面的降级路径
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

/**
 * 首帧后短暂延迟再返回 true。
 * 用于避免 dexie liveQuery 尚未回填时闪一下空状态。
 */
export function useSettle(ms = 120): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return settled;
}

/** 整数（带千分位） */
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("zh-CN");
}

/** 保留一位小数 */
export function fmt1(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return (Math.round(n * 10) / 10).toString();
}

/** 0.35 → "35%" */
export function fmtPct(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return "0%";
  return (v * 100).toFixed(digits) + "%";
}

/** "2026-03-01" → "3月1日" */
export function shortDate(key: string): string {
  const [, m, d] = key.split("-");
  if (!m || !d) return key;
  return Number(m) + "月" + Number(d) + "日";
}

/** 均值（空数组返回 0） */
export function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 总体标准差 */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) * (v - m))));
}

/** 数组是否含有有效数值 */
export function hasValues(values: number[]): boolean {
  return values.some((v) => Number.isFinite(v));
}
