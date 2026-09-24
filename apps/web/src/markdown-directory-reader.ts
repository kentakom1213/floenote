import {
  isMarkdownDirectoryImportPath,
  parseMarkdownDirectoryImport,
  type ImportedPortableProject,
  type MarkdownDirectorySourceFile,
} from "@floe-note/document";

export type BrowserMarkdownDirectoryFile = {
  name: string;
  webkitRelativePath?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export async function readMarkdownDirectorySelection(
  files: readonly BrowserMarkdownDirectoryFile[],
  importedAt = Date.now(),
): Promise<ImportedPortableProject> {
  const directoryName = inferDirectoryName(files);
  const normalized = files.map((file) => ({
    file,
    relativePath: relativePathInsideSelection(file, directoryName),
  }));

  const candidates = normalized.filter(({ relativePath }) =>
    isMarkdownDirectoryImportPath(relativePath),
  );

  if (candidates.length === 0) {
    throw new Error("No Markdown files were found");
  }

  const sourceFiles = await Promise.all(
    candidates.map(async ({ file, relativePath }) => {
      try {
        const buffer = await file.arrayBuffer();
        return {
          relativePath,
          content: new Uint8Array(buffer),
        } satisfies MarkdownDirectorySourceFile;
      } catch (error: unknown) {
        throw new Error(
          `Could not read Markdown file: ${relativePath}`,
          { cause: error },
        );
      }
    }),
  );

  return parseMarkdownDirectoryImport(
    directoryName,
    sourceFiles,
    importedAt,
  );
}

function inferDirectoryName(
  files: readonly BrowserMarkdownDirectoryFile[],
): string | null {
  const roots = files.flatMap((file) => {
    const relativePath = file.webkitRelativePath ?? "";
    const separator = relativePath.indexOf("/");
    return separator > 0 ? [relativePath.slice(0, separator)] : [];
  });

  if (roots.length === 0) return null;
  const first = roots[0]!;
  return roots.every((root) => root === first) ? first : null;
}

function relativePathInsideSelection(
  file: BrowserMarkdownDirectoryFile,
  directoryName: string | null,
): string {
  const relativePath = file.webkitRelativePath || file.name;
  if (
    directoryName &&
    relativePath.startsWith(`${directoryName}/`)
  ) {
    return relativePath.slice(directoryName.length + 1);
  }

  return relativePath;
}
