export type ImageSourceKind =
  | "external-https"
  | "insecure-http"
  | "relative"
  | "unsafe";

export type MarkdownImageDescriptor = {
  marker: string;
  source: string;
  alt: string;
  title: string | null;
};

type ExtractedMarkdownImages = {
  html: string;
  images: readonly MarkdownImageDescriptor[];
};

const IMAGE_MARKER_PREFIX = "\uE100FLOEIMAGE";
const IMAGE_MARKER_SUFFIX = "\uE101";

export function classifyMarkdownImageSource(source: string): ImageSourceKind {
  const value = source.trim();

  if (!value || value.startsWith("//")) return "unsafe";

  if (/^https:\/\//iu.test(value)) {
    return isAbsoluteUrlWithProtocol(value, "https:")
      ? "external-https"
      : "unsafe";
  }

  if (/^http:\/\//iu.test(value)) {
    return isAbsoluteUrlWithProtocol(value, "http:")
      ? "insecure-http"
      : "unsafe";
  }

  if (/^[a-z][a-z0-9+.-]*:/iu.test(value)) return "unsafe";
  return "relative";
}

export function extractMarkdownImages(html: string): ExtractedMarkdownImages {
  const images: MarkdownImageDescriptor[] = [];
  let output = "";
  let cursor = 0;

  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart < 0) {
      output += html.slice(cursor);
      break;
    }

    output += html.slice(cursor, tagStart);
    const prefix = /^<\s*(\/?)\s*([a-z][a-z0-9:-]*)/iu.exec(
      html.slice(tagStart),
    );

    if (!prefix) {
      output += "<";
      cursor = tagStart + 1;
      continue;
    }

    const closing = prefix[1] === "/";
    const tagName = (prefix[2] ?? "").toLowerCase();
    const tagEnd = findTagEnd(html, tagStart);

    if (tagEnd < 0) {
      if (!closing && (tagName === "img" || tagName === "source")) break;
      output += html.slice(tagStart);
      break;
    }

    const rawTag = html.slice(tagStart, tagEnd + 1);

    if (!closing && tagName === "img") {
      const attributes = parseTagAttributes(rawTag);
      const marker =
        IMAGE_MARKER_PREFIX + String(images.length) + IMAGE_MARKER_SUFFIX;

      images.push({
        marker,
        source: decodeHtmlAttribute(attributes.get("src") ?? "").trim(),
        alt: decodeHtmlAttribute(attributes.get("alt") ?? ""),
        title: attributes.has("title")
          ? decodeHtmlAttribute(attributes.get("title") ?? "")
          : null,
      });
      output += marker;
    } else if (!closing && tagName === "source") {
      // Raw <source srcset=...> is another fetch path. Remove it before the
      // HTML reaches DOMPurify or DOMParser.
    } else {
      output += rawTag;
    }

    cursor = tagEnd + 1;
  }

  return { html: output, images };
}

function isAbsoluteUrlWithProtocol(
  value: string,
  protocol: "http:" | "https:",
): boolean {
  try {
    const url = new URL(value);
    return url.protocol === protocol && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function findTagEnd(html: string, start: number): number {
  let quote: '"' | "'" | null = null;

  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];

    if (quote) {
      if (character === quote) quote = null;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === ">") return index;
  }

  return -1;
}

function parseTagAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const opening = /^<\s*[a-z][a-z0-9:-]*/iu.exec(tag);
  if (!opening) return attributes;

  const body = tag.slice(opening[0].length, -1);
  const pattern =
    /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+)))?/gu;

  for (const match of body.matchAll(pattern)) {
    const name = (match[1] ?? "").toLowerCase();
    if (!name || attributes.has(name)) continue;
    attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }

  return attributes;
}

function decodeHtmlAttribute(value: string): string {
  return value.replace(
    /&(#(?:x[0-9a-f]+|[0-9]+)|amp|quot|apos|lt|gt);?/giu,
    (entity, encoded: string) => {
      const normalized = encoded.toLowerCase();

      if (normalized === "amp") return "&";
      if (normalized === "quot") return '"';
      if (normalized === "apos") return "'";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";

      const radix = normalized.startsWith("#x") ? 16 : 10;
      const digits = normalized.slice(radix === 16 ? 2 : 1);
      const codePoint = Number.parseInt(digits, radix);
      if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) return entity;

      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return entity;
      }
    },
  );
}
