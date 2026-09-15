import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fetchArticle, fetchList, type ReleaseListItem } from "./fetch.js";
import {
  computePendingUntil,
  confirmJaOnly,
  isPendingExpired,
  pairReleases,
  type PairedRelease,
} from "./pair.js";
import { MODEL, summarizeArticle } from "./summarize.js";
import {
  renderDraft,
  type AlsoFromMazdaEntry,
  type CorrectionEntry,
  type JdmOnlyEntry,
} from "./render.js";
import {
  findByReleaseId,
  loadSeenStore,
  saveSeenStore,
  upsertItem,
  type SeenItem,
} from "./dedupe.js";
import { isCategoryExcluded, isPdfOnly, REQUEST_INTERVAL_MS } from "./sources.js";

export const MAX_SUMMARIES_PER_RUN = 10;

const SEEN_PATH = fileURLToPath(new URL("../data/seen.json", import.meta.url));
const DRAFTS_DIR = fileURLToPath(new URL("../drafts/", import.meta.url));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// mazda-news-spec.md §6 手順6, §3.6, §3.7, §4.2:
// 新規検出されたリリースをseen.json用のレコードに変換する。
export function classifyNewRelease(
  result: PairedRelease,
  jaById: Map<string, ReleaseListItem>,
  enById: Map<string, ReleaseListItem>,
  now: Date,
): SeenItem {
  const ja = jaById.get(result.releaseId);
  const en = enById.get(result.releaseId);
  const primary = ja ?? en;
  if (!primary) {
    throw new Error(`classifyNewRelease: release ${result.releaseId} found in neither list`);
  }

  const pdfOnly = isPdfOnly({ title: primary.title, url: primary.url });
  const categoryExcluded = isCategoryExcluded({
    category: primary.category,
    title: primary.title,
    lang: primary.lang,
  });

  return {
    releaseId: result.releaseId,
    urlJa: result.urlJa,
    urlEn: result.urlEn,
    titleJa: ja?.title ?? null,
    titleEn: en?.title ?? null,
    category: primary.category,
    publishedAt: result.publishedAt,
    firstSeenAt: now.toISOString(),
    pairStatus: result.status,
    pendingUntil: result.status === "ja_only" ? toDateOnly(computePendingUntil(now)) : null,
    excluded: pdfOnly || categoryExcluded,
    excludedReason: pdfOnly ? "pdf" : categoryExcluded ? "category" : null,
    summarized: false,
  };
}

export interface PendingReview {
  updated: SeenItem;
  promoted: boolean; // pending だった ja_only が今回 paired に昇格した
}

// §4.2: pending中のja_onlyを毎日再確認する。14日経過していれば確定させ、
// まだ期間内なら英語URLの存在をHEADで再確認する。
export async function reviewPendingItem(
  item: SeenItem,
  now: Date,
  checkExists?: (url: string) => Promise<boolean>,
): Promise<PendingReview> {
  if (item.pairStatus !== "ja_only" || !item.pendingUntil) {
    return { updated: item, promoted: false };
  }

  const pendingUntilDate = new Date(`${item.pendingUntil}T00:00:00Z`);
  if (isPendingExpired(pendingUntilDate, now)) {
    return { updated: { ...item, pairStatus: "ja_only_confirmed" }, promoted: false };
  }

  if (!item.urlJa) return { updated: item, promoted: false };

  const candidate: PairedRelease = {
    releaseId: item.releaseId,
    status: "ja_only",
    urlJa: item.urlJa,
    urlEn: item.urlEn,
    publishedAt: item.publishedAt,
  };
  const confirmed = checkExists ? await confirmJaOnly(candidate, checkExists) : await confirmJaOnly(candidate);

  if (confirmed.status !== "paired") return { updated: item, promoted: false };

  return {
    updated: { ...item, pairStatus: "paired", urlEn: confirmed.urlEn, pendingUntil: null },
    promoted: true,
  };
}

// §6: 1回の実行でAI要約するのは最大10件。超過分は古い順に処理し、残りは次回に持ち越す。
export function selectSummaryTargets(
  items: SeenItem[],
  limit = MAX_SUMMARIES_PER_RUN,
): SeenItem[] {
  return items
    .filter((item) => item.pairStatus === "ja_only" && !item.excluded && !item.summarized)
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
    .slice(0, limit);
}

