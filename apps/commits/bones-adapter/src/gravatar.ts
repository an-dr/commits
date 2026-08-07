/**
 * MD5 and the Gravatar URL it feeds, written by hand rather than pulled from
 * npm: this module is componentized to WASM via componentize-js/jco, whose
 * runtime is a WASI sandbox rather than full Node — a package expecting
 * Node's native `crypto` bindings would not necessarily work there. MD5 is
 * cryptographically broken but that is irrelevant here; it is Gravatar's URL
 * scheme, not a security boundary.
 */

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K = Array.from({ length: 64 }, (_, i) =>
  Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0,
);

function leftRotate(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function toUtf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** RFC 1321 MD5, returned as a 32-character lowercase hex digest. */
export function md5(text: string): string {
  const bytes = toUtf8Bytes(text);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push((bitLength / 2 ** (8 * i)) & 0xff);

  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];

  for (let chunkStart = 0; chunkStart < bytes.length; chunkStart += 64) {
    const words = new Array<number>(16);
    for (let i = 0; i < 16; i++) {
      const offset = chunkStart + i * 4;
      words[i] =
        (bytes[offset]! |
          (bytes[offset + 1]! << 8) |
          (bytes[offset + 2]! << 16) |
          (bytes[offset + 3]! << 24)) >>>
        0;
    }

    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + K[i]! + words[g]!) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + leftRotate(f, S[i]!)) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0].map(toLittleEndianHex).join("");
}

function toLittleEndianHex(word: number): string {
  let hex = "";
  for (let i = 0; i < 4; i++) {
    hex += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Gravatar's documented scheme: MD5 of the trimmed, lowercased email.
 * `d=404` asks Gravatar to fail with a 404 instead of returning its default
 * mystery-person placeholder, so "no gravatar for this address" is
 * distinguishable from a real image and the caller can fall back to the
 * app's own procedural avatar or initials.
 */
export function gravatarUrl(email: string): string {
  const hash = md5(email.trim().toLowerCase());
  return `https://www.gravatar.com/avatar/${hash}?s=80&d=404`;
}
