import { describe, expect, it } from "vitest";
import { isCategoryExcluded, isPdfOnly } from "./sources.js";

describe("isCategoryExcluded (§3.7)", () => {
  it("excludes all 株主・投資家情報 items regardless of title", () => {
    expect(
      isCategoryExcluded({ category: "株主・投資家情報", title: "2026年度決算発表", lang: "ja" }),
    ).toBe(true);
  });

  it("excludes 企業情報 items whose title mentions a keyword", () => {
    expect(
      isCategoryExcluded({ category: "企業情報", title: "役員人事異動のお知らせ", lang: "ja" }),
    ).toBe(true);
    expect(
      isCategoryExcluded({ category: "企業情報", title: "組織改革について", lang: "ja" }),
    ).toBe(true);
  });

  it("keeps other 企業情報 items that don't mention an excluded keyword", () => {
    expect(
      isCategoryExcluded({ category: "企業情報", title: "新工場の稼働について", lang: "ja" }),
    ).toBe(false);
  });

  it("keeps クルマ・技術 and other processed categories", () => {
    expect(
      isCategoryExcluded({ category: "クルマ・技術", title: "新型車を発表", lang: "ja" }),
    ).toBe(false);
    expect(isCategoryExcluded({ category: "その他", title: "何か", lang: "ja" })).toBe(false);
  });

  it("excludes the English Investor Relations category too", () => {
    expect(
      isCategoryExcluded({
        category: "Investor Relations",
        title: "FY2026 Financial Results",
        lang: "en",
      }),
    ).toBe(true);
  });
});

describe("isPdfOnly (§3.6)", () => {
  it("is true when the title has a [PDF形式] marker and the link is a .pdf", () => {
    expect(
      isPdfOnly({
        title: "マツダ、株主総会招集通知を掲載[PDF形式]",
        url: "https://newsroom.mazda.com/ja/publicity/release/2026/202609/260901c.pdf",
      }),
    ).toBe(true);
  });

  it("is true for the English [PDF format] marker", () => {
    expect(
      isPdfOnly({
        title: "Notice of Annual Shareholders Meeting [PDF format]",
        url: "https://newsroom.mazda.com/en/publicity/release/2026/202609/260901c.pdf",
      }),
    ).toBe(true);
  });

  it("is false for a normal .html release even with a companion PDF download", () => {
    expect(
      isPdfOnly({
        title: "マツダ、「マツダ ロードスター」を商品改良",
        url: "https://newsroom.mazda.com/ja/publicity/release/2026/202606/260626a.html",
      }),
    ).toBe(false);
  });

  it("is false when the marker is present but the link is not a .pdf", () => {
    expect(
      isPdfOnly({
        title: "何か[PDF形式]",
        url: "https://newsroom.mazda.com/ja/publicity/release/2026/202609/260901c.html",
      }),
    ).toBe(false);
  });
});