export async function main(now: Date = new Date()): Promise<void> {
  let jaItems: ReleaseListItem[];
  try {
    jaItems = await fetchList("ja");
  } catch (err) {
    // §6: 一覧の取得が失敗した場合はseen.jsonを更新せず異常終了する
    console.error("Failed to fetch the ja release list; aborting without touching seen.json.", err);
    process.exitCode = 1;
    return;
  }

  await sleep(REQUEST_INTERVAL_MS);

  let enItems: ReleaseListItem[];
  try {
    enItems = await fetchList("en");
  } catch (err) {
    // §6: 英語一覧の取得だけが失敗した場合も異常終了する。
    // pairedをja_onlyと誤判定して誤配信する事故のほうが訂正コストが高いため。
    console.error("Failed to fetch the en release list; aborting without touching seen.json.", err);
    process.exitCode = 1;
    return;
  }

  const jaById = new Map(jaItems.map((i) => [i.releaseId, i]));
  const enById = new Map(enItems.map((i) => [i.releaseId, i]));

  let store = await loadSeenStore(SEEN_PATH);

  const pairedResults = pairReleases(jaItems, enItems);
  const newResults = pairedResults.filter((r) => !findByReleaseId(store, r.releaseId));

  // §4.1: ja_only候補はHEADで確認してから確定する（既に/en/が存在すればpairedに降格）
  const confirmedNewResults: PairedRelease[] = [];
  for (const result of newResults) {
    if (result.status === "ja_only") {
      await sleep(REQUEST_INTERVAL_MS);
      confirmedNewResults.push(await confirmJaOnly(result));
    } else {
      confirmedNewResults.push(result);
    }
  }

  const newReleaseIds = new Set(confirmedNewResults.map((r) => r.releaseId));
  for (const result of confirmedNewResults) {
    store = upsertItem(store, classifyNewRelease(result, jaById, enById, now));
  }

  // §4.2: 既存pending項目の再確認（今回新規に作った項目は対象外）
  const corrections: CorrectionEntry[] = [];
  for (const existing of store.items) {
    if (newReleaseIds.has(existing.releaseId)) continue;
    if (existing.pairStatus !== "ja_only" || !existing.pendingUntil) continue;

    await sleep(REQUEST_INTERVAL_MS);
    const { updated, promoted } = await reviewPendingItem(existing, now);
    store = upsertItem(store, updated);
    if (promoted && updated.titleJa && updated.urlEn) {
      corrections.push({ titleJa: updated.titleJa, urlEn: updated.urlEn });
    }
  }

  const newJaOnly = store.items.filter(
    (item) => newReleaseIds.has(item.releaseId) && item.pairStatus === "ja_only" && !item.excluded,
  );
  const newPaired = store.items.filter(
    (item) => newReleaseIds.has(item.releaseId) && item.pairStatus === "paired" && !item.excluded,
  );

  if (newJaOnly.length === 0 && newPaired.length === 0 && corrections.length === 0) {
    // §6 手順8: 配信対象が0件なら「no new items」をログ出力して正常終了（PRは作らない）。
    // 除外分・en_only分の記録は残すためseen.jsonは更新する。
    console.log("No new items to distribute today.");
    await saveSeenStore(SEEN_PATH, store, now);
    return;
  }

  // 今回の新着に加え、前回までに上限超過で持ち越されたja_onlyも要約対象に含める。
  const carriedOverJaOnly = store.items.filter(
    (item) =>
      !newReleaseIds.has(item.releaseId) &&
      item.pairStatus === "ja_only" &&
      !item.excluded &&
      !item.summarized,
  );
  const targets = selectSummaryTargets([...newJaOnly, ...carriedOverJaOnly]);

  const jdmEntries: JdmOnlyEntry[] = [];
  for (const target of targets) {
    if (!target.urlJa) continue;

    await sleep(REQUEST_INTERVAL_MS);
    let article: Awaited<ReturnType<typeof fetchArticle>>;
    try {
      article = await fetchArticle(target.urlJa);
    } catch (err) {
      // §6: 個別記事の失敗はスキップしてログに残し、処理を継続する
      console.error(`Failed to fetch article body for ${target.releaseId}, skipping:`, err);
      continue;
    }

    const summary = await summarizeArticle({ title: article.title, bodyText: article.bodyText });
    if (!summary) continue; // §7: 2回失敗したらスキップ

    // 前回上限超過で持ち越された分(carriedOverJaOnly)も、要約が完了した今回の
    // draftで初めてJDM Watchとして載せる。
    jdmEntries.push({
      titleJa: target.titleJa ?? article.title,
      urlJa: target.urlJa,
      headline: summary.headline,
      summary: summary.summary,
      whyItMatters: summary.whyItMatters,
    });

    store = upsertItem(store, { ...target, summarized: true });
  }

  const pairedEntries: AlsoFromMazdaEntry[] = newPaired
    .filter((item): item is SeenItem & { urlEn: string; titleEn: string } => Boolean(item.urlEn && item.titleEn))
    .map((item) => ({ titleEn: item.titleEn, urlEn: item.urlEn, publishedAt: item.publishedAt }));

  const draft = renderDraft({
    date: toDateOnly(now),
    jdmOnly: jdmEntries,
    paired: pairedEntries,
    corrections,
    generatedBy: MODEL,
  });

  await mkdir(DRAFTS_DIR, { recursive: true });
  const draftPath = `${DRAFTS_DIR}${toDateOnly(now)}.md`;
  await writeFile(draftPath, draft, "utf-8");
  console.log(`Wrote ${draftPath}`);

  await saveSeenStore(SEEN_PATH, store, now);

  console.log(
    `Done: ${jdmEntries.length} JDM-only, ${pairedEntries.length} paired, ${corrections.length} corrections.`,
  );
}

const isMainModule = process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href;
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
