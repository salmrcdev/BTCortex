import { gzipSync } from 'node:zlib';

// Minimal ustar writer for tests. Like the ZIP builder it happily writes
// hostile names, links and pax overrides, which is what the extraction tests
// need.

export interface TarEntrySpec {
  name: string;
  data?: string | Uint8Array;
  /** ustar type flag: '0' file, '5' folder, '1' hard link, '2' symbolic link, 'x' pax header, 'L' GNU long name. */
  type?: string;
  linkName?: string;
  /** Written in the ustar prefix field, to test long names. */
  prefix?: string;
  /** Corrupts the header checksum. */
  badChecksum?: boolean;
}

function field(target: Buffer, offset: number, length: number, value: string): void {
  target.write(value.slice(0, length), offset, length, 'utf8');
}

function header(entry: TarEntrySpec, size: number): Buffer {
  const block = Buffer.alloc(512);
  field(block, 0, 100, entry.name);
  field(block, 100, 8, '0000644\0');
  field(block, 108, 8, '0000000\0');
  field(block, 116, 8, '0000000\0');
  field(block, 124, 12, `${size.toString(8).padStart(11, '0')}\0`);
  field(block, 136, 12, '00000000000\0');
  block.fill(0x20, 148, 156);
  field(block, 156, 1, entry.type ?? '0');
  if (entry.linkName) field(block, 157, 100, entry.linkName);
  field(block, 257, 6, 'ustar\0');
  field(block, 263, 2, '00');
  if (entry.prefix) field(block, 345, 155, entry.prefix);
  let sum = 0;
  for (const byte of block) sum += byte;
  field(block, 148, 8, `${(entry.badChecksum ? sum + 1 : sum).toString(8).padStart(6, '0')}\0 `);
  return block;
}

/** A pax header block setting `path` (and optionally `size`) for the next entry. */
export function paxPath(path: string): TarEntrySpec {
  const record = (key: string, value: string) => {
    let length = key.length + value.length + 3;
    length += String(length).length;
    if (String(length).length !== String(length - String(length).length).length) length += 1;
    return `${String(length)} ${key}=${value}\n`;
  };
  return { name: 'PaxHeader', type: 'x', data: record('path', path) };
}

export function buildTarGz(entries: readonly TarEntrySpec[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : Buffer.from(entry.data ?? []);
    blocks.push(header(entry, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
