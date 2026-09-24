import type { ImportedPortableProject } from "./portable-import.js";
import { decodeUtf8 } from "./utf8.js";

export type MarkdownDirectorySourceFile = {
  relativePath: string;
  content: Uint8Array;
};

export function isMarkdownDirectoryImportPath(relativePath: string): boolean {
  const parts = validateRelativePath(relativePath);
  if (parts.some((part) => part.startsWith("."))) return false;

  return /\.(?:md|markdown)$/iu.test(parts.at(-1)!);
}

export function parseMarkdownDirectoryImport(
  directoryName: string | null | undefined,
  files: readonly MarkdownDirectorySourceFile[],
  importedAt: number,
): ImportedPortableProject {
  if (!Number.isFinite(importedAt)) {
    throw new TypeError("importedAt must be a finite timestamp");
  }

  const candidates = files
    .filter(({ relativePath }) => isMarkdownDirectoryImportPath(relativePath))
    .slice()
    .sort((left, right) =>
      left.relativePath < right.relativePath
        ? -1
        : left.relativePath > right.relativePath
          ? 1
          : 0,
    );

  if (candidates.length === 0) {
    throw new Error("No Markdown files were found");
  }

  return {
    name: normalizeDirectoryProjectName(directoryName),
    documents: candidates.map(({ relativePath, content }) => {
      const fileName = relativePath.split("/").at(-1)!;
      const title = fileName.replace(/\.(?:md|markdown)$/iu, "");

      let body: string;
      try {
        body = decodeUtf8(content);
      } catch {
        throw new Error(
          `Markdown file is not valid UTF-8: ${relativePath}`,
        );
      }

      return {
        title,
        body,
        createdAt: importedAt,
        updatedAt: importedAt,
        tags: [],
      };
    }),
  };
}

function normalizeDirectoryProjectName(
  directoryName: string | null | undefined,
): string {
  const normalized = directoryName?.trim() ?? "";
  return normalized.length > 0 ? normalized : "Imported notes";
}

function validateRelativePath(relativePath: string): string[] {
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(relativePath)
  ) {
    throw new Error(`Invalid Markdown directory path: ${relativePath}`);
  }

  const parts = relativePath.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Invalid Markdown directory path: ${relativePath}`);
  }

  return parts;
}
