import { decodeUtf8 } from "./utf8.js";
import { crc32 } from "./zip.js";

export type StoredZipEntry = {
  path: string;
  data: Uint8Array;
  isDirectory: boolean;
};

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const STORED_METHOD = 0;
const ENCRYPTED_FLAG = 0x0001;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;
const MAX_ZIP_COMMENT_LENGTH = UINT16_MAX;

type CentralEntry = {
  path: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  isDirectory: boolean;
};

export function decodeStoredZip(archive: Uint8Array): StoredZipEntry[] {
  const endOffset = findEndOfCentralDirectory(archive);
  const entryCount = readUint16(archive, endOffset + 10);
  const centralSize = readUint32(archive, endOffset + 12);
  const centralOffset = readUint32(archive, endOffset + 16);

  if (
    entryCount === UINT16_MAX ||
    centralSize === UINT32_MAX ||
    centralOffset === UINT32_MAX
  ) {
    throw new Error("ZIP64 archives are not supported");
  }

  const diskNumber = readUint16(archive, endOffset + 4);
  const centralDisk = readUint16(archive, endOffset + 6);
  const entriesOnDisk = readUint16(archive, endOffset + 8);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error("Multi-disk ZIP archives are not supported");
  }

  if (
    centralOffset > endOffset ||
    centralSize > endOffset - centralOffset ||
    centralOffset + centralSize !== endOffset
  ) {
    throw new Error("Invalid ZIP central directory");
  }

  const centralEntries = readCentralDirectory(
    archive,
    centralOffset,
    centralSize,
    entryCount,
  );
  return readLocalEntries(archive, centralEntries, centralOffset);
}

function findEndOfCentralDirectory(archive: Uint8Array): number {
  if (archive.byteLength < 22) {
    throw new Error("Invalid ZIP archive: end record is missing");
  }

  const earliest = Math.max(
    0,
    archive.byteLength - 22 - MAX_ZIP_COMMENT_LENGTH,
  );

  for (let offset = archive.byteLength - 22; offset >= earliest; offset -= 1) {
    if (readUint32Unchecked(archive, offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }

    const commentLength = readUint16(archive, offset + 20);
    if (offset + 22 + commentLength === archive.byteLength) {
      return offset;
    }
  }

  throw new Error("Invalid ZIP archive: end record is missing");
}

function readCentralDirectory(
  archive: Uint8Array,
  centralOffset: number,
  centralSize: number,
  entryCount: number,
): CentralEntry[] {
  const entries: CentralEntry[] = [];
  const paths = new Set<string>();
  let offset = centralOffset;
  const end = centralOffset + centralSize;

  for (let index = 0; index < entryCount; index += 1) {
    requireRange(archive, offset, 46, "ZIP central directory entry");
    if (readUint32(archive, offset) !== CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
      throw new Error("Invalid ZIP central directory entry");
    }

    const flags = readUint16(archive, offset + 8);
    const method = readUint16(archive, offset + 10);
    const crc = readUint32(archive, offset + 16);
    const compressedSize = readUint32(archive, offset + 20);
    const uncompressedSize = readUint32(archive, offset + 24);
    const fileNameLength = readUint16(archive, offset + 28);
    const extraLength = readUint16(archive, offset + 30);
    const commentLength = readUint16(archive, offset + 32);
    const diskStart = readUint16(archive, offset + 34);
    const localHeaderOffset = readUint32(archive, offset + 42);
    const entryLength = 46 + fileNameLength + extraLength + commentLength;

    requireRange(archive, offset, entryLength, "ZIP central directory entry");
    if (offset + entryLength > end) {
      throw new Error("Invalid ZIP central directory size");
    }
    if (diskStart !== 0) {
      throw new Error("Multi-disk ZIP archives are not supported");
    }
    assertSupportedEntry(flags, method, compressedSize, uncompressedSize);

    const path = decodePath(
      archive.subarray(offset + 46, offset + 46 + fileNameLength),
    );
    assertArchivePath(path);
    if (paths.has(path)) {
      throw new Error(`Duplicate ZIP entry path: ${path}`);
    }
    paths.add(path);

    entries.push({
      path,
      flags,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDirectory: path.endsWith("/"),
    });
    offset += entryLength;
  }

  if (offset !== end) {
    throw new Error("Invalid ZIP central directory size");
  }

  return entries;
}

function readLocalEntries(
  archive: Uint8Array,
  centralEntries: readonly CentralEntry[],
  centralOffset: number,
): StoredZipEntry[] {
  const result: StoredZipEntry[] = [];
  const ranges: Array<{ start: number; end: number }> = [];

  for (const entry of centralEntries) {
    const offset = entry.localHeaderOffset;
    requireRange(archive, offset, 30, `ZIP local header for ${entry.path}`);

    if (readUint32(archive, offset) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`Invalid ZIP local header for ${entry.path}`);
    }

    const localFlags = readUint16(archive, offset + 6);
    const localMethod = readUint16(archive, offset + 8);
    const localCrc = readUint32(archive, offset + 14);
    const localCompressedSize = readUint32(archive, offset + 18);
    const localUncompressedSize = readUint32(archive, offset + 22);
    const fileNameLength = readUint16(archive, offset + 26);
    const extraLength = readUint16(archive, offset + 28);
    const headerLength = 30 + fileNameLength + extraLength;

    requireRange(archive, offset, headerLength, `ZIP local header for ${entry.path}`);
    const localPath = decodePath(
      archive.subarray(offset + 30, offset + 30 + fileNameLength),
    );
    if (localPath !== entry.path) {
      throw new Error(`ZIP local/central path mismatch for ${entry.path}`);
    }
    if (localMethod !== entry.method || (localFlags & ENCRYPTED_FLAG) !== 0) {
      throw new Error(`ZIP local/central metadata mismatch for ${entry.path}`);
    }

    if ((localFlags & DATA_DESCRIPTOR_FLAG) === 0) {
      if (
        localCrc !== entry.crc ||
        localCompressedSize !== entry.compressedSize ||
        localUncompressedSize !== entry.uncompressedSize
      ) {
        throw new Error(`ZIP local/central metadata mismatch for ${entry.path}`);
      }
    } else if (
      (localCompressedSize !== 0 && localCompressedSize !== entry.compressedSize) ||
      (localUncompressedSize !== 0 &&
        localUncompressedSize !== entry.uncompressedSize)
    ) {
      throw new Error(`ZIP local/central metadata mismatch for ${entry.path}`);
    }

    const dataStart = offset + headerLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (
      dataStart > centralOffset ||
      dataEnd > centralOffset ||
      dataEnd < dataStart
    ) {
      throw new Error(`ZIP entry data is out of bounds: ${entry.path}`);
    }

    ranges.push({ start: offset, end: dataEnd });
    const data = archive.slice(dataStart, dataEnd);
    if (crc32(data) !== entry.crc) {
      throw new Error(`ZIP entry CRC mismatch: ${entry.path}`);
    }
    if (entry.isDirectory && data.byteLength !== 0) {
      throw new Error(`ZIP directory entry contains data: ${entry.path}`);
    }

    result.push({
      path: entry.path,
      data,
      isDirectory: entry.isDirectory,
    });
  }

  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index]!.start < ranges[index - 1]!.end) {
      throw new Error("ZIP local entries overlap");
    }
  }

  return result;
}

