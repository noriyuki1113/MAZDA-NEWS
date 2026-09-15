import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

// mazda-news-spec.md §7. 要約するのは ja_only のものだけ。paired は公式英語見出しを
// そのまま使う（src/render.ts 側の責務）。
export const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1000;

const SYSTEM_PROMPT = readFileSync(
  fileURLToPath(new URL("../prompts/summarize.md", import.meta.url)),
  "utf-8",
);

export interface SummarizeInput {
  title: string;
  bodyText: string;
}

export interface Summary {
  headline: string;
  summary: string;
  whyItMatters: string;
  tags: string[];
}

export type CompleteFn = (input: SummarizeInput) => Promise<string>;

let client: Anthropic | undefined;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

async function defaultComplete(input: SummarizeInput): Promise<string> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Title: ${input.title}\n\n${input.bodyText}` }],
  });

  const block = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  if (!block) {
    throw new Error("Claude response contained no text block");
  }
  return block.text;
}

function parseSummaryJson(raw: string): Summary {
  // プロンプトではmarkdown fence無しを指示しているが、念のため防御的に剥がす。
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  const data = JSON.parse(cleaned) as Record<string, unknown>;
  if (
    typeof data.headline !== "string" ||
    typeof data.summary !== "string" ||
    typeof data.why_it_matters !== "string" ||
    !Array.isArray(data.tags)
  ) {
    throw new Error("Summary JSON is missing required fields");
  }

  return {
    headline: data.headline,
    summary: data.summary,
    whyItMatters: data.why_it_matters,
    tags: data.tags.map(String),
  };
}

// §7: JSONパース失敗時は1回リトライ。2回失敗したらその記事はスキップする(null)。
// §6: 個別記事の失敗はスキップしてログに残し、処理を継続する。
export async function summarizeArticle(
  input: SummarizeInput,
  complete: CompleteFn = defaultComplete,
): Promise<Summary | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await complete(input);
      return parseSummaryJson(raw);
    } catch (err) {
      lastError = err;
    }
  }
  console.error(`summarizeArticle: failed after retry for "${input.title}":`, lastError);
  return null;
}
