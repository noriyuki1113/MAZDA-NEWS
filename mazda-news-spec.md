# mazda-news-en 実装指示書 v2

> v1からの変更: マツダ公式に**英語版ニュースリリースが既に存在する**ことが判明したため、
> 企画の軸を「日本語の英訳」から「**日英の差分検出**」に変更した。
> 単純な翻訳配信は公式と競合して価値がないが、差分は誰もやっていない。

---

## 0. 目的

マツダ公式の日本語リリースと英語リリースを日次で突き合わせ、
**日本語でしか出ていない情報（JDM-only）を特定して英語圏に届ける。**

海外のマツダファンにとっての価値は「日本で何が起きているか」ではなく、
「日本で起きていることのうち、自分たちが知り得ないもの」。そこだけを届ける。

**MVPのゴール**: 毎朝、以下2部構成のMarkdownがPull Requestとして自動で立っている状態。

1. **JDM Watch** — 日本語版のみのリリース。AI英語要約つき
2. **Also from Mazda** — 英語版もあるリリース。公式英語見出し＋公式リンクのみ（要約しない）

配信（Substackへの貼り付け）は当面**手動**。

**非目標（MVPでは作らない）**
- Substackへの自動投稿（公式の投稿APIが存在しないため。§9）
- 記事本文の翻訳・転載（利用条件上NG。§8）
- 英語版が存在するリリースのAI要約（公式訳があるものを作り直す意味がない）
- DB、管理画面、ログイン機能

---

## 1. 技術スタック

| 項目 | 選定 |
|---|---|
| 言語 | TypeScript (Node.js 20+) |
| 実行基盤 | GitHub Actions (cron) |
| 永続化 | リポジトリ内のJSONファイル（DBなし） |
| 要約 | Claude API (`claude-sonnet-4-6`) |
| パッケージ管理 | pnpm |
| テスト | Vitest（パーサ・突き合わせロジック・除外判定） |

サーバーもDBも持たない。状態はすべてGitにコミットする。

---

## 2. リポジトリ構成

```
mazda-news-en/
├── .github/workflows/daily.yml
├── src/
│   ├── index.ts          # エントリポイント
│   ├── sources.ts        # 収集元と除外ルールの定義
│   ├── fetch.ts          # 一覧・記事の取得とパース
│   ├── pair.ts           # 日英の突き合わせ（本プロジェクトの核）
│   ├── dedupe.ts         # 既読判定
│   ├── summarize.ts      # Claude API 呼び出し
│   └── render.ts          # Markdown生成
├── data/
│   └── seen.json         # 状態ファイル
├── drafts/
│   └── YYYY-MM-DD.md
├── prompts/
│   └── summarize.md
├── .env.example
└── README.md
```

---

## 3. 収集元（調査済み）

2026-09-15時点で実地調査済み。以下は確認済みの事実として実装してよい。

### 3.1 URL

| | URL |
|---|---|
| 日本語一覧 | `https://newsroom.mazda.com/ja/publicity/release/` |
| 英語一覧 | `https://newsroom.mazda.com/en/publicity/release/` |

### 3.2 記事URLの規則（日英で完全に並行）

```
https://newsroom.mazda.com/{ja|en}/publicity/release/{YYYY}/{YYYYMM}/{YYMMDD}{a|b|c...}.html

例:
  https://newsroom.mazda.com/ja/publicity/release/2026/202609/260901b.html
  https://newsroom.mazda.com/en/publicity/release/2026/202609/260901b.html
```

**`{YYMMDD}{英字}` の部分がリリースIDとして日英で共通。** これが突き合わせのキーになる。

- 同日複数件は末尾の英字（a, b, c...）で区別
- **日付はURLから抽出する**（HTML内の日付表記より安定）
- 一部は `.html` ではなく `.pdf` が本体（§3.6）

### 3.3 サイトの構造

| 項目 | 結果 |
|---|---|
| レンダリング方式 | サーバーレンダリング。一覧・本文ともHTMLに直接含まれる |
| ヘッドレスブラウザ | **不要**。`fetch` + HTMLパーサのみ |
| ページネーション | **なし**。1ページに当該年の全件 |
| 過去記事 | 年セレクタで2007年まで |
| カテゴリ（ja） | 企業情報 / 生産・販売 / クルマ・技術 / 株主・投資家情報 / CSR・環境・社会活動 / その他 |
| カテゴリ（en） | Company Information / Production and Sales / Products and Technology / ... |

### 3.4 RSS

