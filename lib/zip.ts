// 极简 ZIP 打包器（STORE，不压缩）：零依赖，生成的 zip 可被 Windows / 7-Zip / Obsidian 正常读取。
// 文件名按 UTF-8 写入（general purpose bit 11）。

export interface ZipFileInput {
  /** zip 内路径，使用正斜杠，例如 "images/a.png" */
  path: string;
  data: Uint8Array;
  /** 修改时间（可选，默认当前时间） */
  date?: Date;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    const lookup = CRC_TABLE[(crc ^ b) & 0xff] ?? 0;
    crc = lookup ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2);
  const dosDate =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, date: dosDate };
}

const encoder = new TextEncoder();

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}
function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

interface CentralEntry {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

/**
 * 生成 ZIP 文件二进制。
 * @throws 当路径重复或路径非法时
 */
export function createZip(files: ZipFileInput[]): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  const centralEntries: CentralEntry[] = [];
  const seen = new Set<string>();

  let offset = 0;

  for (const file of files) {
    const path = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!path || path.includes('//')) {
      throw new Error(`非法的 zip 路径: ${file.path}`);
    }
    if (seen.has(path)) throw new Error(`zip 内存在重复路径: ${path}`);
    seen.add(path);

    const nameBytes = encoder.encode(path);
    const data = file.data;
    const crc = crc32(data);
    const { time, date } = dosDateTime(file.date ?? new Date());

    // ---- Local file header (30 bytes + name) ----
    const localHeader = new ArrayBuffer(30);
    const lh = new DataView(localHeader);
    writeU32(lh, 0, 0x04034b50);
    writeU16(lh, 4, 20); // version needed
    writeU16(lh, 6, 0x0800); // UTF-8 文件名
    writeU16(lh, 8, 0); // compression: store
    writeU16(lh, 10, time);
    writeU16(lh, 12, date);
    writeU32(lh, 14, crc);
    writeU32(lh, 18, data.length);
    writeU32(lh, 22, data.length);
    writeU16(lh, 26, nameBytes.length);
    writeU16(lh, 28, 0); // extra length

    localChunks.push(new Uint8Array(localHeader), nameBytes, data);
    centralEntries.push({
      nameBytes,
      crc,
      size: data.length,
      offset,
      time,
      date,
    });
    offset += 30 + nameBytes.length + data.length;
  }

  // ---- Central directory ----
  let centralSize = 0;
  for (const entry of centralEntries) {
    const cdHeader = new ArrayBuffer(46);
    const cd = new DataView(cdHeader);
    writeU32(cd, 0, 0x02014b50);
    writeU16(cd, 4, 20); // version made by
    writeU16(cd, 6, 20); // version needed
    writeU16(cd, 8, 0x0800); // UTF-8
    writeU16(cd, 10, 0); // store
    writeU16(cd, 12, entry.time);
    writeU16(cd, 14, entry.date);
    writeU32(cd, 16, entry.crc);
    writeU32(cd, 20, entry.size);
    writeU32(cd, 24, entry.size);
    writeU16(cd, 28, entry.nameBytes.length);
    writeU16(cd, 30, 0); // extra
    writeU16(cd, 32, 0); // comment
    writeU16(cd, 34, 0); // disk number
    writeU16(cd, 36, 0); // internal attrs
    writeU32(cd, 38, 0); // external attrs
    writeU32(cd, 42, entry.offset);
    centralChunks.push(new Uint8Array(cdHeader), entry.nameBytes);
    centralSize += 46 + entry.nameBytes.length;
  }

  // ---- End of central directory (22 bytes) ----
  const eocd = new ArrayBuffer(22);
  const eo = new DataView(eocd);
  writeU32(eo, 0, 0x06054b50);
  writeU16(eo, 4, 0);
  writeU16(eo, 6, 0);
  writeU16(eo, 8, centralEntries.length);
  writeU16(eo, 10, centralEntries.length);
  writeU32(eo, 12, centralSize);
  writeU32(eo, 16, offset);
  writeU16(eo, 20, 0);

  const all = [...localChunks, ...centralChunks, new Uint8Array(eocd)];
  const total = all.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const chunk of all) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}
