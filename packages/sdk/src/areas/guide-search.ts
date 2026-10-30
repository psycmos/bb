import { readdir, readFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import path from "node:path";
import { z } from "zod";

export const DEFAULT_GUIDE_SEARCH_DOCS_URL = "https://getbb.app/docs";
export const DEFAULT_GUIDE_SEARCH_LIMIT = 10;
export const MAX_GUIDE_SEARCH_LIMIT = 50;
export const MAX_GUIDE_SEARCH_QUERY_LENGTH = 500;
export const DEFAULT_GUIDE_SEARCH_DOCS_TIMEOUT_MS = 5_000;

const MAX_SKILL_FILE_BYTES = 256 * 1024;
const MAX_DOCS_INDEX_BYTES = 32 * 1024 * 1024;
const MAX_SKILLS_PER_ROOT = 500;
const SNIPPET_LENGTH = 200;

export type GuideSearchSource = "docs" | "guide" | "skill";

export interface GuideSearchDocument {
  source: GuideSearchSource;
  title: string;
  section: string | null;
  location: string;
  text: string;
}

export interface GuideSearchResult {
  source: GuideSearchSource;
  title: string;
  section: string | null;
  location: string;
  snippet: string;
}

export interface GuideSearchDocsStatus {
  url: string;
  ok: boolean;
  error: string | null;
}

export interface GuideSearchResponse {
  query: string;
  results: GuideSearchResult[];
  docs: GuideSearchDocsStatus;
}

export interface GuideChapterText {
  chapter: string | null;
  content: string;
}

export interface GuideSearchQuery {
  query: string;
  limit: number;
}

const STOPWORDS = new Set(
  "a an and are as at be bb by can do does for from how i if in into is it its me my of on or so that the their them then there these this to use using via was what when where which who why will with you your".split(
    " ",
  ),
);

export function tokenizeGuideSearchText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(stemToken);
}

function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies"))
    return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (
    token.length > 3 &&
    token.endsWith("es") &&
    /(?:ch|sh|x|ss)es$/u.test(token)
  ) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

export function parseGuideSearchQuery(input: {
  query: string;
  limit?: number;
}): GuideSearchQuery {
  const query = input.query.trim().replace(/\s+/gu, " ");
  if (query.length === 0) {
    throw new Error("Search query must not be empty.");
  }
  if (query.length > MAX_GUIDE_SEARCH_QUERY_LENGTH) {
    throw new Error(
      `Search query must be at most ${MAX_GUIDE_SEARCH_QUERY_LENGTH} characters.`,
    );
  }
  if (tokenizeGuideSearchText(query).length === 0) {
    throw new Error(
      `Search query '${query}' has no searchable words; name the feature or command you are asking about.`,
    );
  }
  const limit = input.limit ?? DEFAULT_GUIDE_SEARCH_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_GUIDE_SEARCH_LIMIT
  ) {
    throw new Error(
      `Search limit must be an integer from 1 to ${MAX_GUIDE_SEARCH_LIMIT}.`,
    );
  }
  return { query, limit };
}

function humanizeChapter(chapter: string): string {
  const words = chapter.replace(/-/gu, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function isPlainHeading(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? "";
  if (line.length === 0 || line.length > 60 || /^\s/u.test(line)) return false;
  if (/^[`\-*|>#]/u.test(line) || /[.:,;]$/u.test(line)) return false;
  const previous = lines[index - 1];
  const next = lines[index + 1];
  return (
    (previous === undefined || previous.trim().length === 0) &&
    next !== undefined &&
    (next.trim().length === 0 || /^\s/u.test(next))
  );
}

interface TextSection {
  heading: string | null;
  text: string;
}

function splitPlainSections(content: string): TextSection[] {
  const lines = content.split("\n");
  const sections: TextSection[] = [];
  let heading: string | null = null;
  let body: string[] = [];
  const flush = () => {
    const text = body.join("\n").trim();
    if (text.length > 0 || heading !== null) sections.push({ heading, text });
  };
  lines.forEach((line, index) => {
    if (isPlainHeading(lines, index)) {
      flush();
      heading = line.trim();
      body = [];
      return;
    }
    body.push(line);
  });
  flush();
  return sections;
}

function splitMarkdownSections(content: string): TextSection[] {
  const sections: TextSection[] = [];
  let heading: string | null = null;
  let body: string[] = [];
  let fenced = false;
  const flush = () => {
    const text = body.join("\n").trim();
    if (text.length > 0 || heading !== null) sections.push({ heading, text });
  };
  for (const line of content.split("\n")) {
    if (/^\s*(?:```|~~~)/u.test(line)) fenced = !fenced;
    const match = fenced ? null : /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line);
    if (match?.[1] !== undefined) {
      flush();
      heading = match[1];
      body = [];
      continue;
    }
    body.push(line);
  }
  flush();
  return sections;
}

