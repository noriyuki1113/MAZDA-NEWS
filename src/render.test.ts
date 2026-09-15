import { describe, expect, it } from "vitest";
import { renderDraft } from "./render.js";

describe("renderDraft", () => {
  it("renders the two-part draft per §5.2's template", () => {
    const markdown = renderDraft({
      date: "2026-09-15",
      generatedBy: "claude-sonnet-4-6",
      jdmOnly: [
        {
          titleJa: "マツダ、新型車を発表",
          urlJa: "https://newsroom.mazda.com/ja/publicity/release/2026/202609/260915a.html",
          headline: "Mazda unveils a new model",
          summary: "Sentence one. Sentence two. Sentence three.",
          whyItMatters: "It signals Mazda's next design direction.",
        },
      ],
      paired: [
        {
          titleEn: "Mazda Reports August 2026 Production and Sales",
          urlEn: "https://newsroom.mazda.com/en/publicity/release/2026/202609/260901a.html",
          publishedAt: "2026-09-01",
        },
      ],
    });

    // frontmatter
    expect(markdown).toContain("---\ndate: 2026-09-15\n");
    expect(markdown).toContain("jdm_only_count: 1");
    expect(markdown).toContain("paired_count: 1");
    expect(markdown).toContain("generated_by: claude-sonnet-4-6");

    // heading uses the long English date format
    expect(markdown).toContain("# Mazda News — September 15, 2026");

    // JDM Watch section
    expect(markdown).toContain("## 🇯🇵 JDM Watch — not published in English");
    expect(markdown).toContain("### Mazda unveils a new model");
    expect(markdown).toContain("Sentence one. Sentence two. Sentence three.");
    expect(markdown).toContain("**Why it matters:** It signals Mazda's next design direction.");
    expect(markdown).toContain(
      "Source: [マツダ、新型車を発表](https://newsroom.mazda.com/ja/publicity/release/2026/202609/260915a.html) (Japanese only, as of this writing)",
    );

    // Also from Mazda section, with the short "Sep 1" date format
    expect(markdown).toContain("## Also from Mazda");
    expect(markdown).toContain(
      "- [Mazda Reports August 2026 Production and Sales](https://newsroom.mazda.com/en/publicity/release/2026/202609/260901a.html) — Sep 1",
    );

    // unofficial footer
    expect(markdown).toContain("Unofficial fan project");
    expect(markdown).toContain("Not affiliated with or endorsed by Mazda Motor Corporation");
    expect(markdown).toContain("we correct entries when that happens");
  });

  it("renders multiple JDM Watch entries as separate blocks", () => {
    const markdown = renderDraft({
      date: "2026-09-15",
      generatedBy: "claude-sonnet-4-6",
      jdmOnly: [
        {
          titleJa: "記事A",
          urlJa: "https://newsroom.mazda.com/ja/a.html",
          headline: "Headline A",
          summary: "Summary A.",
          whyItMatters: "Why A.",
        },
        {
          titleJa: "記事B",
          urlJa: "https://newsroom.mazda.com/ja/b.html",
          headline: "Headline B",
          summary: "Summary B.",
          whyItMatters: "Why B.",
        },
      ],
      paired: [],
    });

    expect(markdown).toContain("### Headline A");
    expect(markdown).toContain("### Headline B");
    expect(markdown.indexOf("### Headline A")).toBeLessThan(markdown.indexOf("### Headline B"));
  });

  it("still renders both section headers with zero paired entries", () => {
    const markdown = renderDraft({
      date: "2026-09-15",
      generatedBy: "claude-sonnet-4-6",
      jdmOnly: [
        {
          titleJa: "記事A",
          urlJa: "https://newsroom.mazda.com/ja/a.html",
          headline: "Headline A",
          summary: "Summary A.",
          whyItMatters: "Why A.",
        },
      ],
      paired: [],
    });

    expect(markdown).toContain("paired_count: 0");
    expect(markdown).toContain("## Also from Mazda");
  });
});