サイト情報ページにRSS提供の記載がある。**フィードURLの特定を実装前に試すこと。**
見つかればHTMLパースより安定するので優先する。
見つからない場合はHTMLパースで進める（構造が素直なので難易度は低い）。

### 3.5 一覧パース時の必須処理

**同じ記事URLが一覧HTML内に複数回出現する。** カテゴリ別の再掲ブロックがページ下部に
あるため。**URLをキーにした重複排除を必ず行う。** タイトルでの判定では取りこぼす。

タイトル文字列に `&lt;br&gt;` がエスケープされた状態で混入する箇所がある。
HTMLエンティティのデコードと `<br>` の空白置換を行うこと。

### 3.6 PDF専用リリース

タイトルに `[PDF形式]` / `[PDF format]` を含み、リンク先が `.pdf` のものが一定数ある。

**MVPでの方針**: 要約対象外。`seen.json` には記録して再処理を防ぐ。
PDF本文の抽出はPhase 5以降。

### 3.7 カテゴリによる足切り

| カテゴリ | 扱い |
|---|---|
| クルマ・技術 | **必ず処理**。最優先 |
| 生産・販売 | 処理する |
| CSR・環境・社会活動 | 処理する。優先度低 |
| その他 | 処理する |
| 企業情報 | 「人事異動」「組織改革」「役員人事」「採用計画」を含むものは**除外** |
| 株主・投資家情報 | **全件除外**（決算、自己株式の処分、劣後ローン等） |

除外ルールは `src/sources.ts` に定数として定義し、あとから調整可能にする。

### 3.8 クロール時の遵守事項

- 実行前に `https://newsroom.mazda.com/robots.txt` を確認し、対象パスが許可されていること
  **（未確認。Phase 0で必ず確認する）**
- User-Agent に連絡先URLを含める
  （例: `mazda-news-en/1.0 (+https://github.com/<user>/mazda-news-en)`）
- リクエスト間隔は2秒以上
- 1回の実行で取得するのは日英の一覧各1枚と新着記事のみ。過去記事の一括クロールはしない

---

## 4. 日英の突き合わせ（`src/pair.ts`）— 本プロジェクトの核

### 4.1 判定ロジック

```
1. 日本語一覧からリリースID（YYMMDD+英字）の集合 JA を作る
2. 英語一覧からリリースID の集合 EN を作る
3. id ∈ JA かつ id ∉ EN  → ja_only（JDM Watch 候補）
4. id ∈ JA かつ id ∈ EN  → paired（Also from Mazda 候補）
5. id ∉ JA かつ id ∈ EN  → en_only（海外市場向け。記録のみ、配信しない）
```

**英語一覧に載っていなくても `/en/` のURLが存在する場合があるため、
ja_only 判定の確定前に対応する英語URLへHEADリクエストを1回投げて確認する。**
200なら paired に降格。

### 4.2 遅延公開への対応（重要）

英語版は日本語版より**遅れて公開されることがある**。
初回検出時点で `ja_only` でも、数日後に英語版が出る可能性がある。

**再確認ルール**
- `ja_only` と判定したものは、`pending_until`（初回検出から14日後）を設定する
- 毎日の実行時に、`pending_until` が未来のものについて英語URLの存在を再確認する
- 期間内に英語版が出たら `paired` に更新し、その旨を次のdraftで1行触れる
  （"Mazda has since published an English version" ＋ リンク）
- 14日経っても出なければ `ja_only_confirmed` として確定

**配信タイミング**: `ja_only` は検出当日に配信してよい（速報性が価値のため）。
確定を待たない。ただし後日 paired に変わったら訂正を出す。この運用を守ること。

### 4.3 これが生む固有のコンテンツ

- 「日本でのみ発表された内容」の一覧 = 他の英語メディアが持っていない情報
- 月次・年次で「英語化されなかったリリースの割合」を出すと、それ自体が記事になる
- 日英の公開タイムラグの統計

---

## 5. データ仕様

### 5.1 `data/seen.json`

```jsonc
{
  "version": 2,
  "items": [
    {
      "release_id": "260901b",        // 突き合わせキー
      "url_ja": "https://newsroom.mazda.com/ja/...",
      "url_en": null,                  // 存在すればURL、なければnull
      "title_ja": "原文タイトル",
      "title_en": null,                // 英語版があれば公式見出し
      "category": "クルマ・技術",
      "published_at": "2026-09-01",    // URLから抽出
      "first_seen_at": "2026-09-15T08:00:00+09:00",
      "pair_status": "ja_only",        // ja_only | ja_only_confirmed | paired | en_only
      "pending_until": "2026-09-29",   // ja_only のときのみ。再確認期限
      "excluded": false,
      "excluded_reason": null,         // "category" | "pdf" | null
      "summarized": false              // AI要約を生成済みか
    }
  ]
}
```