export function guideChapterDocuments(
  chapters: readonly GuideChapterText[],
): GuideSearchDocument[] {
  return chapters.flatMap(({ chapter, content }) => {
    const title = chapter === null ? "Overview" : humanizeChapter(chapter);
    const location = chapter === null ? "bb guide" : `bb guide ${chapter}`;
    return splitPlainSections(content).map((section) => ({
      source: "guide" as const,
      title,
      section: section.heading,
      location,
      text: section.text,
    }));
  });
}

interface ParsedSkillFile {
  name: string | null;
  description: string | null;
  body: string;
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSkillFile(raw: string): ParsedSkillFile {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(raw);
  if (match === null) return { name: null, description: null, body: raw };
  const frontmatter = match[1] ?? "";
  const field = (key: string): string | null => {
    const line = new RegExp(`^${key}:\\s*(.+)$`, "mu").exec(frontmatter);
    const value = line?.[1] === undefined ? "" : unquoteYamlScalar(line[1]);
    return value.length > 0 && value !== "|" && value !== ">" ? value : null;
  };
  return {
    name: field("name"),
    description: field("description"),
    body: raw.slice(match[0].length),
  };
}

export function skillDocuments(args: {
  directoryName: string;
  filePath: string;
  raw: string;
}): GuideSearchDocument[] {
  const parsed = parseSkillFile(args.raw);
  const title = parsed.name ?? args.directoryName;
  const sections = splitMarkdownSections(parsed.body);
  const documents: GuideSearchDocument[] = sections.map((section) => ({
    source: "skill",
    title,
    section: section.heading,
    location: args.filePath,
    text: section.text,
  }));
  if (parsed.description !== null) {
    documents.unshift({
      source: "skill",
      title,
      section: null,
      location: args.filePath,
      text: parsed.description,
    });
  }
  return documents;
}

export async function loadSkillDocuments(
  roots: readonly string[],
): Promise<GuideSearchDocument[]> {
  const seen = new Set<string>();
  const documents: GuideSearchDocument[] = [];
  for (const root of roots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries.slice(0, MAX_SKILLS_PER_ROOT)) {
      if (entry.name.startsWith(".") || seen.has(entry.name)) continue;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const filePath = path.join(root, entry.name, "SKILL.md");
      const raw = await readFile(filePath, "utf8").catch(() => null);
      if (raw === null || raw.length > MAX_SKILL_FILE_BYTES) continue;
      seen.add(entry.name);
      documents.push(
        ...skillDocuments({ directoryName: entry.name, filePath, raw }),
      );
    }
  }
  return documents;
}

const docsIndexEntrySchema = z.object({
  page_id: z.string(),
  type: z.string(),
  content: z.string(),
  url: z.string(),
});

const docsIndexSchema = z.object({
  docs: z.object({
    docs: z.union([
      z.record(z.string(), docsIndexEntrySchema),
      z.array(docsIndexEntrySchema),
    ]),
  }),
});

export function docsIndexDocuments(
  index: unknown,
  docsBaseUrl: string,
): GuideSearchDocument[] {
  const parsed = docsIndexSchema.parse(index);
  const entries = Object.values(parsed.docs.docs);
  const pageTitles = new Map<string, string>();
  const headings = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type === "page") pageTitles.set(entry.page_id, entry.content);
    if (entry.type === "heading") headings.set(entry.url, entry.content);
  }
  const sections = new Map<
    string,
    { pageId: string; url: string; text: string[] }
  >();
  for (const entry of entries) {
    const key = `${entry.page_id}\0${entry.url}`;
    const section = sections.get(key) ?? {
      pageId: entry.page_id,
      url: entry.url,
      text: [],
    };
    if (entry.type !== "page" && entry.type !== "heading") {
      section.text.push(entry.content);
    }
    sections.set(key, section);
  }
  const origin = new URL(docsBaseUrl);
  return [...sections.values()].flatMap((section) => {
    const title = pageTitles.get(section.pageId);
    if (title === undefined) return [];
    return [
      {
        source: "docs" as const,
        title,
        section: headings.get(section.url) ?? null,
        location: new URL(section.url, origin).toString(),
        text: section.text.join("\n"),
      },
    ];
  });
}

export function docsSearchIndexUrl(docsBaseUrl: string): string {
  return `${docsBaseUrl.replace(/\/+$/u, "")}/search.json`;
}

export type GuideSearchIndexFetcher = (
  url: string,
  timeoutMs: number,
) => Promise<unknown>;

