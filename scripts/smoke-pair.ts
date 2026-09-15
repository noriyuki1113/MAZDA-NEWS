// Phase 2 の完了条件「ja_only / paired の判定がテストで通る」を、実サイトの
// データに対しても end-to-end で確認する手動スクリプト。
// .github/workflows/probe.yml から実行される。
import { fetchList } from "../src/fetch.js";
import { confirmJaOnly, pairReleases } from "../src/pair.js";
import { REQUEST_INTERVAL_MS } from "../src/sources.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const jaItems = await fetchList("ja");
await sleep(REQUEST_INTERVAL_MS);
const enItems = await fetchList("en");

const results = pairReleases(jaItems, enItems);
const counts = { ja_only: 0, paired: 0, en_only: 0 };
for (const r of results) counts[r.status]++;
console.log("pairReleases() counts:", counts);

const jaOnlyCandidates = results.filter((r) => r.status === "ja_only").slice(0, 3);
console.log(
  `\nRe-checking ${jaOnlyCandidates.length} ja_only candidates via HEAD (§4.1 "降格" check)...`,
);
for (const candidate of jaOnlyCandidates) {
  await sleep(REQUEST_INTERVAL_MS);
  const confirmed = await confirmJaOnly(candidate);
  console.log(
    `  ${candidate.releaseId}: ${candidate.status} -> ${confirmed.status}` +
      (confirmed.status === "paired" ? ` (found ${confirmed.urlEn})` : ""),
  );
}
