# mazda-news-en

マツダ公式ニュースルームの日本語版・英語版リリースを日次で突き合わせ、
**日本語でしか出ていない情報（JDM-only）** を検出して英語圏のマツダファンに届けるための非公式ツール。

日本で起きていることそのものではなく、「日本で起きていることのうち、海外のファンが知り得ないもの」だけを届けることを目的にしている。詳細な設計判断は [`mazda-news-spec.md`](./mazda-news-spec.md)（設計時に参照した指示書）を参照。

## できること / できないこと

**MVPのゴール**: 毎朝、以下2部構成のMarkdownをPull Requestとして自動生成する。

1. **JDM Watch** — 日本語版のみで公開されているリリース。AI（Claude）による英語要約つき
2. **Also from Mazda** — 英語版も存在するリリース。公式英語見出し＋公式リンクのみ（要約はしない）

**やらないこと（意図的な非目標）**

- Substackなどへの自動投稿 — 公式の投稿APIが存在しないため。PRの内容を手動でコピー＆ペーストする運用（§9参照）
- 記事本文の翻訳・転載 — 著作権上のリスクを避けるため、要約はClaudeによる自作文のみ
- 英語版が存在するリリースのAI要約 — 公式訳があるものを作り直す意味がないため
- DB・管理画面・ログイン機能 — 状態は`data/seen.json`にすべてGitでコミットする

## 仕組み

```
日本語一覧 ──┐
             ├─→ 突き合わせ (release_id) ─→ ja_only / paired / en_only
英語一覧   ──┘                                    │           │
                                                   ▼           ▼
                                          Claude要約      公式見出し+リンク
                                                   │           │
                                                   └─→ Markdown draft ─→ PR
```

- 日英の記事URLは `/{ja|en}/publicity/release/{YYYY}/{YYYYMM}/{YYMMDD}{英字}.html` という規則で完全に並行しており、末尾の `{YYMMDD}{英字}`（release_id）をキーに突き合わせる
- 英語版は日本語版より遅れて公開されることがあるため、`ja_only` と判定した直後は確定させず、初回検出から14日間は毎日再確認する（`pending_until`）。期間内に英語版が出れば `paired` に訂正し、次のdraftで1行触れる。14日経っても出なければ `ja_only_confirmed` として確定する
- 「人事異動」「決算発表」「株主・投資家情報」などは除外し、PDF専用リリースは要約せず記録のみ行う（`src/sources.ts` に除外ルールを定義）

## ディレクトリ構成

```
src/
  fetch.ts       一覧・記事ページの取得とパース（cheerio）
  pair.ts        日英の突き合わせロジック（本プロジェクトの核）
  dedupe.ts      data/seen.json の読み書き（アトミック書き込み・365日保持）
  summarize.ts   Claude API呼び出し（ja_onlyのみ要約）
  render.ts      2部構成Markdownの生成
  sources.ts     収集元URL・除外ルールの定義 + Phase 0調査結果のコメント
  index.ts       上記を結線する日次フロー本体
prompts/
  summarize.md   要約用システムプロンプト
data/
  seen.json      既読状態（Gitで管理、365日分のみ保持）
drafts/
  YYYY-MM-DD.md  生成されたdraft（PR経由でコミットされる）
.github/workflows/
  daily.yml      日次cron + 手動実行、テスト→パイプライン実行→PR作成
```

## セットアップ

```bash
pnpm install
```

Claude API呼び出しには `ANTHROPIC_API_KEY` が必要（`.env.example` 参照）。ローカルで実行する場合は環境変数として設定する。GitHub Actionsで自動実行する場合は、リポジトリの **Settings → Secrets and variables → Actions** に `ANTHROPIC_API_KEY` という名前のSecretとして登録する。

## 使い方

```bash
pnpm test        # vitestでユニットテストを実行
pnpm typecheck    # 型チェックのみ（tsc --noEmit）
npx tsx src/index.ts   # 日次パイプラインを1回実行（ネットワークアクセスが必要）
```

`src/index.ts` を実行すると:

1. 日英の一覧を取得・突き合わせ
2. 新着の`ja_only`候補はHEADリクエストで英語版の存在を再確認
3. pending中の項目（14日以内のja_only）を再確認
4. 配信対象（新規ja_only or paired）が0件ならログを出して終了（draft/PRは作らない）
5. `ja_only`のみ最大10件までClaudeで要約（超過分は次回に持ち越し）
6. `drafts/YYYY-MM-DD.md` を生成し、`data/seen.json` を更新

## 日次自動実行

`.github/workflows/daily.yml` が毎日 JST 8:00（UTC 23:00）に実行され、新着があればPRを自動で立てる。手動実行は Actions タブから `Daily Mazda News` → **Run workflow**。

PRが立ったら:

1. `drafts/YYYY-MM-DD.md` の内容を確認する
2. 問題なければPRをマージする（`data/seen.json`が更新され、同じ記事が翌日以降に再検出されなくなる）
3. draftの内容をコピーして配信先（Substack等）に手動で貼り付ける — **配信は自動化していない**（§9参照）

初回実行時は`data/seen.json`が空のため、その時点でサイトに掲載されている全リリースが一斉に「新着」として検出される（最大10件のJDM Watch + 全paired件数）。2回目以降は前日との差分のみになるので、通常は数件程度に収まる。

## 除外ルール・収集元の調整

`src/sources.ts` に定義:

- `FULLY_EXCLUDED_CATEGORY` — 全件除外するカテゴリ（株主・投資家情報）
- `EXCLUDED_TITLE_KEYWORDS` — 企業情報カテゴリのうち、これらのキーワードを含むタイトルだけ除外（人事異動・組織改革・役員人事・採用計画）
- `isPdfOnly()` — PDF専用リリースの判定（要約対象外）

調整したい場合はこのファイルの定数を変更し、`src/sources.test.ts` のテストを更新する。

## 著作権について

MAZDA NEWSROOM上の素材は著作権の対象であり、報道関係者の編集目的での利用に限ると明記されている。これを踏まえ、以下を守っている。

- 原文の全文・長い引用は出力しない（要約はClaudeの自作文）
- 画像は一切扱わない
- 必ず原文（公式）へのリンクを付ける
- 全出力に非公式である旨のフッターを入れる
- 公式英語見出しはリンクテキストとしてのみ使用する

---

*このリポジトリはマツダ株式会社と提携・承認された公式プロジェクトではありません。*
