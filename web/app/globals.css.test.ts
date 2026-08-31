import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

function readMediaBlock(maxWidth: number) {
  const marker = `@media (max-width: ${maxWidth}px) {`;
  const blocks: string[] = [];
  let cursor = 0;
  while (true) {
    const start = styles.indexOf(marker, cursor);
    if (start < 0) break;
    const end = styles.indexOf("\n}", start);
    blocks.push(end < 0 ? styles.slice(start) : styles.slice(start, end + 2));
    cursor = end < 0 ? styles.length : end + 2;
  }
  return blocks.join("\n");
}

describe("响应式布局规则", () => {
  it("窄屏内容页会让顶部操作、报告摘要和报告操作可收缩", () => {
    const narrow = readMediaBlock(680);

    expect(narrow).toContain(".report-header { align-items:flex-start; flex-wrap:wrap;");
    expect(narrow).toContain(".report-actions { width:100%; }");
    expect(narrow).toContain(".report-hero { flex-direction:column; align-items:flex-start;");
    expect(narrow).toContain(".report-hero h1 { overflow-wrap:anywhere; }");
  });

  it("手机端产品页的搜索和上传操作不会挤出顶部工具区", () => {
    const narrow = readMediaBlock(620);

    expect(narrow).toContain(".topbar { align-items: flex-start; flex-wrap: wrap;");
    expect(narrow).toContain(".topbar-custom-action { min-width: 0; flex: 1; }");
    expect(narrow).toContain(".topbar-custom-action .page-search { min-width: 0; width: auto; flex: 1; }");
  });

  it("手机端会议中心仍保留可收缩的会议搜索", () => {
    const narrow = readMediaBlock(680);

    expect(narrow).toContain(".asset-toolbar { align-items:stretch; flex-wrap:wrap;");
    expect(narrow).toContain(".asset-search { display:flex; width:min(100%, 260px); flex:1 1 160px; }");
    expect(narrow).not.toContain(".asset-search { display:none; }");
  });
});
