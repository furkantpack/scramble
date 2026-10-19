import type { ScrapedCompanyPage } from "./types";
import { createHash } from "node:crypto";

export const PAGE_LIMIT = 10;
export const PAGE_CHAR_LIMIT = 12_000;
export const TOTAL_CHAR_LIMIT = 80_000;
export const EXCLUDED_PATHS = [
  "blog",
  "news",
  "press",
  "careers",
  "jobs",
  "legal",
  "privacy",
  "terms",
  "cookies",
  "docs",
  "documentation",
  "support",
  "help",
  "login",
  "signup",
  "contact",
  "events",
  "webinars",
];
const preferred =
  /(?:^|\/)(about(?:-us)?|products?|platform|solutions?|customers|customer-stories|case-studies|pricing|plans|team|company|why-us|features|industries|use-cases|security|enterprise)(?:\/|$)/i;

export function normalizeSourceUrl(value: string) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("Invalid source URL");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|gclid$|fbclid$|msclkid$|ref$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

type ProviderPage = {
  markdown?: string;
  metadata?: {
    sourceURL?: string;
    url?: string;
    title?: string;
    description?: string;
    statusCode?: number;
    [key: string]: unknown;
  };
};

export function normalizePages(documents: ProviderPage[], rootUrl: string, truncate = true): ScrapedCompanyPage[] {
  const root = new URL(rootUrl);
  const hostname = (value: string) => value.toLowerCase().replace(/^www\./, "");
  const urls = new Set<string>();
  const hashes = new Set<string>();
  const candidates: ScrapedCompanyPage[] = [];
  for (const doc of documents) {
    try {
      const url = normalizeSourceUrl(doc.metadata?.url ?? doc.metadata?.sourceURL ?? rootUrl);
      const parsed = new URL(url);
      const path = decodeURIComponent(parsed.pathname).toLowerCase();
      if (hostname(parsed.hostname) !== hostname(root.hostname) || (doc.metadata?.statusCode ?? 200) >= 400) continue;
      if (path.split("/").some((segment) => EXCLUDED_PATHS.includes(segment)) || /\.(pdf|jpg|png|zip)$/i.test(path))
        continue;
      const markdown = (doc.markdown ?? "").replace(/!\[[^\]]*\]\(data:[^)]+\)/g, "").trim();
      if (markdown.length < 80) continue;
      const hash = createHash("sha256").update(markdown.replace(/\s+/g, " ")).digest("hex");
      if (urls.has(url) || hashes.has(hash)) continue;
      urls.add(url);
      hashes.add(hash);
      candidates.push({
        url,
        title: doc.metadata?.title?.slice(0, 500) || null,
        description: doc.metadata?.description?.slice(0, 1000) || null,
        markdown,
      });
    } catch {
      /* Malformed/untrusted provider URLs are discarded. */
    }
  }
  const score = (page: ScrapedCompanyPage) => {
    const url = new URL(page.url);
    if (url.pathname === root.pathname || url.pathname === "/") return 100;
    return (
      (preferred.test(url.pathname) ? 70 : 0) +
      (/product|customer|pricing|team|solution/i.test(page.title ?? "") ? 15 : 0) -
      url.pathname.split("/").length
    );
  };
  const selected = candidates.sort((a, b) => score(b) - score(a)).slice(0, PAGE_LIMIT);
  if (!truncate) return selected;
  // Remove identical link-only nav/footer lines repeated on several pages, not factual paragraphs.
  const occurrences = new Map<string, number>();
  for (const page of selected)
    for (const line of new Set(page.markdown.split("\n"))) {
      if (/^\s*(?:[-*]\s*)?\[[^\]]+\]\([^)]+\)\s*$/.test(line)) occurrences.set(line, (occurrences.get(line) ?? 0) + 1);
    }
  let remaining = TOTAL_CHAR_LIMIT;
  return selected.flatMap((page) => {
    if (remaining <= 0) return [];
    const clean = page.markdown
      .split("\n")
      .filter((line) => (occurrences.get(line) ?? 0) < 3)
      .join("\n")
      .trim();
    const markdown = limitMarkdown(clean, Math.min(PAGE_CHAR_LIMIT, remaining));
    remaining -= markdown.length;
    return markdown.length >= 80 ? [{ ...page, markdown }] : [];
  });
}

export function limitMarkdown(markdown: string, limit: number) {
  if (markdown.length <= limit) return markdown;
  const sections = markdown.split(/\n(?=#{1,3} )/);
  const first = sections.shift() ?? "";
  const meaningful = sections.filter((part) =>
    /^#{1,3} .*?(product|customer|pricing|team|about|solution|market|revenue|growth|fund|mission)/i.test(part),
  );
  const ordered = [first, ...meaningful, ...sections.filter((part) => !meaningful.includes(part))];
  let output = "";
  for (const part of ordered) {
    const room = limit - output.length - 2;
    if (room < 80) break;
    const chunk = part.slice(0, Math.min(room, Math.max(2000, Math.floor(limit / 3))));
    const boundary = chunk.lastIndexOf("\n");
    output += `${output ? "\n\n" : ""}${chunk.length < part.length && boundary > chunk.length / 2 ? chunk.slice(0, boundary) : chunk}`;
  }
  return output.slice(0, limit);
}