function assertSupportedEntry(
  flags: number,
  method: number,
  compressedSize: number,
  uncompressedSize: number,
): void {
  if ((flags & ENCRYPTED_FLAG) !== 0) {
    throw new Error("Encrypted ZIP entries are not supported");
  }
  if (method !== STORED_METHOD) {
    throw new Error(`Unsupported ZIP compression method: ${method}`);
  }
  if (compressedSize !== uncompressedSize) {
    throw new Error("Invalid stored ZIP entry size");
  }
}

function decodePath(bytes: Uint8Array): string {
  try {
    return decodeUtf8(bytes);
  } catch {
    throw new Error("ZIP entry path is not valid UTF-8");
  }
}

function assertArchivePath(path: string): void {
  const isDirectory = path.endsWith("/");
  const value = isDirectory ? path.slice(0, -1) : path;
  const parts = value.split("/");

  if (
    value.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    /^[A-Za-z]:/.test(value) ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Invalid ZIP entry path: ${path}`);
  }
}

function requireRange(
  data: Uint8Array,
  offset: number,
  length: number,
  label: string,
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > data.byteLength ||
    length > data.byteLength - offset
  ) {
    throw new Error(`Invalid ${label}`);
  }
}

function readUint16(data: Uint8Array, offset: number): number {
  requireRange(data, offset, 2, "ZIP integer");
  return data[offset]! | (data[offset + 1]! << 8);
}

function readUint32(data: Uint8Array, offset: number): number {
  requireRange(data, offset, 4, "ZIP integer");
  return readUint32Unchecked(data, offset);
}

function readUint32Unchecked(data: Uint8Array, offset: number): number {
  return (
    data[offset]! |
    (data[offset + 1]! << 8) |
    (data[offset + 2]! << 16) |
    (data[offset + 3]! << 24)
  ) >>> 0;
}
