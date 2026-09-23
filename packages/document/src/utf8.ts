export function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = [];

  for (const character of value) {
    let codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;

    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(
        0xc0 | (codePoint >>> 6),
        0x80 | (codePoint & 0x3f),
      );
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return Uint8Array.from(bytes);
}

export function decodeUtf8(bytes: Uint8Array): string {
  const result: string[] = [];

  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index]!;

    if (first <= 0x7f) {
      result.push(String.fromCodePoint(first));
      index += 1;
      continue;
    }

    if (first >= 0xc2 && first <= 0xdf) {
      const second = continuation(bytes, index + 1);
      result.push(
        String.fromCodePoint(((first & 0x1f) << 6) | (second & 0x3f)),
      );
      index += 2;
      continue;
    }

    if (first >= 0xe0 && first <= 0xef) {
      const second = continuation(bytes, index + 1);
      const third = continuation(bytes, index + 2);
      if (
        (first === 0xe0 && second < 0xa0) ||
        (first === 0xed && second >= 0xa0)
      ) {
        throw new TypeError("Invalid UTF-8");
      }

      result.push(
        String.fromCodePoint(
          ((first & 0x0f) << 12) |
            ((second & 0x3f) << 6) |
            (third & 0x3f),
        ),
      );
      index += 3;
      continue;
    }

    if (first >= 0xf0 && first <= 0xf4) {
      const second = continuation(bytes, index + 1);
      const third = continuation(bytes, index + 2);
      const fourth = continuation(bytes, index + 3);
      if (
        (first === 0xf0 && second < 0x90) ||
        (first === 0xf4 && second >= 0x90)
      ) {
        throw new TypeError("Invalid UTF-8");
      }

      result.push(
        String.fromCodePoint(
          ((first & 0x07) << 18) |
            ((second & 0x3f) << 12) |
            ((third & 0x3f) << 6) |
            (fourth & 0x3f),
        ),
      );
      index += 4;
      continue;
    }

    throw new TypeError("Invalid UTF-8");
  }

  return result.join("");
}

function continuation(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  if (value === undefined || (value & 0xc0) !== 0x80) {
    throw new TypeError("Invalid UTF-8");
  }
  return value;
}
