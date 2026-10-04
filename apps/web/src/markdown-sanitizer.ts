import DOMPurify from "dompurify";

const ALLOWED_MARKDOWN_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "details",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "rp",
  "rt",
  "ruby",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

const CODE_LANGUAGE_CLASS = /^language-[a-z0-9_+-]+$/iu;
const HISTORY_DIFF_CLASS = /^historical-diff-(?:added|removed)$/u;

export function sanitizeMarkdownHtml(html: string): string {
  const sanitized = String(
    DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [...ALLOWED_MARKDOWN_TAGS],
      ALLOWED_ATTR: ["href", "title", "class", "open"],
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: [
        "script",
        "style",
        "iframe",
        "object",
        "embed",
        "form",
        "svg",
        "picture",
        "source",
        "img",
      ],
      RETURN_TRUSTED_TYPE: false,
    }),
  );

  const parsed = new DOMParser().parseFromString(sanitized, "text/html");
  normalizeMarkdownAttributes(parsed.body);
  return parsed.body.innerHTML;
}

export function isSafeMarkdownHref(href: string): boolean {
  const value = href.trim();

  if (
    value.startsWith("#") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    (value.startsWith("/") && !value.startsWith("//"))
  ) {
    return true;
  }

  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}

function normalizeMarkdownAttributes(root: HTMLElement): void {
  for (const element of Array.from(root.querySelectorAll("*"))) {
    const tag = element.tagName.toLowerCase();

    for (const attribute of Array.from(element.attributes)) {
      const keepHref = tag === "a" && attribute.name === "href";
      const keepTitle = tag === "a" && attribute.name === "title";
      const keepCodeClass =
        tag === "code" &&
        attribute.name === "class" &&
        CODE_LANGUAGE_CLASS.test(attribute.value);
      const keepDetailsOpen =
        tag === "details" && attribute.name === "open";
      const keepHistoryDiffClass =
        (tag === "mark" || tag === "del") &&
        attribute.name === "class" &&
        HISTORY_DIFF_CLASS.test(attribute.value);

      if (
        !keepHref &&
        !keepTitle &&
        !keepCodeClass &&
        !keepDetailsOpen &&
        !keepHistoryDiffClass
      ) {
        element.removeAttribute(attribute.name);
      }
    }

    if (tag !== "a") continue;

    const href = element.getAttribute("href");
    if (!href || !isSafeMarkdownHref(href)) {
      element.removeAttribute("href");
    } else {
      element.setAttribute("rel", "noreferrer noopener");
    }
  }
}
