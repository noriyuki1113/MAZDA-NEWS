import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractReleaseIdAndDate, parseArticleHtml, parseListHtml } from "./fetch.js";

// このフィクスチャは 2026-09-15 に実際の一覧ページ
// (https://newsroom.mazda.com/ja/publicity/release/) を GitHub Actions 経由で
// 取得したHTMLの実物から構造を再現したもの（src/sources.ts の調査結果コメント
// 参照）。href が複数行にまたがる点、カテゴリ再掲ブロックによる重複、
// エスケープされた &lt;br&gt; を含むタイトルはすべて実際に確認された、または
// 仕様書 §3.5 が明示する既知のケース。
const FIXTURE_HTML = `
<html><body>
<ul class="c-list04">
  <li class="c-list04__item">
    <a href="
            /ja/publicity/release/2026/202606/260629a.html
        "
    >
        <div class="c-list04__detail">
            <dl class="c-list04__date">
                <dt>
                    <time datetime="2026.06.29">2026.6.29</time>
                    <span class="c-list04__tag  tag05 ">
                            生産・販売
                    </span>
                </dt>
                <dd>
                    <p class="c-list04__txt ">
                        マツダ、2026年5月の生産･販売状況について
                    </p>
                </dd>
            </dl>
        </div>
    </a>
    <div class="c-list04__pdf">
        <a href="/ja/publicity/release/2026/202606/260629a.pdf" target="_blank"></a>
    </div>
  </li>
  <li class="c-list04__item">
    <a href="
            /ja/publicity/release/2026/202606/260626a.html
        "
    >
        <div class="c-list04__detail">
            <dl class="c-list04__date">
                <dt>
                    <time datetime="2026.06.26">2026.6.26</time>
                    <span class="c-list04__tag  tag02 ">
                            クルマ・技術
                    </span>
                </dt>
                <dd>
                    <p class="c-list04__txt ">
                        マツダ、「マツダ ロードスター」を商品改良
                    </p>
                    <p class="c-ttl04__txt--small pc-only">－走りの魅力をさらに深化、特別仕様車「PS」を新設定－</p>
                </dd>
            </dl>
        </div>
    </a>
    <div class="c-list04__pdf">
        <a href="/ja/publicity/release/2026/202606/260626a.pdf" target="_blank"></a>
    </div>
  </li>
  <li class="c-list04__item">
    <a href="
            /ja/publicity/release/2026/202606/260601a.html
        "
    >
        <div class="c-list04__detail">
            <dl class="c-list04__date">
                <dt>
                    <time datetime="2026.06.01">2026.6.1</time>
                    <span class="c-list04__tag  tag01 ">
                            企業情報
                    </span>
                </dt>
                <dd>
                    <p class="c-list04__txt ">
                        マツダ、新商品発表会を開催&lt;br&gt;東京・大阪の2都市で
                    </p>
                </dd>
            </dl>
        </div>
    </a>
  </li>
</ul>

<!-- カテゴリ別の再掲ブロック（ページ下部）。同一URLが再度出現する -->
<ul class="c-list04">
  <li class="c-list04__item">
    <a href="
            /ja/publicity/release/2026/202606/260626a.html
        "
    >
        <div class="c-list04__detail">
            <dl class="c-list04__date">
                <dt>
                    <time datetime="2026.06.26">2026.6.26</time>
                    <span class="c-list04__tag  tag02 ">
                            クルマ・技術
                    </span>
                </dt>
                <dd>
                    <p class="c-list04__txt ">
                        マツダ、「マツダ ロードスター」を商品改良
                    </p>
                </dd>
            </dl>
        </div>
    </a>
  </li>
</ul>
</body></html>
`;

