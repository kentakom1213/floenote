import type { NoteDocument, NoteProject } from "@floe-note/document";
import type { DocumentId } from "@floe-note/domain";

const RESULT_LIMIT = 50;
const SNIPPET_RADIUS_BEFORE = 48;
const SNIPPET_LENGTH = 176;

export type GlobalSearchMatchField = "title" | "tag" | "body";

export type GlobalSearchResult = {
  id: DocumentId;
  title: string;
  snippet: string | null;
  matchField: GlobalSearchMatchField | null;
  updatedAt: number | null;
  lastOpenedAt: number | null;
};

type SearchDocument = {
  id: DocumentId;
  title: string;
  tags: readonly string[];
  body: string;
  normalizedTitle: string;
  normalizedTags: readonly string[];
  normalizedBody: string;
  updatedAt: number | null;
};

type RankedMatch = {
  document: SearchDocument;
  rank: number;
  bodyMatched: boolean;
};

export class GlobalSearchCache {
  readonly #documents = new Map<DocumentId, SearchDocument>();

  syncProject(project: NoteProject): void {
    const activeIds = new Set<DocumentId>();

    for (const summary of project.listDocuments()) {
      activeIds.add(summary.id);
      if (this.#documents.has(summary.id)) continue;

      const document = project.getDocument(summary.id);
      if (document) this.updateDocument(document);
    }

    for (const id of this.#documents.keys()) {
      if (!activeIds.has(id)) this.#documents.delete(id);
    }
  }

  updateDocument(document: NoteDocument): void {
    const existing = this.#documents.get(document.id);
    const title = document.title;
    const tags = [...document.tags];
    const body = document.bodyText;
    const updatedAt = document.updatedAt;

    if (!existing) {
      this.#documents.set(document.id, {
        id: document.id,
        title,
        tags,
        body,
        normalizedTitle: normalizeSearchText(title),
        normalizedTags: tags.map(normalizeSearchText),
        normalizedBody: normalizeSearchText(body),
        updatedAt,
      });
      return;
    }

    if (existing.title !== title) {
      existing.title = title;
      existing.normalizedTitle = normalizeSearchText(title);
    }

    if (!sameStrings(existing.tags, tags)) {
      existing.tags = tags;
      existing.normalizedTags = tags.map(normalizeSearchText);
    }

    if (existing.body !== body) {
      existing.body = body;
      existing.normalizedBody = normalizeSearchText(body);
    }

    existing.updatedAt = updatedAt;
  }

  removeDocument(id: DocumentId): void {
    this.#documents.delete(id);
  }

  search(
    query: string,
    lastOpenedAt: ReadonlyMap<DocumentId, number>,
  ): GlobalSearchResult[] {
    const terms = splitSearchTerms(query);

    if (terms.length === 0) {
      return [...this.#documents.values()]
        .sort((left, right) =>
          compareRecent(left, right, lastOpenedAt),
        )
        .slice(0, RESULT_LIMIT)
        .map((document) => ({
          id: document.id,
          title: document.title,
          snippet: null,
          matchField: null,
          updatedAt: document.updatedAt,
          lastOpenedAt: lastOpenedAt.get(document.id) ?? null,
        }));
    }

    const matches: RankedMatch[] = [];

    for (const document of this.#documents.values()) {
      let rank = 0;
      let bodyMatched = false;
      let matchedAll = true;

      for (const term of terms) {
        const termRank = rankTerm(document, term);
        if (termRank === 0) {
          matchedAll = false;
          break;
        }

        rank = Math.max(rank, termRank);
        if (document.normalizedBody.includes(term)) bodyMatched = true;
      }

      if (matchedAll) matches.push({ document, rank, bodyMatched });
    }

    return matches
      .sort((left, right) => {
        if (left.rank !== right.rank) return right.rank - left.rank;

        const updated = compareTimestampDescending(
          left.document.updatedAt,
          right.document.updatedAt,
        );
        if (updated !== 0) return updated;

        return left.document.title.localeCompare(right.document.title, undefined, {
          sensitivity: "base",
          numeric: true,
        });
      })
      .slice(0, RESULT_LIMIT)
      .map(({ document, rank, bodyMatched }) => ({
        id: document.id,
        title: document.title,
        snippet: bodyMatched
          ? createBodySnippet(document.body, document.normalizedBody, terms)
          : null,
        matchField: rank === 3 ? "title" : rank === 2 ? "tag" : "body",
        updatedAt: document.updatedAt,
        lastOpenedAt: lastOpenedAt.get(document.id) ?? null,
      }));
  }
}

export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

export function splitSearchTerms(query: string): string[] {
  return normalizeSearchText(query)
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function rankTerm(document: SearchDocument, term: string): number {
  if (document.normalizedTitle.includes(term)) return 3;
  if (document.normalizedTags.some((tag) => tag.includes(term))) return 2;
  if (document.normalizedBody.includes(term)) return 1;
  return 0;
}

function createBodySnippet(
  body: string,
  normalizedBody: string,
  terms: readonly string[],
): string {
  const firstMatch = terms.reduce((best, term) => {
    const index = normalizedBody.indexOf(term);
    return index < 0 ? best : best < 0 ? index : Math.min(best, index);
  }, -1);

  const approximateStart = Math.max(
    0,
    (firstMatch < 0 ? 0 : firstMatch) - SNIPPET_RADIUS_BEFORE,
  );
  const raw = body.slice(approximateStart, approximateStart + SNIPPET_LENGTH);
  const compact = raw.replace(/\s+/gu, " ").trim();

  if (!compact) return "";

  return `${approximateStart > 0 ? "…" : ""}${compact}${
    approximateStart + SNIPPET_LENGTH < body.length ? "…" : ""
  }`;
}

function compareRecent(
  left: SearchDocument,
  right: SearchDocument,
  lastOpenedAt: ReadonlyMap<DocumentId, number>,
): number {
  const leftOpened = lastOpenedAt.get(left.id) ?? null;
  const rightOpened = lastOpenedAt.get(right.id) ?? null;

  const opened = compareTimestampDescending(leftOpened, rightOpened);
  if (opened !== 0) return opened;

  const updated = compareTimestampDescending(left.updatedAt, right.updatedAt);
  if (updated !== 0) return updated;

  return left.title.localeCompare(right.title, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function compareTimestampDescending(
  left: number | null,
  right: number | null,
): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left > right ? -1 : 1;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
