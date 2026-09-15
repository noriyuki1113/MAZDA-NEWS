import * as cheerio from "cheerio";
import { decode } from "he";
import { LIST_URL, ORIGIN, USER_AGENT, type Lang } from "./sources.js";

export interface ReleaseListItem {
  releaseId: string;
  url: string;
  title: string;
  category: string;
  publishedAt: string; // YYYY-MM-DD, derived from the URL
  lang: Lang;
}

const RELEASE_URL_PATTERN = /\/(\d{4})\/(\d{6})\/(\d{2})(\d{2})(\d{2})([a-z])\.(?:html|pdf)$/;

// URL の /{YYYY}/{YYYYMM}/{YYMMDD}{英字}.html(or .pdf) からリリースIDと日付を取り出す。
// HTML内の日付表記(time要素等)は記事・一覧の両方で信頼できないことが判明している
// ため使わない(src/sources.ts の Phase 0 調査結果を参照)。
export function extractReleaseIdAndDate(
  url: string,
): { releaseId: string; publishedAt: string } | null {
  const match = RELEASE_URL_PATTERN.exec(url);
  if (!match) return null;
  const [, year, , yy, mm, dd, suffix] = match;
  return {
    releaseId: `${yy}${mm}${dd}${suffix}`,
    publishedAt: `${year}-${mm}-${dd}`,
  };
}

// タイトル文字列中の <br> タグと、エスケープされた "&lt;br&gt;" の両方を
// 半角スペースに変換したうえでエンティティをデコードする（§3.5）。
function cleanTitle(rawHtml: string): string {
  const withSpaces = rawHtml.replace(/<br\s*\/?>/gi, " ");
  const decoded = decode(withSpaces).replace(/<br\s*\/?>/gi, " ");
  return decoded.replace(/\s+/g, " ").trim();
}

function cleanText(raw: string): string {
  return decode(raw).replace(/\s+/g, " ").trim();
}

export function parseListHtml(html: string, lang: Lang): ReleaseListItem[] {
  const $ = cheerio.load(html);
  const items: ReleaseListItem[] = [];
  const seenUrls = new Set<string>();

  $("li.c-list04__item").each((_, li) => {
    const $li = $(li);
    const hrefRaw = $li.children("a").first().attr("href");
    if (!hrefRaw) return;

    const href = hrefRaw.trim();
    const url = new URL(href, ORIGIN).toString();

    // §3.5: カテゴリ別の再掲ブロックにより同一URLが複数回出現する。URLキーで重複排除する。
    if (seenUrls.has(url)) return;

    const idAndDate = extractReleaseIdAndDate(url);
    if (!idAndDate) return;

    const titleHtml = $li.find("p.c-list04__txt").first().html() ?? "";
    const title = cleanTitle(titleHtml);
    const category = cleanText($li.find("span.c-list04__tag").first().text());

    seenUrls.add(url);
    items.push({
      releaseId: idAndDate.releaseId,
      url,
      title,
      category,
      publishedAt: idAndDate.publishedAt,
      lang,
    });
  });

  return items;
}

export async function fetchList(lang: Lang): Promise<ReleaseListItem[]> {
  const res = await fetch(LIST_URL[lang], {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${lang} release list: HTTP ${res.status}`);
  }
  const html = await res.text();
  return parseListHtml(html, lang);
}
