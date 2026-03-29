import "server-only";

type ZipEntryInput = {
  path: string;
  data: Buffer;
  modifiedAt?: Date;
};

type NormalizedZipEntry = {
  path: string;
  pathBytes: Buffer;
  data: Buffer;
  modifiedAt: Date;
};

const ZIP_VERSION = 20;
const ZIP_METHOD_STORE = 0;
const ZIP_UTF8_FLAG = 0x0800;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function normalizeEntryPath(rawPath: string): string {
  const source = String(rawPath || "").replace(/\\/g, "/").trim();
  const cleaned = source
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return cleaned || "file";
}

function clampDate(value: Date | undefined): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return new Date();
  const year = value.getFullYear();
  if (year < 1980) return new Date(1980, 0, 1, 0, 0, 0);
  if (year > 2107) return new Date(2107, 11, 31, 23, 59, 58);
  return value;
}

function dosDateTime(dateInput: Date): { dosDate: number; dosTime: number } {
  const date = clampDate(dateInput);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  return {
    dosDate: dosDate & 0xffff,
    dosTime: dosTime & 0xffff,
  };
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function normalizeEntries(entries: ZipEntryInput[]): NormalizedZipEntry[] {
  return entries.map((entry, index) => {
    const path = normalizeEntryPath(entry.path || `file-${index + 1}`);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || "");
    const modifiedAt = clampDate(entry.modifiedAt);
    const pathBytes = Buffer.from(path, "utf8");
    return {
      path,
      pathBytes,
      data,
      modifiedAt,
    };
  });
}

export function buildZipBuffer(entriesInput: ZipEntryInput[]): Buffer {
  const entries = normalizeEntries(entriesInput);
  if (!entries.length) {
    // Empty zip archive with only EOCD.
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    return eocd;
  }

  if (entries.length > 0xffff) {
    throw new Error("ZIP_TOO_MANY_ENTRIES");
  }

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const { dosDate, dosTime } = dosDateTime(entry.modifiedAt);
    const fileNameLength = entry.pathBytes.length;
    const dataLength = entry.data.length;
    const checksum = crc32(entry.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local header signature
    localHeader.writeUInt16LE(ZIP_VERSION, 4); // version needed
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6); // flags
    localHeader.writeUInt16LE(ZIP_METHOD_STORE, 8); // compression method
    localHeader.writeUInt16LE(dosTime, 10); // mod time
    localHeader.writeUInt16LE(dosDate, 12); // mod date
    localHeader.writeUInt32LE(checksum, 14); // crc32
    localHeader.writeUInt32LE(dataLength, 18); // compressed size
    localHeader.writeUInt32LE(dataLength, 22); // uncompressed size
    localHeader.writeUInt16LE(fileNameLength, 26); // file name length
    localHeader.writeUInt16LE(0, 28); // extra length

    localParts.push(localHeader, entry.pathBytes, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central directory header signature
    centralHeader.writeUInt16LE(ZIP_VERSION, 4); // version made by
    centralHeader.writeUInt16LE(ZIP_VERSION, 6); // version needed
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8); // flags
    centralHeader.writeUInt16LE(ZIP_METHOD_STORE, 10); // compression method
    centralHeader.writeUInt16LE(dosTime, 12); // mod time
    centralHeader.writeUInt16LE(dosDate, 14); // mod date
    centralHeader.writeUInt32LE(checksum, 16); // crc32
    centralHeader.writeUInt32LE(dataLength, 20); // compressed size
    centralHeader.writeUInt32LE(dataLength, 24); // uncompressed size
    centralHeader.writeUInt16LE(fileNameLength, 28); // file name length
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(localOffset, 42); // local header offset

    centralParts.push(centralHeader, entry.pathBytes);

    localOffset += localHeader.length + fileNameLength + dataLength;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const centralOffset = localOffset;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // central dir start disk
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralSize, 12); // central directory size
  eocd.writeUInt32LE(centralOffset, 16); // central directory offset
  eocd.writeUInt16LE(0, 20); // zip comment length

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}
