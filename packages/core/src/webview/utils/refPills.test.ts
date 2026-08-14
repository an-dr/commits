import { describe, expect, it } from "vitest";
import { renderTagPill } from "./refPills";

describe("renderTagPill", () => {
  it("carries no icon, since the badge's shape is what says tag", () => {
    const html = renderTagPill("v1.0.0");

    expect(html).not.toContain("<svg");
    expect(html).toContain("v1.0.0");
  });

  it("keeps the class every surface styles the pennant through", () => {
    expect(renderTagPill("v1.0.0")).toContain('class="gitRef tag"');
  });

  it("still names the tag in its compact form, which has no icon to fall back on", () => {
    const html = renderTagPill("v1.0.0", { compact: true });

    expect(html).toContain("gitRef tag compact");
    expect(html).toContain("v1.0.0");
  });

  it("escapes a tag name that looks like markup", () => {
    const html = renderTagPill('v1<img src=x onerror="alert(1)">');

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("reports the tag type and drag data the callers rely on", () => {
    const html = renderTagPill("v1.0.0", { tagType: "annotated", draggable: true });

    expect(html).toContain('data-tagtype="annotated"');
    expect(html).toContain('data-drag-ref-type="tag"');
    expect(html).toContain('data-drag-ref-name="v1.0.0"');
    expect(html).toContain("draggable=\"true\"");
  });

  it("titles the badge for the reader, or takes the caller's wording", () => {
    expect(renderTagPill("v1.0.0")).toContain('title="Tag: v1.0.0"');
    expect(renderTagPill("v1.0.0", { title: "Release" })).toContain('title="Release"');
  });
});
