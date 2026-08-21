import { describe, expect, it } from "vitest";
import { renderButtonContent } from "./toolbar";

const button = (extra: Partial<Parameters<typeof renderButtonContent>[0]> = {}) => ({
  id: "openInBtn",
  icon: "<svg></svg>",
  title: "Open in",
  visible: true,
  onClick: () => undefined,
  ...extra
});

describe("renderButtonContent", () => {
  it("leaves an unlabelled button as its icon, which is the whole toolbar's shape", () => {
    expect(renderButtonContent(button())).toBe("<svg></svg>");
  });

  it("puts the label beside the icon once there is one", () => {
    const html = renderButtonContent(button({ label: "VS Code" }));

    expect(html).toContain('class="splitBtnMain"');
    expect(html).toContain('<span class="splitBtnLabel">VS Code</span>');
    expect(html).not.toContain("splitBtnMenu");
  });

  it("adds the chevron half only when there is a menu behind it", () => {
    const html = renderButtonContent(button({ label: "VS Code", menuActions: () => [] }));

    expect(html).toContain('class="splitBtnMenu"');
    // The chevron is the second half, so the click handler can tell the two
    // apart by which one the event came from.
    expect(html.indexOf("splitBtnMain")).toBeLessThan(html.indexOf("splitBtnMenu"));
  });

  it("escapes a tool name, which is the user's own text", () => {
    const html = renderButtonContent(button({ label: '<img src=x onerror="alert(1)">' }));

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
