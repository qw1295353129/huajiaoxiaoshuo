import { customAlphabet } from 'nanoid';

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

/** 带前缀的短 ID，便于日志里一眼看出类型 */
export function newId(prefix = 'id'): string {
  return `${prefix}_${nano()}`;
}

export function newIds(prefix: string, n: number): string[] {
  return Array.from({ length: n }, () => newId(prefix));
}
