// Phase 1 の完了条件「両言語の release_id 一覧が正しく出る」を実サイトに対して
// 確認するための手動スクリプト。.github/workflows/probe.yml から実行される。
import { fetchList } from "../src/fetch.js";
import { REQUEST_INTERVAL_MS } from "../src/sources.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

for (const lang of ["ja", "en"] as const) {
  const items = await fetchList(lang);
  console.log(`\n[${lang}] ${items.length} items`);
  console.log(
    `[${lang}] release_id sample:`,
    items.slice(0, 5).map((i) => i.releaseId),
  );
  console.log(
    `[${lang}] categories seen:`,
    [...new Set(items.map((i) => i.category))],
  );
  const dup = items.length - new Set(items.map((i) => i.releaseId)).size;
  console.log(`[${lang}] duplicate release_ids after dedupe: ${dup}`);
  await sleep(REQUEST_INTERVAL_MS);
}