describe("extractReleaseIdAndDate", () => {
  it("extracts the release id and date from a .html release URL", () => {
    expect(
      extractReleaseIdAndDate(
        "https://newsroom.mazda.com/ja/publicity/release/2026/202606/260901b.html",
      ),
    ).toEqual({ releaseId: "260901b", publishedAt: "2026-09-01" });
  });

  it("extracts from a .pdf-only release URL too", () => {
    expect(
      extractReleaseIdAndDate(
        "https://newsroom.mazda.com/en/publicity/release/2026/202606/260901b.pdf",
      ),
    ).toEqual({ releaseId: "260901b", publishedAt: "2026-09-01" });
  });

  it("returns null for a URL that doesn't match the release pattern", () => {
    expect(extractReleaseIdAndDate("https://newsroom.mazda.com/ja/info/")).toBeNull();
  });
});

describe("parseListHtml", () => {
  const items = parseListHtml(FIXTURE_HTML, "ja");

  it("dedupes the same URL appearing in the category re-listing block (§3.5)", () => {
    expect(items).toHaveLength(3);
    const ids = items.map((i) => i.releaseId);
    expect(ids).toEqual(["260629a", "260626a", "260601a"]);
  });

  it("extracts clean fields for a normal item", () => {
    const item = items.find((i) => i.releaseId === "260629a");
    expect(item).toMatchObject({
      releaseId: "260629a",
      url: "https://newsroom.mazda.com/ja/publicity/release/2026/202606/260629a.html",
      title: "マツダ、2026年5月の生産･販売状況について",
      category: "生産・販売",
      publishedAt: "2026-06-29",
      lang: "ja",
    });
  });

  it("trims a multi-line href and keeps the title clean despite an optional subtitle sibling", () => {
    const item = items.find((i) => i.releaseId === "260626a");
    expect(item?.url).toBe(
      "https://newsroom.mazda.com/ja/publicity/release/2026/202606/260626a.html",
    );
    expect(item?.title).toBe("マツダ、「マツダ ロードスター」を商品改良");
    expect(item?.category).toBe("クルマ・技術");
  });

  it("decodes an escaped &lt;br&gt; in the title and replaces it with a space (§3.5)", () => {
    const item = items.find((i) => i.releaseId === "260601a");
    expect(item?.title).toBe("マツダ、新商品発表会を開催 東京・大阪の2都市で");
  });
});

// 実際の記事ページ (2026-06-26 のロードスター商品改良リリース) をそのまま保存した
// フィクスチャ。GitHub Actions 経由で取得したもの (src/sources.ts のPhase 0調査結果
// 参照)。dt/dd と、その中のpタグが二重にマッチして本文が重複しないことも確認する。
const ARTICLE_HTML = readFileSync(
  fileURLToPath(new URL("./__fixtures__/roadster-article.html", import.meta.url)),
  "utf-8",
);

describe("parseArticleHtml", () => {
  const article = parseArticleHtml(ARTICLE_HTML);

  it("extracts the clean title from og:title, not the site-name-prefixed <title> tag", () => {
    expect(article.title).toBe("マツダ、「マツダ ロードスター」を商品改良");
  });

  it("extracts body paragraphs without duplicating dt/dd wrapper text", () => {
    expect(article.bodyText).toContain(
      "マツダ株式会社（以下、マツダ）は、小型オープンスポーツカー",
    );
    expect(article.bodyText).toContain("新たな特別仕様車「PS」を追加しました");
    expect(article.bodyText).toContain("RAYS社製16インチアルミホイール（ブラック塗装）");

    // "1.	特別仕様車「PS」の追加" は <dt><p>...</p></dt> なので、dt自体もpも
    // 選択すると同じ文が2回入ってしまう。1回だけ出現することを確認する。
    const heading = "1. 特別仕様車「PS」の追加";
    const occurrences = article.bodyText.split(heading).length - 1;
    expect(occurrences).toBe(1);
  });

  it("does not pull in nav/footer/script content outside .c-article__conts", () => {
    expect(article.bodyText).not.toContain("ダウンロード規約");
    expect(article.bodyText).not.toContain("一覧に戻る");
    expect(article.bodyText).not.toContain("googletagmanager");
  });
});
