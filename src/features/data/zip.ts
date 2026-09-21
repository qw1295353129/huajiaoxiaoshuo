/**
 * 极简 ZIP 写入器（零依赖）。
 * 只实现 EPUB / DOCX 需要的子集：STORE（不压缩）+ 可选 DEFLATE（浏览器原生 CompressionStream）。
 * 不用第三方库的原因：桌面端要复用，且不想为导出功能引入打包体积与供应链风险。
 */

export interface ZipEntry {
  /** 包内路径，用 / 分隔，不要以 / 开头 */
  path: string;
  /** 文本内容（会被 UTF-8 编码） */
  text?: string;
  /** 二进制内容 */
  bytes?: Uint8Array;
  /** 是否压缩（mimetype 必须是 STORE） */
  compress?: boolean;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

function utf8(s: string): Uint8Array {
  return encoder.encode(s);
}

function dosDateTime(d = new Date()): { time: number; date: number } {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

/** 用浏览器原生 API 做 raw deflate（ZIP 需要的是 raw，不带 zlib 头） */
async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

interface PreparedEntry {
  nameBytes: Uint8Array;
  /** 实际写入的字节（压缩或未压缩） */
  data: Uint8Array;
  /** 未压缩原始字节数 —— 中央目录里的「未压缩大小」必须用它 */
  rawSize: number;
  compressed: boolean;
  crc: number;
  localOffset: number;
}

/** 生成 ZIP 字节流 */
export async function createZip(entries: ZipEntry[]): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const prepared: PreparedEntry[] = [];
  const { time, date } = dosDateTime();
  let offset = 0;

  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };

  for (const entry of entries) {
    const nameBytes = utf8(entry.path);
    const raw = entry.bytes ?? utf8(entry.text ?? '');
    let data = raw;
    let compressed = false;
    if (entry.compress !== false) {
      const deflated = await deflateRaw(raw);
      // 只有真的变小才用压缩
      if (deflated && deflated.length < raw.length) {
        data = deflated;
        compressed = true;
      }
    }
    // ZIP 规范：CRC-32 始终是**未压缩数据**的校验值（解压方解压后再比对）。
    // 写压缩数据的 CRC 会让所有解压工具报 Bad CRC-32。
    const crc = crc32(raw);

    const localOffset = offset;
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true); // UTF-8 文件名标志
    view.setUint16(8, compressed ? 8 : 0, true);
    view.setUint16(10, time, true);
    view.setUint16(12, date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, raw.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);
    push(header);
    push(data);

    prepared.push({ nameBytes, data, rawSize: raw.length, compressed, crc, localOffset });
  }

  const centralStart = offset;
  for (const p of prepared) {
    const rec = new Uint8Array(46 + p.nameBytes.length);
    const view = new DataView(rec.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, p.compressed ? 8 : 0, true);
    view.setUint16(12, time, true);
    view.setUint16(14, date, true);
    view.setUint32(16, p.crc, true);
    view.setUint32(20, p.data.length, true); // 压缩后大小
    view.setUint32(24, p.rawSize, true); // 未压缩大小（写成 p.data.length 是错的）
    view.setUint16(28, p.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, p.localOffset, true);
    rec.set(p.nameBytes, 46);
    push(rec);
  }

  const centralSize = offset - centralStart;
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, prepared.length, true);
  view.setUint16(10, prepared.length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralStart, true);
  push(end);

  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}

/** 仅供测试：暴露 CRC 与 raw deflate 以做单元校验 */
export function crc32ForTest(bytes: Uint8Array): number {
  return crc32(bytes);
}

export async function deflateRoundTripForTest(raw: Uint8Array): Promise<{ same: boolean; rawLen: number; deflatedLen: number }> {
  const deflated = await deflateRaw(raw);
  if (!deflated) return { same: false, rawLen: raw.length, deflatedLen: 0 };
  const back = typeof DecompressionStream === 'undefined'
    ? null
    : new Uint8Array(
        await new Response(new Blob([deflated as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer(),
      );
  const same = back !== null && back.length === raw.length && back.every((b, i) => b === raw[i]);
  return { same, rawLen: raw.length, deflatedLen: deflated.length };
}

/** EPUB 的 mimetype 必须是不压缩的第一个条目 —— 单独提供一个便捷入口 */
export async function createZipWithStoredFirst(stored: ZipEntry, rest: ZipEntry[]): Promise<Blob> {
  return createZip([{ ...stored, compress: false }, ...rest]);
}
