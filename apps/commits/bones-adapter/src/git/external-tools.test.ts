import { describe, expect, it } from "vitest";
import { buildToolRun, diffSideName, gitShowArgs, toBase64 } from "./external-tools";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("toBase64", () => {
  it("pads a length that is not a multiple of three, as base64 requires", () => {
    expect(toBase64(bytes(""))).toBe("");
    expect(toBase64(bytes("a"))).toBe("YQ==");
    expect(toBase64(bytes("ab"))).toBe("YWI=");
    expect(toBase64(bytes("abc"))).toBe("YWJj");
    expect(toBase64(bytes("hello world"))).toBe("aGVsbG8gd29ybGQ=");
  });

  it("carries bytes no string could, which is why a diff side is encoded at all", () => {
    expect(toBase64(Uint8Array.of(0, 255, 128, 1))).toBe("AP+AAQ==");
  });
});

describe("diffSideName", () => {
  it("names the file itself, since that is what the diff tool puts in its title", () => {
    expect(diffSideName("src/webview/main.ts")).toBe("main.ts");
    expect(diffSideName("README.md")).toBe("README.md");
  });

  it("falls back rather than naming a file nothing", () => {
    expect(diffSideName("")).toBe("file");
    expect(diffSideName("src/")).toBe("file");
  });
});

describe("buildToolRun", () => {
  it("frames a plain run with no diff sides", () => {
    expect(buildToolRun("code", ["-n", "C:/repo"])).toBe("code\n\n\n\n\n-n\nC:/repo");
  });

  it("carries both revisions under the file's own name", () => {
    const run = buildToolRun("code", ["--diff", "{left}", "{right}"], {
      left: { path: "src/a.ts", content: bytes("a") },
      right: { path: "src/a.ts", content: bytes("b") },
    });

    expect(run).toBe("code\na.ts\nYQ==\na.ts\nYg==\n--diff\n{left}\n{right}");
  });

  it("leaves the placeholders alone: only the host knows where the files land", () => {
    const run = buildToolRun("meld", ["{left}", "{right}"], {
      left: { path: "a.ts", content: bytes("a") },
      right: { path: "a.ts", content: bytes("a") },
    });

    expect(run.endsWith("{left}\n{right}")).toBe(true);
  });
});

describe("gitShowArgs", () => {
  it("reads one path at one revision", () => {
    expect(gitShowArgs("abc1234", "src/a.ts")).toEqual(["show", "abc1234:src/a.ts"]);
  });
});
