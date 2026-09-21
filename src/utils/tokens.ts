import { hasCJK } from './text';

/**
 * 估算 token 数。中文约 1 字 ≈ 0.9~1.1 token，英文约 4 字符 ≈ 1 token。
 * 这里用偏保守（略高）的估算，避免超上下文。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  if (hasCJK(text)) {
    const cjk = (text.match(/[\u3400-\u9fff\u3040-\u30ff]/g) ?? []).length;
    const rest = text.length - cjk;
    return Math.ceil(cjk * 1.05 + rest / 3.6);
  }
  return Math.ceil(text.length / 3.8);
}

/** 在 token 预算内从"优先级从高到低"的片段里挑选内容 */
export interface BudgetPiece {
  key: string;
  label: string;
  text: string;
  /** 优先级：数字越小越重要，永不被裁 */
  priority: number;
  /** 必选 */
  required?: boolean;
}

export interface BudgetResult {
  parts: { key: string; label: string; text: string; tokens: number; trimmed: boolean }[];
  used: number;
  dropped: string[];
}

export function fillBudget(pieces: BudgetPiece[], budget: number): BudgetResult {
  const sorted = [...pieces].sort((a, b) => a.priority - b.priority);
  const parts: BudgetResult['parts'] = [];
  const dropped: string[] = [];
  let used = 0;

  for (const p of sorted) {
    const t = estimateTokens(p.text);
    if (p.required || used + t <= budget) {
      parts.push({ key: p.key, label: p.label, text: p.text, tokens: t, trimmed: false });
      used += t;
      continue;
    }
    // 还剩余额：截断后塞进去（保头）
    const remain = budget - used;
    if (remain > 220 && t > remain) {
      const ratio = remain / t;
      const cut = Math.floor(p.text.length * ratio * 0.94);
      const head = p.text.slice(0, Math.max(0, cut));
      parts.push({ key: p.key, label: p.label, text: head + '\n……（此处因上下文预算被截断）', tokens: estimateTokens(head), trimmed: true });
      used += estimateTokens(head);
    } else {
      dropped.push(p.label);
    }
  }
  return { parts, used, dropped };
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1) + 'k';
  return (n / 1_000_000).toFixed(2) + 'M';
}