export const fetchGuideSearchIndex: GuideSearchIndexFetcher = (
  url,
  timeoutMs,
) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const get = target.protocol === "https:" ? httpsGet : httpGet;
    const signal = AbortSignal.timeout(timeoutMs);
    const fail = (error: Error) =>
      reject(
        signal.aborted ? new Error(`timed out after ${timeoutMs} ms`) : error,
      );
    const request = get(
      target,
      { headers: { accept: "application/json" }, signal },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_DOCS_INDEX_BYTES) {
            request.destroy(new Error("search index is too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", fail);
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error("search index is not JSON"));
          }
        });
      },
    );
    request.on("error", fail);
  });

export interface FetchDocsDocumentsResult {
  documents: GuideSearchDocument[];
  status: GuideSearchDocsStatus;
}

export async function fetchDocsDocuments(args: {
  docsBaseUrl: string;
  timeoutMs: number;
  fetchIndex: GuideSearchIndexFetcher;
}): Promise<FetchDocsDocumentsResult> {
  const url = docsSearchIndexUrl(args.docsBaseUrl);
  const failed = (error: string): FetchDocsDocumentsResult => ({
    documents: [],
    status: { url, ok: false, error },
  });
  let body: unknown;
  try {
    body = await args.fetchIndex(url, args.timeoutMs);
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
  try {
    return {
      documents: docsIndexDocuments(body, args.docsBaseUrl),
      status: { url, ok: true, error: null },
    };
  } catch {
    return failed("unrecognized search index format");
  }
}

const FIELD_WEIGHTS = { title: 3, section: 2, text: 1 } as const;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const HEADING_MATCH_BONUS = 1.5;
const SOURCE_ORDER: Record<GuideSearchSource, number> = {
  docs: 0,
  guide: 1,
  skill: 2,
};

interface IndexedDocument {
  document: GuideSearchDocument;
  termWeights: Map<string, number>;
  headingTerms: Set<string>;
  length: number;
}

function indexDocument(document: GuideSearchDocument): IndexedDocument {
  const termWeights = new Map<string, number>();
  let length = 0;
  const add = (text: string, weight: number) => {
    for (const token of tokenizeGuideSearchText(text)) {
      termWeights.set(token, (termWeights.get(token) ?? 0) + weight);
      length += weight;
    }
  };
  add(document.title, FIELD_WEIGHTS.title);
  add(document.section ?? "", FIELD_WEIGHTS.section);
  add(document.text, FIELD_WEIGHTS.text);
  const headingTerms = new Set(
    tokenizeGuideSearchText(`${document.title} ${document.section ?? ""}`),
  );
  return { document, termWeights, headingTerms, length };
}

function snippetFor(text: string, terms: ReadonlySet<string>): string {
  const lines = text
    .split(/\n+/u)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter((line) => line.length > 0);
  let best = lines[0] ?? "";
  let bestHits = -1;
  for (const line of lines) {
    const hits = new Set(
      tokenizeGuideSearchText(line).filter((token) => terms.has(token)),
    ).size;
    if (hits > bestHits) {
      best = line;
      bestHits = hits;
    }
  }
  return best.length > SNIPPET_LENGTH
    ? `${best.slice(0, SNIPPET_LENGTH - 1).trimEnd()}…`
    : best;
}

export function rankGuideSearchDocuments(
  query: string,
  documents: readonly GuideSearchDocument[],
  limit: number,
): GuideSearchResult[] {
  const terms = [...new Set(tokenizeGuideSearchText(query))];
  if (terms.length === 0 || documents.length === 0) return [];
  const indexed = documents.map(indexDocument);
  const averageLength =
    indexed.reduce((total, entry) => total + entry.length, 0) /
      indexed.length || 1;
  const documentFrequency = new Map<string, number>(
    terms.map((term) => [
      term,
      indexed.filter((entry) => entry.termWeights.has(term)).length,
    ]),
  );
  const scored = indexed.flatMap((entry, position) => {
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      const frequency = entry.termWeights.get(term);
      if (frequency === undefined) continue;
      matched += 1;
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (indexed.length - df + 0.5) / (df + 0.5));
      if (entry.headingTerms.has(term)) score += idf * HEADING_MATCH_BONUS;
      score +=
        (idf * frequency * (BM25_K1 + 1)) /
        (frequency +
          BM25_K1 * (1 - BM25_B + (BM25_B * entry.length) / averageLength));
    }
    if (matched === 0) return [];
    const coverage = matched / terms.length;
    return [{ entry, position, score: score * coverage * coverage }];
  });
  scored.sort(
    (left, right) =>
      right.score - left.score ||
      SOURCE_ORDER[left.entry.document.source] -
        SOURCE_ORDER[right.entry.document.source] ||
      left.position - right.position,
  );
  const termSet = new Set(terms);
  return scored.slice(0, limit).map(({ entry: { document } }) => ({
    source: document.source,
    title: document.title,
    section: document.section,
    location: document.location,
    snippet: snippetFor(document.text, termSet),
  }));
}
