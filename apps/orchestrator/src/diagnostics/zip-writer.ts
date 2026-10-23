import { crc32, deflateRawSync } from 'node:zlib';

// Minimal ZIP writer for diagnostic bundles: deflated files with UTF-8 names.
// No ZIP64: a bundle is limited to a few tens of mebibytes.

export interface ZipFile {
  name: string;
  data: Buffer | string;
  modifiedAt: Date;
}

const MAX_ZIP_BYTES = 0xffff_ffff;
const MAX_ZIP_ENTRIES = 0xffff;

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function writeZip(files: readonly ZipFile[]): Buffer {
  if (files.length > MAX_ZIP_ENTRIES) throw new Error('Too many files for a ZIP archive without ZIP64.');
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = typeof file.data === 'string' ? Buffer.from(file.data, 'utf8') : file.data;
    const compressed = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);
    const { time, date } = dosDateTime(file.modifiedAt);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, compressed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // made by: MS-DOS, version 2.0
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, name);

    offset += local.length + name.length + compressed.length;
    if (offset > MAX_ZIP_BYTES) throw new Error('The bundle is too large for a ZIP archive without ZIP64.');
  }

  const centralDirectory = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralDirectory, end]);
}
