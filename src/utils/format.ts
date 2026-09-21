/** 展示层格式化工具。 */

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 100_000_000) return (n / 100_000_000).toFixed(2) + '亿';
  if (Math.abs(n) >= 10_000) return (n / 10_000).toFixed(n >= 100_000 ? 1 : 2) + '万';
  return n.toLocaleString('zh-CN');
}

export function formatWords(n: number): string {
  return formatNumber(n) + ' 字';
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return ms + 'ms';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + '秒';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分${s % 60 ? (s % 60) + '秒' : ''}`;
  const h = Math.floor(m / 60);
  return `${h}小时${m % 60 ? (m % 60) + '分' : ''}`;
}

export function formatRelative(iso?: string): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayKey(iso: string | number | Date): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 估算阅读时长（中文 400 字/分钟） */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 400));
}

export function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.max(0, (part / total) * 100));
}
