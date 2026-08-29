const encoder = new TextEncoder();
const decoder = new TextDecoder();

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true); }
function u32(view: DataView, offset: number, value: number) { view.setUint32(offset, value >>> 0, true); }

export type ZipEntryInput = { name: string; data: string | Uint8Array };

export function createStoreZip(entries: ZipEntryInput[]) {
  const normalized = entries.map((entry) => ({
    name: entry.name.replace(/^\/+/, ''),
    nameBytes: encoder.encode(entry.name.replace(/^\/+/, '')),
    bytes: typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data,
  }));

  let localSize = 0;
  for (const entry of normalized) localSize += 30 + entry.nameBytes.length + entry.bytes.length;
  let centralSize = 0;
  for (const entry of normalized) centralSize += 46 + entry.nameBytes.length;

  const total = localSize + centralSize + 22;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  const central: Array<{ entry: typeof normalized[number]; offset: number; crc: number }> = [];

  for (const entry of normalized) {
    const localOffset = offset;
    const crc = crc32(entry.bytes);
    u32(view, offset, 0x04034b50); offset += 4;
    u16(view, offset, 20); offset += 2;
    u16(view, offset, 0x0800); offset += 2; // UTF-8
    u16(view, offset, 0); offset += 2; // store
    u16(view, offset, 0); offset += 2;
    u16(view, offset, 0); offset += 2;
    u32(view, offset, crc); offset += 4;
    u32(view, offset, entry.bytes.length); offset += 4;
    u32(view, offset, entry.bytes.length); offset += 4;
    u16(view, offset, entry.nameBytes.length); offset += 2;
    u16(view, offset, 0); offset += 2;
    out.set(entry.nameBytes, offset); offset += entry.nameBytes.length;
    out.set(entry.bytes, offset); offset += entry.bytes.length;
    central.push({ entry, offset: localOffset, crc });
  }

  const centralOffset = offset;
  for (const item of central) {
    const { entry, crc } = item;
    u32(view, offset, 0x02014b50); offset += 4;
    u16(view, offset, 20); offset += 2;
    u16(view, offset, 20); offset += 2;
    u16(view, offset, 0x0800); offset += 2;
    u16(view, offset, 0); offset += 2;
    u16(view, offset, 0); offset += 2;
    u16(view, offset, 0); offset += 2;
    u32(view, offset, crc); offset += 4;
    u32(view, offset, entry.bytes.length); offset += 4;
    u32(view, offset, entry.bytes.length); offset += 4;
    u16(view, offset, entry.nameBytes.length); offset += 2;
    u16(view, offset, 0); offset += 2;
    u16(view, offset, 0); offset += 2;
    u16(view, offset, 0); offset += 2;
    u16(view, offset, 0); offset += 2;
    u32(view, offset, 0); offset += 4;
    u32(view, offset, item.offset); offset += 4;
    out.set(entry.nameBytes, offset); offset += entry.nameBytes.length;
  }

  const centralDirectorySize = offset - centralOffset;
  u32(view, offset, 0x06054b50); offset += 4;
  u16(view, offset, 0); offset += 2;
  u16(view, offset, 0); offset += 2;
  u16(view, offset, normalized.length); offset += 2;
  u16(view, offset, normalized.length); offset += 2;
  u32(view, offset, centralDirectorySize); offset += 4;
  u32(view, offset, centralOffset); offset += 4;
  u16(view, offset, 0);
  return out;
}

function findEocd(bytes: Uint8Array) {
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
  }
  return -1;
}

async function inflateRaw(bytes: Uint8Array) {
  if (!('DecompressionStream' in globalThis)) throw new Error('ZIP comprimido não é suportado neste navegador.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(bytes: Uint8Array) {
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new Error('conteudo.zip inválido.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Diretório ZIP inválido.');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`Entrada ZIP inválida: ${name}`);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let data: Uint8Array;
    if (method === 0) data = compressed;
    else if (method === 8) data = await inflateRaw(compressed);
    else throw new Error(`Método de compressão ZIP não suportado (${method}).`);
    if (uncompressedSize && data.length !== uncompressedSize) throw new Error(`Entrada ZIP corrompida: ${name}`);
    files.set(name, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

export function decodeZipText(bytes: Uint8Array) { return decoder.decode(bytes); }
