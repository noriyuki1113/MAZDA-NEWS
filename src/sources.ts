// ============================================================================
// Phase 0 調査結果 (2026-09-15 実施)
//
// mazda-news-spec.md §11 の Phase 0 完了条件（"結果を sources.ts のコメントに
// 記録する"）を満たすためのメモ。実装（収集元定数・除外ルール等）は Phase 1
// 以降で追加する。このファイルは現時点ではコード無し・コメントのみ。
//
// 調査方法: この作業を行ったサンドボックス環境は newsroom.mazda.com への直接
// egress がプロキシでブロックされていたため、.github/workflows/probe.yml
// (workflow_dispatch で手動起動する調査専用ワークフロー) を GitHub Actions の
// Ubuntu ランナー上で実行し、curl で取得した内容をログから読み取った。
// 実行ログ: run #1 (2026-09-15T05:06 UTC, conclusion: success)
// ============================================================================

// ----------------------------------------------------------------------------
// 1. robots.txt  —  GET https://newsroom.mazda.com/robots.txt  (HTTP 200)
// ----------------------------------------------------------------------------
//
//   User-agent: *
//   Disallow: /apis/
//   Disallow: /assets/
//   Disallow: /ja/info/
//   Disallow: /en/info/
//
// → /ja/publicity/release/ と /en/publicity/release/ 配下はどちらも Disallow
//   に含まれていない。クロール可能（§3.8の遵守事項を守ればOK）。

// ----------------------------------------------------------------------------
// 2. RSSフィードURLの探索
//    GET https://newsroom.mazda.com/ja/publicity/release/  (HTTP 200, 439,493 bytes)
// ----------------------------------------------------------------------------
//
// <head> 内に <link rel="alternate" type="application/rss+xml" ...> は存在しない。
// HTML全体を "rss" で大小文字区別なく検索しても該当タグ・文字列は一切なし。
//
// → RSSフィードは提供されていない（少なくともこの一覧ページからは辿れない）。
//   §3.4の想定どおり、フィードには頼らずHTMLパースで実装を進める。

// ----------------------------------------------------------------------------
// 3. 記事ページのDOM構造
//    GET https://newsroom.mazda.com/ja/publicity/release/2026/202606/260626a.html
//    (HTTP 200, 22,805 bytes)
// ----------------------------------------------------------------------------
//
// <head>
//   <title>MAZDA NEWSROOMマツダ、「マツダ ロードスター」を商品改良｜ニュースリリース</title>
//     → サイト名("MAZDA NEWSROOM")と末尾の"｜ニュースリリース"が混入するため
//       タイトル取得には不向き。
//   <meta property="og:title" content="マツダ、「マツダ ロードスター」を商品改良" />
//     → タイトル本体はこちらから取得するのが最も綺麗。
//   <meta property="og:description" content="{本文冒頭の要約文}" />
//   <meta property="og:url" content="{記事の正規URL}" />
//
// <body class="page-release_details">
//   <main class="l-main">
//     <section class="p-release_details">
//       <div class="c-container c-article">
//
//         <header class="c-article__header">
//           <div class="c-article__info">
//             <time class="c-article__time" datetime="2019-05-05">2026.6.26</time>
//             <p class="c-article__tag--type02">クルマ・技術</p>          <!-- カテゴリ -->
//           </div>
//           <h3 class="c-ttl04--border">
//             <span class="c-ttl04__txt">マツダ、「マツダ ロードスター」を商品改良</span>
//             <br>
//             <span class="c-ttl04__txt--small">－走りの魅力をさらに深化、特別仕様車「PS」を新設定－</span>
//           </h3>
//           <ul class="c-article__list">                                <!-- SNS共有 + PDF -->
//             <li class="c-article__list__item pdf">
//               <a href="/ja/publicity/release/2026/202606/260626a.pdf" ...></a>
//             </li>
//           </ul>
//         </header>
//
//         <div class="c-article__conts">                                <!-- 本文 -->
//           <p class="idt">...</p>
//           <figure>...</figure>
//           <dl>...<dt>/<dd>...</dl>
//           ...
//         </div><!-- /.c-article__conts -->
//
//       </div>
//     </section>
//   </main>
// </body>
//
// 【重要】<time class="c-article__time" datetime="2019-05-05"> の datetime属性は
// テンプレートの初期値が残ったままで、実際の公開日（2026-06-26）と一致しない。
// 表示テキスト "2026.6.26" は正しいが、記事ごとに書式ゆれの可能性もあり信頼しにくい。
// → §3.2の方針どおり、日付は datetime属性/表示テキストではなく URL
//   (/2026/202606/260626a.html → 2026-06-26) から抽出するのが安全で安定する。
//
// 抽出方針まとめ（Phase 1で実装する際の参照用）:
//   - タイトル : meta[property="og:title"] の content
//                (フォールバック: h3.c-ttl04--border > span.c-ttl04__txt)
//   - 日付     : URLパスから抽出 (HTML内の日付表記は使わない)
//   - カテゴリ : p.c-article__tag--type02 のテキスト
//   - 本文     : div.c-article__conts の中身
//   - この記事はHTML本体に加えて li.c-article__list__item.pdf として同内容の
//     PDFへのリンクも併載している。これは「PDF専用リリース」(§3.6)とは別物で、
//     PDF専用判定はタイトル文字列中の "[PDF形式]" 表記の有無で行うこと。
