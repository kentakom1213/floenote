import DOMPurify from "dompurify";

const ALLOWED_MARKDOWN_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

const CODE_LANGUAGE_CLASS = /^language-[a-z0-9_+-]+$/iu;

export function sanitizeMarkdownHtml(html: string): string {
  const sanitized = String(
    DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [...ALLOWED_MARKDOWN_TAGS],
      ALLOWED_ATTR: ["href", "title", "class"],
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

      if (!keepHref && !keepTitle && !keepCodeClass) {
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
