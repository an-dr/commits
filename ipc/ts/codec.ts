const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Builds bones fixed-layout little-endian payloads. */
export class Writer {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  u8(value: number): this {
    assertIntegerInRange(value, 0, 0xff, "u8");
    return this.raw(Uint8Array.of(value));
  }

  u16(value: number): this {
    assertIntegerInRange(value, 0, 0xffff, "u16");
    this.pushNumber(2, (view) => view.setUint16(0, value, true));
    return this;
  }

  u32(value: number): this {
    assertIntegerInRange(value, 0, 0xffff_ffff, "u32");
    this.pushNumber(4, (view) => view.setUint32(0, value, true));
    return this;
  }

  i32(value: number): this {
    assertIntegerInRange(value, -0x8000_0000, 0x7fff_ffff, "i32");
    this.pushNumber(4, (view) => view.setInt32(0, value, true));
    return this;
  }

  f32(value: number): this {
    this.pushNumber(4, (view) => view.setFloat32(0, value, true));
    return this;
  }

  raw(value: Uint8Array): this {
    // Keep arbitrary payloads as chunks instead of spreading their bytes into
    // Array.push. The generated page exceeds some JS runtimes' call-argument
    // limit, and copying it byte by byte is prohibitively slow in WASM.
    this.chunks.push(value.slice());
    this.length += value.length;
    return this;
  }

  string(value: string): this {
    const bytes = encoder.encode(value);
    if (bytes.length > 0xffff) {
      throw new RangeError("string exceeds u16::MAX bytes");
    }
    return this.u16(bytes.length).raw(bytes);
  }

  blob(value: Uint8Array): this {
    return this.u32(value.length).raw(value);
  }

  finish(): Uint8Array {
    const bytes = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }

  private pushNumber(
    length: number,
    write: (view: DataView) => void,
  ): void {
    const buffer = new ArrayBuffer(length);
    write(new DataView(buffer));
    this.raw(new Uint8Array(buffer));
  }
}

function assertIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  type: string,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${type} value is out of range`);
  }
}

/** Reads bones fixed-layout payloads with bounds and UTF-8 validation. */
export class Reader {
  private position = 0;

  constructor(private readonly bytes: Uint8Array) {}

  u8(): number {
    return this.take(1)[0];
  }

  u16(): number {
    return this.number(2, (view) => view.getUint16(0, true));
  }

  u32(): number {
    return this.number(4, (view) => view.getUint32(0, true));
  }

  i32(): number {
    return this.number(4, (view) => view.getInt32(0, true));
  }

  f32(): number {
    return this.number(4, (view) => view.getFloat32(0, true));
  }

  string(): string {
    return decoder.decode(this.take(this.u16()));
  }

  blob(): Uint8Array {
    return this.take(this.u32());
  }

  rest(): Uint8Array {
    return this.take(this.bytes.length - this.position);
  }

  stringRest(): string {
    return decoder.decode(this.rest());
  }

  finish(): void {
    if (this.position !== this.bytes.length) {
      throw new Error("trailing bytes");
    }
  }

  private number(
    length: number,
    read: (view: DataView) => number,
  ): number {
    const bytes = this.take(length);
    return read(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  }

  private take(length: number): Uint8Array {
    if (length < 0 || this.bytes.length - this.position < length) {
      throw new Error("truncated payload");
    }
    const value = this.bytes.subarray(this.position, this.position + length);
    this.position += length;
    return value;
  }
}
