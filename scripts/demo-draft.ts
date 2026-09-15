// Phase 3 の完了条件「2部構成のdraftがローカルで出る」を実演するスクリプト。
// ネットワーク・ANTHROPIC_API_KEYなしで動くように、記事本文はPhase 0で取得した
// 実際のfixture HTML、要約はモックのcomplete関数を使う（実際のClaude呼び出しは
// src/summarize.ts の defaultComplete が担う。単体テストで検証済み）。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArticleHtml } from "../src/fetch.js";
import { renderDraft } from "../src/render.js";
import { MODEL, summarizeArticle } from "../src/summarize.js";

const articleHtml = readFileSync(
  fileURLToPath(new URL("../src/__fixtures__/roadster-article.html", import.meta.url)),
  "utf-8",
);
const article = parseArticleHtml(articleHtml);

const mockComplete = async () =>
  JSON.stringify({
    headline: 'Mazda refreshes the Roadster with a new "PS" special edition',
    summary:
      "Mazda has updated the Roadster and Roadster RF for the 2026 model year, headlined by a new 'PS' special edition tuned with input from the MAZDA SPIRIT RACING ROADSTER program. The refresh adds a new Zinc Green Metallic paint color, retuned Bilstein dampers, and a redesigned exhaust to meet updated noise regulations without losing the car's driving character. Orders open today in Japan, with deliveries beginning in September 2026.",
    why_it_matters:
      "It shows Mazda continuing to invest in a pure gasoline sports car even as noise and emissions rules tighten worldwide.",
    tags: ["JDM-only", "special-edition", "roadster"],
  });

const summary = await summarizeArticle(
  { title: article.title, bodyText: article.bodyText },
  mockComplete,
);
if (!summary) throw new Error("demo summarization unexpectedly failed");

const draft = renderDraft({
  date: "2026-09-15",
  generatedBy: MODEL,
  jdmOnly: [
    {
      titleJa: article.title,
      urlJa: "https://newsroom.mazda.com/ja/publicity/release/2026/202606/260626a.html",
      headline: summary.headline,
      summary: summary.summary,
      whyItMatters: summary.whyItMatters,
    },
  ],
  paired: [
    {
      titleEn: "Mazda Reports August 2026 Production and Sales",
      urlEn: "https://newsroom.mazda.com/en/publicity/release/2026/202609/260901a.html",
      publishedAt: "2026-09-01",
    },
    {
      titleEn: "Mazda Announces Executive Changes",
      urlEn: "https://newsroom.mazda.com/en/publicity/release/2026/202608/260828a.html",
      publishedAt: "2026-08-28",
    },
  ],
});

const outPath = fileURLToPath(new URL("../drafts/2026-09-15-demo.md", import.meta.url));
writeFileSync(outPath, draft, "utf-8");
console.log(`Wrote ${outPath}\n`);
console.log(draft);