- キーは `release_id`。URLは言語ごとに2本持つ
- 直近365日分のみ保持し、古いものは削除
- 書き込みは一時ファイル経由のアトミック書き込み

### 5.2 `drafts/YYYY-MM-DD.md`

```markdown
---
date: 2026-09-15
jdm_only_count: 2
paired_count: 3
generated_by: claude-sonnet-4-6
---

# Mazda News — September 15, 2026

## 🇯🇵 JDM Watch — not published in English

### <English headline>

<3-sentence English summary>

**Why it matters:** <1 sentence>

Source: [原文タイトル](url_ja) (Japanese only, as of this writing)

---

## Also from Mazda

- [<公式英語見出し>](url_en) — Sep 1
- [<公式英語見出し>](url_en) — Sep 1

---

*Unofficial fan project. Not affiliated with or endorsed by Mazda Motor Corporation.
"JDM Watch" summaries are AI-generated from Japanese press releases — always check the source.
Mazda may publish an English version later; we correct entries when that happens.*
```

---

## 6. 処理フロー（`src/index.ts`）

```
1. 日本語一覧を取得 → URL重複排除（§3.5）→ release_id とカテゴリを抽出
2. 英語一覧を取得 → release_id の集合を作る
3. seen.json にない release_id を新着として抽出
4. カテゴリ除外ルールを適用（§3.7）
5. .pdf のものを要約対象から外す（seen.json には記録）
6. 新着それぞれについて日英突き合わせ（§4.1）。ja_only候補はHEADで確認
7. 既存の pending 項目について英語版の出現を再確認（§4.2）
8. 配信対象が0件なら「no new items」をログ出力して正常終了（PRは作らない）
9. ja_only のものだけ日本語本文を取得（1件ずつ、2秒間隔）してClaude要約
10. drafts/YYYY-MM-DD.md を生成（JDM Watch ＋ Also from Mazda）
11. seen.json を更新（除外分・en_only分も含めて全件記録）
12. ブランチ `news/YYYY-MM-DD` を作成し、PRを立てる
```

**除外分も `seen.json` に記録する理由**: 記録しないと毎日「新着」として再検出され、
除外判定を無限に繰り返すため。

**上限**: 1回の実行でAI要約するのは最大10件。超過分は古い順に10件処理し、残りは次回。

**エラー処理**
- 個別記事の失敗はスキップしてログに残し、処理を継続
- 一覧の取得が失敗した場合は `seen.json` を更新せず異常終了
  （空の取得結果を「新着なし」と誤認させないため）
- **英語一覧の取得だけが失敗した場合も異常終了する。**
  英語版の存在を「なし」と誤判定すると、pairedをja_onlyとして誤配信してしまうため。
  これは訂正が必要になる事故なので、落とすほうが安全

---

## 7. 要約仕様（`prompts/summarize.md`）

**要約するのは ja_only のものだけ。** paired は公式英語見出しをそのまま使う。

### システムプロンプト（要旨）

```
You are writing for an English-language newsletter about Mazda, read by
enthusiasts outside Japan. You receive a Japanese press release that Mazda
has NOT published in English.

Return ONLY a JSON object, no markdown fences, no preamble:
{
  "headline": "English headline, max 12 words",
  "summary": "Exactly 3 sentences in English",
  "why_it_matters": "One sentence on why overseas Mazda fans should care",
  "tags": ["JDM-only", "technology", "motorsport", "special-edition", "kei", ...]
}

Rules:
- Do NOT translate the article. Write an original summary in your own words.
- Keep Japanese model names as-is when they differ overseas, and note the
  overseas equivalent in parentheses only when you are confident
  (e.g. "Roadster (MX-5)", "Flair (Suzuki Wagon R OEM)").
- If you are not certain of a fact, omit it rather than guessing.
- Never invent specifications, prices, or release dates.
- Do not speculate about whether the model will come to other markets.
```

### パラメータ
- `max_tokens: 1000`
- JSONパース失敗時は1回リトライ。2回失敗したらその記事はスキップ

### コスト見積もり
ja_only は全リリースの一部なので、v1想定より少ない。月100件未満・数百円の見込み。

