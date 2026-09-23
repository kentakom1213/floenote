export type ZipEntry = {
  path: string;
  data: Uint8Array;
};

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION = 20;
const UTF8_FLAG = 0x0800;
const STORED_METHOD = 0;
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;
const textEncoder = new TextEncoder();

export function encodeStoredZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > UINT16_MAX) {
    throw new RangeError("ZIP contains too many entries");
  }

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    assertArchivePath(entry.path);

    const pathBytes = textEncoder.encode(entry.path);
    if (pathBytes.byteLength > UINT16_MAX) {
      throw new RangeError(`ZIP entry path is too long: ${entry.path}`);
    }
    if (entry.data.byteLength > UINT32_MAX) {
      throw new RangeError(`ZIP entry is too large: ${entry.path}`);
    }
    if (localOffset > UINT32_MAX) {
      throw new RangeError("ZIP archive exceeds the v1 size limit");
    }

    const crc = crc32(entry.data);
    const localHeader = new Uint8Array(30 + pathBytes.byteLength);
    writeUint32(localHeader, 0, LOCAL_FILE_HEADER_SIGNATURE);
    writeUint16(localHeader, 4, ZIP_VERSION);
    writeUint16(localHeader, 6, UTF8_FLAG);
    writeUint16(localHeader, 8, STORED_METHOD);
    writeUint16(localHeader, 10, DOS_TIME);
    writeUint16(localHeader, 12, DOS_DATE);
    writeUint32(localHeader, 14, crc);
    writeUint32(localHeader, 18, entry.data.byteLength);
    writeUint32(localHeader, 22, entry.data.byteLength);
    writeUint16(localHeader, 26, pathBytes.byteLength);
    writeUint16(localHeader, 28, 0);
    localHeader.set(pathBytes, 30);

    const centralHeader = new Uint8Array(46 + pathBytes.byteLength);
    writeUint32(centralHeader, 0, CENTRAL_DIRECTORY_HEADER_SIGNATURE);
    writeUint16(centralHeader, 4, ZIP_VERSION);
    writeUint16(centralHeader, 6, ZIP_VERSION);
    writeUint16(centralHeader, 8, UTF8_FLAG);
    writeUint16(centralHeader, 10, STORED_METHOD);
    writeUint16(centralHeader, 12, DOS_TIME);
    writeUint16(centralHeader, 14, DOS_DATE);
    writeUint32(centralHeader, 16, crc);
    writeUint32(centralHeader, 20, entry.data.byteLength);
    writeUint32(centralHeader, 24, entry.data.byteLength);
    writeUint16(centralHeader, 28, pathBytes.byteLength);
    writeUint16(centralHeader, 30, 0);
    writeUint16(centralHeader, 32, 0);
    writeUint16(centralHeader, 34, 0);
    writeUint16(centralHeader, 36, 0);
    writeUint32(centralHeader, 38, 0);
    writeUint32(centralHeader, 42, localOffset);
    centralHeader.set(pathBytes, 46);

    localParts.push(localHeader, entry.data);
    centralParts.push(centralHeader);
    localOffset += localHeader.byteLength + entry.data.byteLength;
  }

  const centralDirectory = concatBytes(centralParts);
  if (
    localOffset > UINT32_MAX ||
    centralDirectory.byteLength > UINT32_MAX ||
    localOffset + centralDirectory.byteLength > UINT32_MAX
  ) {
    throw new RangeError("ZIP archive exceeds the v1 size limit");
  }

  const end = new Uint8Array(22);
  writeUint32(end, 0, END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  writeUint16(end, 4, 0);
  writeUint16(end, 6, 0);
  writeUint16(end, 8, entries.length);
  writeUint16(end, 10, entries.length);
  writeUint32(end, 12, centralDirectory.byteLength);
  writeUint32(end, 16, localOffset);
  writeUint16(end, 20, 0);

  return concatBytes([...localParts, centralDirectory, end]);
}

function assertArchivePath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new TypeError(`Invalid ZIP entry path: ${path}`);
  }
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result;
}
