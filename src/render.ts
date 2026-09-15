// mazda-news-spec.md §5.2 の2部構成Markdownを生成する。

export interface JdmOnlyEntry {
  titleJa: string;
  urlJa: string;
  headline: string;
  summary: string;
  whyItMatters: string;
}

export interface AlsoFromMazdaEntry {
  titleEn: string;
  urlEn: string;
  publishedAt: string; // YYYY-MM-DD
}

// §4.2: pendingだったja_onlyが期間内にpairedへ更新された際の訂正1行。
export interface CorrectionEntry {
  titleJa: string;
  urlEn: string;
}

export interface RenderDraftInput {
  date: string; // YYYY-MM-DD, ドラフトを生成した日
  jdmOnly: JdmOnlyEntry[];
  paired: AlsoFromMazdaEntry[];
  corrections?: CorrectionEntry[];
  generatedBy: string;
}

const FOOTER =
  '*Unofficial fan project. Not affiliated with or endorsed by Mazda Motor Corporation.\n' +
  '"JDM Watch" summaries are AI-generated from Japanese press releases — always check the source.\n' +
  "Mazda may publish an English version later; we correct entries when that happens.*";

function formatLongDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatShortDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function renderJdmOnlyEntry(entry: JdmOnlyEntry): string {
  return [
    `### ${entry.headline}`,
    "",
    entry.summary,
    "",
    `**Why it matters:** ${entry.whyItMatters}`,
    "",
    `Source: [${entry.titleJa}](${entry.urlJa}) (Japanese only, as of this writing)`,
  ].join("\n");
}

export function renderDraft(input: RenderDraftInput): string {
  const frontmatter = [
    "---",
    `date: ${input.date}`,
    `jdm_only_count: ${input.jdmOnly.length}`,
    `paired_count: ${input.paired.length}`,
    `generated_by: ${input.generatedBy}`,
    "---",
  ].join("\n");

  const heading = `# Mazda News — ${formatLongDate(input.date)}`;

  const jdmSection = [
    "## 🇯🇵 JDM Watch — not published in English",
    "",
    input.jdmOnly.map(renderJdmOnlyEntry).join("\n\n"),
  ].join("\n");

  const pairedSection = [
    "## Also from Mazda",
    "",
    input.paired
      .map((entry) => `- [${entry.titleEn}](${entry.urlEn}) — ${formatShortDate(entry.publishedAt)}`)
      .join("\n"),
  ].join("\n");

  const corrections = input.corrections ?? [];
  const correctionsSection =
    corrections.length === 0
      ? null
      : [
          "**Corrections:**",
          "",
          ...corrections.map(
            (entry) =>
              `- Mazda has since published an English version of "${entry.titleJa}": [link](${entry.urlEn})`,
          ),
        ].join("\n");

  const sections = [frontmatter, "", heading, "", jdmSection, "", "---", "", pairedSection];
  if (correctionsSection) {
    sections.push("", "---", "", correctionsSection);
  }
  sections.push("", "---", "", FOOTER, "");

  return sections.join("\n");
}
