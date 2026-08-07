import { describe, expect, it } from "vitest";
import { gravatarUrl, md5 } from "./gravatar";

describe("md5", () => {
  it("matches known RFC 1321 test vectors", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5("abcdefghijklmnopqrstuvwxyz")).toBe("c3fcd3d76192e4007dfb496cca67e13b");
  });
});

describe("gravatarUrl", () => {
  it("hashes the trimmed, lowercased email, matching Gravatar's own documented example", () => {
    expect(gravatarUrl("MyEmailAddress@example.com")).toBe(
      "https://www.gravatar.com/avatar/0bc83cb571cd1c50ba6f3e8a78ef1346?s=80&d=404",
    );
  });

  it("normalizes case and surrounding whitespace before hashing", () => {
    expect(gravatarUrl("  MyEmailAddress@example.com  ")).toBe(gravatarUrl("myemailaddress@example.com"));
  });
});