---

## 8. 著作権・利用条件の遵守（必須）

MAZDA NEWSROOM は、サイト上の素材（テキスト・画像・音声・動画）が著作権の対象であり、
報道関係者の編集目的での利用に限ると明記している。
これを踏まえ、以下をコードレビューの合格条件として扱う。

1. **原文の全文または長い引用を出力しない。** 要約はClaudeの自作文。
   原文からの直接引用は1記事あたり最大1箇所、15語未満
2. **画像を一切扱わない。** ダウンロードも再配布もしない
3. **必ず原文（公式）へのリンクを付ける**
4. **全出力に非公式である旨のフッターを入れる**（§5.2のテンプレ参照）
5. サイト・ニュースレターのフッターに商標帰属を明記する
6. 公式英語見出し（`title_en`）はリンクテキストとしてのみ使用し、
   それ以上の本文転載はしない

---

## 9. Substackとの接続について

Substackには記事投稿用の公式APIが存在しない。出回っている自動投稿ライブラリは
ブラウザのセッションcookieで非公開APIを叩く方式で、予告なく壊れる上に規約違反の
リスクがある。**このリポジトリでは実装しない。**

運用は「PRの内容をコピーしてSubstackに貼る」。所要5分。

将来の完全自動化は、公式APIを持つ配信基盤（Buttondown / Beehiiv / Resend）へ移行する。
その際は `src/deliver.ts` を追加する形で、収集・突き合わせ・要約には手を入れない設計にする。

---

## 10. GitHub Actions（`.github/workflows/daily.yml`）

- スケジュール: `cron: '0 23 * * *'`（UTC 23:00 = JST 8:00）
- `workflow_dispatch` も有効にして手動実行できるようにする
- `permissions: contents: write, pull-requests: write`
- Secrets: `ANTHROPIC_API_KEY`
- PR作成は `peter-evans/create-pull-request`
- PRタイトル: `News draft: YYYY-MM-DD (N JDM-only / M paired)`

---

## 11. Phase分割

| Phase | 内容 | 完了条件 |
|---|---|---|
| 0 | robots.txt確認、RSSフィードURLの探索、記事ページDOM構造の確認 | 結果を sources.ts のコメントに記録 |
| 1 | 日英一覧の取得・パース・重複排除 | 両言語のrelease_id一覧が正しく出る |
| 2 | 突き合わせロジック（§4） | ja_only / paired の判定がテストで通る |
| 3 | Claude要約＋Markdown生成 | 2部構成のdraftがローカルで出る |
| 4 | Actions化＋PR自動作成 | 3日連続で自動PRが立つ |
| 5 | GitHub Pagesで英語サイト＋RSS公開 | 公開URLでアクセスできる |

Phase 4までがMVP。Phase 5は運用が回ってから。

---

## 12. 受け入れ基準

- [ ] 新着0件の日にPRが立たない
- [ ] 同じ記事が2日連続で要約されない
- [ ] 一覧HTML内の重複出現が排除され、同一URLが1件としてのみ処理される
- [ ] 「人事異動」「決算発表」が処理対象に入らない
- [ ] `.pdf` のリリースが要約されず、かつ翌日も再検出されない
- [ ] タイトルに `&lt;br&gt;` などのエスケープ文字が残っていない
- [ ] 英語版が存在するリリースがAI要約されない（公式見出し＋リンクのみ）
- [ ] 英語一覧の取得失敗時に `seen.json` が更新されず異常終了する
- [ ] pending中の項目が毎日再確認され、英語版公開で paired に更新される
- [ ] 1回の実行で11件以上を要約しない
- [ ] 全draftに非公式フッターと公式リンクが含まれる
- [ ] `ANTHROPIC_API_KEY` がリポジトリにコミットされていない

---

## 13. 継続判断の基準（3週間後に評価）

以下のいずれかを満たさない場合、収集源の拡大や自動化の作り込みには進まない。

- ニュースレター購読者 50人以上
- または Reddit r/mazda での投稿が2回以上、100 upvote到達

満たさない場合は、題材（マツダ→別ジャンル）か流通経路を見直す。
コードの改善では解決しない問題である可能性が高いため。

**追加の観測指標**: 最初の3週間で ja_only が何件出たかを記録する。
ここが週1件未満なら、このコンセプト自体が成立していない。その場合は
商標出願・リコール・販売台数など、別の「日本にしかないデータ」へ軸を移す。
