import { Buffer } from "buffer";
import * as utfx from "utfx";
import Long from "long";

interface SNumber {
  value: number;
  length: number
}

interface SLong {
  value: Long;
  length: number
}


type NumberValue = SNumber | number; 
type LongValue = SLong | Long;

const EMPTY_BUFFER = Buffer.allocUnsafe(0);

const _isString = (value: any): boolean => typeof value === "string" || value instanceof String;

const stringSource = (s) => {
  let i = 0;
  return () => i < s.length ? s.charCodeAt(i++) : null;
};

const stringDestination = () => {
  const cs: number[] = [];
  const ps: string[] = [];
  return (...args) => {
    if (args.length === 0) {
      return `${ps.join("")}${String.fromCharCode(...cs)}`;
    }
    if (cs.length + args.length > 1024) {
      ps.push(String.fromCharCode(...cs));
      cs.length = 0;
    }
    cs.push(...args);
  };
};


export default class SmartBuffer {

  static EMPTY_BUFFER = EMPTY_BUFFER;

  /**
   * Default initial capacity
   */
  static DEFAULT_CAPACITY = 64;

  /**
   * Default no assertions flag
   */
  static DEFAULT_NOASSERT = false;

  /**
   * Maximum number of bytes required to store a 32bit base 128 variable-length integer
   */
  static MAX_VARINT32_BYTES = 5;

  /**
   * Maximum number of bytes required to store a 64bit base 128 variable-length integer
   */
  static MAX_VARINT64_BYTES = 10;

  /**
   * Metrics representing number of UTF8 characters. Evaluates to `c`.
   */
  static METRICS_CHARS = "c";

  /**
   * Metrics representing number of bytes. Evaluates to `b`.
   */
  static METRICS_BYTES = "b";

  private buffer: Buffer;
  private woffset: number;
  private roffset: number;
  private noAssert: boolean;

  /**
     * Constructs a new SmartBuffer
     *
     * @param {number} [capacity] Initial capacity. Defaults to SmartBuffer.DEFAULT_CAPACITY(64)
     * @param {boolean} [noAssert] Whether to skip assertions of offsets and values. Defaults to SmartBuffer.DEFAULT_NOASSERT(false)
     */
  constructor(capacity = SmartBuffer.DEFAULT_CAPACITY, noAssert = SmartBuffer.DEFAULT_NOASSERT) {
    if (!noAssert) {
      capacity = capacity | 0;
      if (capacity < 0) {
        throw new TypeError("Illegal capacity");
      }
      noAssert = Boolean(noAssert);
    }

    this.buffer = capacity === 0 ? EMPTY_BUFFER : Buffer.allocUnsafe(capacity);
    this.woffset = 0;
    this.roffset = 0;
    this.noAssert = noAssert;
  }

  /**
     * Gets the number of remaining readable bytes or effective length.
     *
     * @returns {number}
     */
  get length() {
    return this.woffset - this.roffset;
  }

  /**
     * Gets the capacity of this SmartBuffer's backing buffer or real length.
     *
     * @returns {number}
     */
  get capacity() {
    return this.buffer.length;
  }

  /**
     * Reads a BitSet as an array of booleans.
     *
     * @param {number} [offset] Offset to read from. Will use and increase offset by length if omitted.
     * @returns {boolean[]}
     */
  readBitSet(offset) {
    const relative = offset === void 0;
    if (relative) {
      offset = this.roffset;
    }

    const ret = this.readVarint32(offset) as SNumber;
    const bits = ret.value;
    let bytes = (bits >> 3);
    let bit = 0;
    const value: boolean[] = [];
    let k;

    offset += ret.length;

    while (bytes--) {
      k = this.readInt8(offset++);
      value[bit++] = Boolean(k & 0x01);
      value[bit++] = Boolean(k & 0x02);
      value[bit++] = Boolean(k & 0x04);
      value[bit++] = Boolean(k & 0x08);
      value[bit++] = Boolean(k & 0x10);
      value[bit++] = Boolean(k & 0x20);
      value[bit++] = Boolean(k & 0x40);
      value[bit++] = Boolean(k & 0x80);
    }

    if (bit < bits) {
      let m = 0;
      k = this.readInt8(offset++);
      while (bit < bits) {
        value[bit++] = Boolean((k >> (m++)) & 1);
      }
    }

    if (relative) {
      this.roffset = offset;
    }
    return value;
  }

  /**
     * Reads the specified number of bytes.
     *
     * @param {number} length Number of bytes to read
     * @param {number} [offset] Offset to read from. Will use and increase offset by length if omitted.
     * @returns {SmartBuffer}
     */
  read(length, offset) {
    const relative = offset === void 0;
    if (relative) {
      offset = this.roffset;
    }
    if (!this.noAssert) {
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      offset >>>= 0;
      if (offset < 0 || offset + length > this.buffer.length) {
        throw new TypeError(`Illegal offset: 0 <= ${offset} (${length}) <= ${this.buffer.length}`);
      }
    }
    const slice = this.slice(offset, offset + length);
    if (relative) {
      this.roffset += length;
    }
    return slice;
  }

  /**
     * Reads an 8bit signed integer
     *
     * @param {number} [offset] Offset to read from
     * @returns {number}
     */
  readInt8(offset) {
    offset = this._checkRead(offset, 1);
    let value = this.buffer[offset];
    if ((value & 0x80) === 0x80) {
      value = -(0xFF - value + 1); // Cast to signed
    }
    return value;
  }

  /**
     * Reads an 8bit unsigned integer
     *
     * @param {number} [offset] Offset to read from
     * @returns {number}
     */
  readUInt8(offset) {
    offset = this._checkRead(offset, 1);
    return this.buffer[offset];
  }

  /**
     * Reads a 16bit signed le integer
     *
     * @param {number} [offset] Offset to read from
     * @returns {number}
     */
  readInt16LE(offset) {
    offset = this._checkRead(offset, 2);
    let value = 0;
    value = this.buffer[offset];
    value |= this.buffer[offset + 1] << 8;
    if ((value & 0x8000) === 0x8000) {
      value = -(0xFFFF - value + 1); // Cast to signed
    }
    return value;
  }

  /**
     * Reads a 16bit signed be integer
     *
     * @param {number} [offset] Offset to read from
     * @returns {number}
     */
  readInt16BE(offset) {
    offset = this._checkRead(offset, 2);
    let value = 0;
    value = this.buffer[offset] << 8;
    value |= this.buffer[offset + 1];
    if ((value & 0x8000) === 0x8000) {
      value = -(0xFFFF - value + 1); // Cast to signed
    }
    return value;
  }

  /**
     * Reads a 16bit unsigned le integer
     *
     * @param {number} [offset] Offset to read from
     * @returns {number}
     */
  readUInt16LE(offset) {
    offset = this._checkRead(offset, 2);
    let value = 0;
    value = this.buffer[offset];
    value |= this.buffer[offset + 1] << 8;
    return value;
  }

  /**
     * Reads a 16bit unsigned be integer
     *
     * @param {number} [offset] Offset to read from
     * @returns {number}
     */
  readUInt16BE(offset) {
    offset = this._checkRead(offset, 2);
    let value = 0;
    value = this.buffer[offset] << 8;
    value |= this.buffer[offset + 1];
    return value;
  }

  /**
     * Reads a 24bit unsigned be integer
     *
     * @param {number} [offset] Offset to read from
     * @returns {number}
     */
  readUInt24BE(offset) {
    offset = this._checkRead(offset, 3);
    let value = 0;
    value = this.buffer[offset] << 16;
    value |= this.buffer[offset + 1] << 8;
    value |= this.buffer[offset + 2];
    value |= 0; // Cast to signed
    return value;
  }

  /**
     * Reads a 32bit signed le integer
     *
     * @param {number} [offset] Offset to read from
     * @returns {number}
     */
  readInt32LE(offset) {
    offset = this._checkRead(offset, 4);
    let value = 0;
    value = this.buffer[offset + 2] << 16;
    value |= this.buffer[offset + 1] << 8;
    value |= this.buffer[offset];
    value += this.buffer[offset + 3] << 24 >>> 0;
    value |= 0; // Cast to signed
    return value;
  }

  /**
     * Reads a 32bit signed be integer
     *
     * @param {number} [offset] Offset to read from
     * @returns {number}
     */
  readInt32BE(offset) {
    offset = this._checkRead(offset, 4);
    let value = 0;
    value = this.buffer[offset + 1] << 16;
    value |= this.buffer[offset + 2] << 8;
    value |= this.buffer[offset + 3];
    value += this.buffer[offset] << 24 >>> 0;
    value |= 0; // Cast to signed
    return value;
  }

  /**
     * Reads a 32bit unsigned le integer
     *
     * @param {number} [offset] Offset to read from
     * @returns {number}
     */
  readUInt32LE(offset) {
    offset = this._checkRead(offset, 4);
    let value = 0;
    value = this.buffer[offset + 2] << 16;
    value |= this.buffer[offset + 1] << 8;
    value |= this.buffer[offset];
    value += this.buffer[offset + 3] << 24 >>> 0;
    return value;
  }

  /**
     * Reads a 32bit unsigned be integer
     *
     * @param {number} [offset] Offset to read from
     * @returns {number}
     */
  readUInt32BE(offset) {
    offset = this._checkRead(offset, 4);
    let value = 0;
    value = this.buffer[offset + 1] << 16;
    value |= this.buffer[offset + 2] << 8;
    value |= this.buffer[offset + 3];
    value += this.buffer[offset] << 24 >>> 0;
    return value;
  }

  /**
     * Reads a 64bit signed le integer as math.Long
     *
     * @param {number} [offset] Offset to read from
     * @returns {ateos.math.Long}
     */
  readInt64LE(offset) {
    offset = this._checkRead(offset, 8);
    let lo = 0;
    let hi = 0;
    lo = this.buffer[offset + 2] << 16;
    lo |= this.buffer[offset + 1] << 8;
    lo |= this.buffer[offset];
    lo += this.buffer[offset + 3] << 24 >>> 0;
    offset += 4;
    hi = this.buffer[offset + 2] << 16;
    hi |= this.buffer[offset + 1] << 8;
    hi |= this.buffer[offset];
    hi += this.buffer[offset + 3] << 24 >>> 0;
    return new Long(lo, hi, false);
  }

  /**
     * Reads a 64bit signed be integer as math.Long
     *
     * @param {number} [offset] Offset to read from
     * @returns {ateos.math.Long}
     */
  readInt64BE(offset) {
    offset = this._checkRead(offset, 8);
    let lo = 0;
    let hi = 0;
    hi = this.buffer[offset + 1] << 16;
    hi |= this.buffer[offset + 2] << 8;
    hi |= this.buffer[offset + 3];
    hi += this.buffer[offset] << 24 >>> 0;
    offset += 4;
    lo = this.buffer[offset + 1] << 16;
    lo |= this.buffer[offset + 2] << 8;
    lo |= this.buffer[offset + 3];
    lo += this.buffer[offset] << 24 >>> 0;
    return new Long(lo, hi, false);
  }

  /**
     * Reads a 64bit unsigned le integer as math.Long
     *
     * @param {number} [offset] Offset to read from
     * @returns {ateos.math.Long}
     */
  readUInt64LE(offset) {
    offset = this._checkRead(offset, 8);
    let lo = 0;
    let hi = 0;
    lo = this.buffer[offset + 2] << 16;
    lo |= this.buffer[offset + 1] << 8;
    lo |= this.buffer[offset];
    lo += this.buffer[offset + 3] << 24 >>> 0;
    offset += 4;
    hi = this.buffer[offset + 2] << 16;
    hi |= this.buffer[offset + 1] << 8;
    hi |= this.buffer[offset];
    hi += this.buffer[offset + 3] << 24 >>> 0;
    return new Long(lo, hi, true);
  }

  /**
     * Reads a 64bit unsigned be integer as math.Long
     *
     * @param {number} [offset] Offset to read from
     * @returns {ateos.math.Long}
     */
  readUInt64BE(offset) {
    offset = this._checkRead(offset, 8);
    let lo = 0;
    let hi = 0;
    hi = this.buffer[offset + 1] << 16;
    hi |= this.buffer[offset + 2] << 8;
    hi |= this.buffer[offset + 3];
    hi += this.buffer[offset] << 24 >>> 0;
    offset += 4;
    lo = this.buffer[offset + 1] << 16;
    lo |= this.buffer[offset + 2] << 8;
    lo |= this.buffer[offset + 3];
    lo += this.buffer[offset] << 24 >>> 0;
    return new Long(lo, hi, true);
  }

  /**
     * Reads a 32bit le float
     *
     * @param {number} [offset] Offset to read from
     * @returns {number}
     */
  readFloatLE(offset) {
    offset = this._checkRead(offset, 4);
    return this.buffer.readFloatLE(offset, true);
  }

  /**
     * Reads a 32bit be float
     *
     * @param {number} [offset] Offset to read from
     * @returns {number}
     */
  readFloatBE(offset) {
    offset = this._checkRead(offset, 4);
    return this.buffer.readFloatBE(offset, true);
  }

  /**
     * Reads a 64bit le float
     *
     * @param {number} [offset] Offset to read from
     * @returns {number}
     */
  readDoubleLE(offset) {
    offset = this._checkRead(offset, 8);
    return this.buffer.readDoubleLE(offset, true);
  }

  /**
     * Reads a 64bit be float
     *
     * @param {number} [offset] Offset to read from
     * @returns {number}
     */
  readDoubleBE(offset) {
    offset = this._checkRead(offset, 8);
    return this.buffer.readDoubleBE(offset, true);
  }

  /**
     * Appends some data to this SmartBuffer.
     * This will overwrite any contents behind the specified offset up to the appended data's length.
     *
     * @param {Wrappable} source The source write from
     * @param {number} [offset] Offset to write to
     * @param {number} [length] length to read from the source
     * @param {string} [encoding] encoding to use for wrapping the source in bytearray
     */
  write(source, offset, length, encoding) {
    const relative = offset === void 0;
    if (relative) {
      offset = this.woffset;
    }
    const result = offset >>>= 0;
    if (!this.noAssert) {
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      if (offset < 0 || offset + 0 > this.buffer.length) {
        throw new RangeError(`Illegal offset: 0 <= ${offset} (0) <= ${this.buffer.length}`);
      }
    }
    // let length;
    const isString = _isString(source);
    if (isString) {
      length = length || Buffer.byteLength(source);
    } else {
      if (!(source instanceof SmartBuffer)) {
        source = SmartBuffer.wrap(source, encoding);
      }
      length = source.woffset - source.roffset;
    }

    if (length <= 0) {
      return this; // Nothing to append
    }
    offset += length;
    let capacity = this.buffer.length;
    if (offset > capacity) {
      this.resize((capacity *= 2) > offset ? capacity : offset);
    }
    if (isString) {
      this.buffer.write(source, result);
    } else {
      source.buffer.copy(this.buffer, result, source.roffset, source.woffset);
      source.roffset += length;
    }
    if (relative) {
      this.woffset += length;
    }
    return this;
  }

  /**
     * Writes the array as a bitset.
     * @param {boolean[]} value Array of booleans to write
     * @param {number} [offset] Offset to write to
     * @returns {SmartBuffer}
     */
  writeBitSet(value: Array<any>, offset) {
    const relative = offset === void 0;
    if (relative) {
      offset = this.woffset;
    }
    if (!this.noAssert) {
      if (!Array.isArray(value)) {
        throw new TypeError("Illegal BitSet: Not an array");
      }
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      offset >>>= 0;
      if (offset < 0 || offset + 0 > this.buffer.length) {
        throw new RangeError(`Illegal offset: 0 <= ${offset}  (0) <= ${this.buffer.length}`);
      }
    }

    const start = offset;
    const bits = value.length;
    let bytes = (bits >> 3);
    let bit = 0;
    let k;

    offset += this.writeVarint32(bits, offset);

    while (bytes--) {
      k = (value[bit++] & 1) |
        ((value[bit++]) & 1 << 1) |
        ((value[bit++] & 1) << 2) |
        ((value[bit++] & 1) << 3) |
        ((value[bit++] & 1) << 4) |
        ((value[bit++] & 1) << 5) |
        ((value[bit++] & 1) << 6) |
        ((value[bit++] & 1) << 7);
      this.writeInt8(k, offset++);
    }

    if (bit < bits) {
      let m = 0; k = 0;
      while (bit < bits) {
        k = k | ((value[bit++] & 1) << (m++));
      }
      this.writeInt8(k, offset++);
    }

    if (relative) {
      this.woffset = offset;
      return this;
    }
    return offset - start;
  }

  /**
     * Writes a buffer at the given offset
     *
     * @param {Buffer} buf buffer to write
     * @param {number} [offset] offset to write at
     * @returns {this}
     */
  writeBuffer(buf, offset) {
    if (buf.length === 0) {
      return this;
    }
    const relative = offset === void 0;
    if (relative) {
      offset = this.woffset;
    }
    const targetEnd = offset + buf.length;
    let capacity = this.buffer.length;
    if (targetEnd > capacity) {
      capacity *= 2;
      this.resize(capacity > targetEnd ? capacity : targetEnd);
    }
    buf.copy(this.buffer, offset);
    if (relative) {
      this.woffset = targetEnd;
    }
    return this;
  }

  /**
     * Writes an 8bit signed integer
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeInt8(value, offset) {
    value |= 0;
    offset = this._checkWrite(value, offset, 1);
    this.buffer[offset] = value;
    return this;
  }

  /**
     * Writes an 8bit unsigned integer
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeUInt8(value, offset) {
    value >>>= 0;
    offset = this._checkWrite(value, offset, 1);
    this.buffer[offset] = value;
    return this;
  }

  /**
     * Writes a 16bit signed le integer
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeInt16LE(value, offset) {
    value |= 0;
    offset = this._checkWrite(value, offset, 2);
    this.buffer[offset + 1] = value >>> 8;
    this.buffer[offset] = value;
    return this;
  }

  /**
     * Writes a 16bit signed be integer
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeInt16BE(value, offset) {
    value |= 0;
    offset = this._checkWrite(value, offset, 2);
    this.buffer[offset] = value >>> 8;
    this.buffer[offset + 1] = value;
    return this;
  }

  /**
     * Writes a 16bit unsigned le integer
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeUInt16LE(value, offset) {
    value >>>= 0;
    offset = this._checkWrite(value, offset, 2);
    this.buffer[offset + 1] = value >>> 8;
    this.buffer[offset] = value;
    return this;
  }

  /**
     * Writes a 16bit unsigned be integer
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeUInt16BE(value, offset) {
    value >>>= 0;
    offset = this._checkWrite(value, offset, 2);

    this.buffer[offset] = value >>> 8;
    this.buffer[offset + 1] = value;
    return this;
  }

  /**
     * Writes a 24bit unsigned be integer
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeUInt24BE(value, offset) {
    value >>>= 0;
    offset = this._checkWrite(value, offset, 3);
    this.buffer[offset] = value >>> 16;
    this.buffer[offset + 1] = value >>> 8;
    this.buffer[offset + 2] = value;
    return this;
  }

  /**
     * Writes a 32bit signed le integer
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeInt32LE(value, offset) {
    value |= 0;
    offset = this._checkWrite(value, offset, 4);
    this.buffer[offset + 3] = value >>> 24;
    this.buffer[offset + 2] = value >>> 16;
    this.buffer[offset + 1] = value >>> 8;
    this.buffer[offset] = value;
    return this;
  }

  /**
     * Writes a 32bit signed be integer
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeInt32BE(value, offset) {
    value |= 0;
    offset = this._checkWrite(value, offset, 4);
    this.buffer[offset] = value >>> 24;
    this.buffer[offset + 1] = value >>> 16;
    this.buffer[offset + 2] = value >>> 8;
    this.buffer[offset + 3] = value;
    return this;
  }

  /**
     * Writes a 32bit unsigned le integer
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeUInt32LE(value, offset) {
    value >>>= 0;
    offset = this._checkWrite(value, offset, 4);
    this.buffer[offset + 3] = value >>> 24;
    this.buffer[offset + 2] = value >>> 16;
    this.buffer[offset + 1] = value >>> 8;
    this.buffer[offset] = value;
    return this;
  }

  /**
     * Writes a 32bit unsigned be integer
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeUInt32BE(value, offset) {
    value >>>= 0;
    offset = this._checkWrite(value, offset, 4);
    this.buffer[offset] = value >>> 24;
    this.buffer[offset + 1] = value >>> 16;
    this.buffer[offset + 2] = value >>> 8;
    this.buffer[offset + 3] = value;
    return this;
  }

  /**
     * Writes a 64bit signed le long integer
     *
     * @param {ateos.math.Long | string | number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeInt64LE(value, offset) {
    [value, offset] = this._checkWriteLong(value, offset);
    const lo = value.low;
    const hi = value.high;
    this.buffer[offset + 3] = lo >>> 24;
    this.buffer[offset + 2] = lo >>> 16;
    this.buffer[offset + 1] = lo >>> 8;
    this.buffer[offset] = lo;
    offset += 4;
    this.buffer[offset + 3] = hi >>> 24;
    this.buffer[offset + 2] = hi >>> 16;
    this.buffer[offset + 1] = hi >>> 8;
    this.buffer[offset] = hi;
    return this;
  }

  /**
     * Writes a 64bit signed be long integer
     *
     * @param {ateos.math.Long | string | number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeInt64BE(value, offset) {
    [value, offset] = this._checkWriteLong(value, offset);
    const lo = value.low;
    const hi = value.high;
    this.buffer[offset] = hi >>> 24;
    this.buffer[offset + 1] = hi >>> 16;
    this.buffer[offset + 2] = hi >>> 8;
    this.buffer[offset + 3] = hi;
    offset += 4;
    this.buffer[offset] = lo >>> 24;
    this.buffer[offset + 1] = lo >>> 16;
    this.buffer[offset + 2] = lo >>> 8;
    this.buffer[offset + 3] = lo;
    return this;
  }

  /**
     * Writes a 64bit unsigned le long integer
     *
     * @param {ateos.math.Long | string | number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeUInt64LE(value, offset) {
    [value, offset] = this._checkWriteLong(value, offset);
    const lo = value.low;
    const hi = value.high;
    this.buffer[offset + 3] = lo >>> 24;
    this.buffer[offset + 2] = lo >>> 16;
    this.buffer[offset + 1] = lo >>> 8;
    this.buffer[offset] = lo;
    offset += 4;
    this.buffer[offset + 3] = hi >>> 24;
    this.buffer[offset + 2] = hi >>> 16;
    this.buffer[offset + 1] = hi >>> 8;
    this.buffer[offset] = hi;
    return this;
  }

  /**
     * Writes a 64bit unsigned be long integer
     *
     * @param {ateos.math.Long | string | number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeUInt64BE(value, offset) {
    [value, offset] = this._checkWriteLong(value, offset);
    const lo = value.low;
    const hi = value.high;
    this.buffer[offset] = hi >>> 24;
    this.buffer[offset + 1] = hi >>> 16;
    this.buffer[offset + 2] = hi >>> 8;
    this.buffer[offset + 3] = hi;
    offset += 4;
    this.buffer[offset] = lo >>> 24;
    this.buffer[offset + 1] = lo >>> 16;
    this.buffer[offset + 2] = lo >>> 8;
    this.buffer[offset + 3] = lo;
    return this;
  }

  /**
     * Writes a 32bit le float
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeFloatLE(value, offset) {
    offset = this._checkWrite(value, offset, 4, true);
    this.buffer.writeFloatLE(value, offset, true);
    return this;
  }

  /**
     * Writes a 32bit be float
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeFloatBE(value, offset) {
    offset = this._checkWrite(value, offset, 4, true);
    this.buffer.writeFloatBE(value, offset, true);
    return this;
  }

  /**
     * Writes a 64bit le float
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeDoubleLE(value, offset) {
    offset = this._checkWrite(value, offset, 8, true);
    this.buffer.writeDoubleLE(value, offset, true);
    return this;
  }

  /**
     * Writes a 64bit be float
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this}
     */
  writeDoubleBE(value, offset) {
    offset = this._checkWrite(value, offset, 8, true);
    this.buffer.writeDoubleBE(value, offset, true);
    return this;
  }

  _checkRead(offset, bytes) {
    if (offset === void 0) {
      offset = this.roffset;
      this.roffset += bytes;
    }
    if (!this.noAssert) {
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      if (offset < 0 || offset + bytes > this.buffer.length) {
        throw new RangeError(`Illegal offset: 0 <= ${offset} (${bytes}) <= ${this.buffer.length}`);
      }
    }
    return offset;
  }

  _checkWrite(value: any, offset: number, bytes: number, isFloat?: boolean) {
    if (offset === void 0) {
      offset = this.woffset;
      this.woffset += bytes;
    }
    const result = offset >>>= 0;
    if (!this.noAssert) {
      if (typeof value !== "number" || (!isFloat && value % 1 !== 0)) {
        throw new TypeError(`Illegal value: ${value} (not an integer)`);
      }
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      if (offset < 0 || offset + 0 > this.buffer.length) {
        throw new RangeError(`Illegal offset: 0 <= ${offset} (0) <= ${this.buffer.length}`);
      }
    }
    offset += bytes;
    let capacity = this.buffer.length;
    if (offset > capacity) {
      this.resize((capacity *= 2) > offset ? capacity : offset);
    }
    return result;
  }

  _checkWriteLong(value, offset) {
    if (offset === void 0) {
      offset = this.woffset;
      this.woffset += 8;
    }
    const result = offset >>>= 0;
    if (!this.noAssert) {
      if (typeof value === "number") {
        value = Long.fromNumber(value);
      } else if (_isString(value)) {
        value = Long.fromString(value);
      } else if (!(typeof value === "object" && value instanceof Long)) {
        throw new TypeError(`Illegal value: ${value} (not an integer or Long)`);
      }
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      if (offset < 0 || offset + 0 > this.buffer.length) {
        throw new RangeError(`Illegal offset: 0 <= ${offset} (0) <= ${this.buffer.length}`);
      }
    }
    if (typeof value === "number") {
      value = Long.fromNumber(value);
    } else if (_isString(value)) {
      value = Long.fromString(value);
    }

    offset += 8;
    let capacity = this.buffer.length;
    if (offset > capacity) {
      this.resize((capacity *= 2) > offset ? capacity : offset);
    }
    return [value, result];
  }

  /**
     * Writes a 32bit base 128 variable-length integer
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this | number} this if offset is omitted, else the actual number of bytes written
     */
  writeVarint32(value, offset) {
    const relative = offset === void 0;
    if (relative) {
      offset = this.woffset;
    }
    if (!this.noAssert) {
      if (typeof value !== "number" || value % 1 !== 0) {
        throw new TypeError(`Illegal value: ${value} (not an integer)`);
      }
      value |= 0;
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      offset >>>= 0;
      if (offset < 0 || offset + 0 > this.buffer.length) {
        throw new RangeError(`Illegal offset: 0 <= ${offset} (0) <= ${this.buffer.length}`);
      }
    }
    const size = SmartBuffer.calculateVarint32(value);
    let b;
    offset += size;
    let capacity10 = this.buffer.length;
    if (offset > capacity10) {
      this.resize((capacity10 *= 2) > offset ? capacity10 : offset);
    }
    offset -= size;
    value >>>= 0;
    while (value >= 0x80) {
      b = (value & 0x7f) | 0x80;
      this.buffer[offset++] = b;
      value >>>= 7;
    }
    this.buffer[offset++] = value;
    if (relative) {
      this.woffset = offset;
      return this;
    }
    return size;
  }

  /**
     * Writes a zig-zag encoded 32bit base 128 variable-length integer
     *
     * @param {number} value
     * @param {number} [offset] Offset to write to
     * @returns {this | number} this if offset is omitted, else the actual number of bytes written
     */
  writeVarint32ZigZag(value, offset) {
    return this.writeVarint32(SmartBuffer.zigZagEncode32(value), offset);
  }

  /**
     * Reads a 32bit base 128 variable-length integer
     *
     * @param {number} [offset] Offset to read from
     * @returns {number | { value: number, length: number}} The value read if offset is omitted,
     *      else the value read and the actual number of bytes read
     */
  readVarint32(offset): NumberValue {
    const relative = offset === void 0;
    if (relative) {
      offset = this.roffset;
    }
    if (!this.noAssert) {
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      offset >>>= 0;
      if (offset < 0 || offset + 1 > this.buffer.length) {
        throw new RangeError(`Illegal offset: 0 <= ${offset} (1) <= ${this.buffer.length}`);
      }
    }
    let c = 0;
    let value = 0 >>> 0;
    let b;
    do {
      if (!this.noAssert && offset > this.buffer.length) {
        const err = new Error("Truncated");
        err["truncated"] = true;
        throw err;
      }
      b = this.buffer[offset++];
      if (c < 5) {
        value |= (b & 0x7f) << (7 * c);
      }
      ++c;
    } while ((b & 0x80) !== 0);
    value |= 0;
    if (relative) {
      this.roffset = offset;
      return value;
    }
    return { value, length: c };
  }

  /**
     * Reads a zig-zag encoded 32bit base 128 variable-length integer
     *
     * @param {number} [offset] Offset to read from
     * @returns {number | { value: number, length: number}} The value read if offset is omitted,
     *      else the value read and the actual number of bytes read
     */
  readVarint32ZigZag(offset) {
    let val = this.readVarint32(offset);
    if (typeof val === "object") {
      val.value = SmartBuffer.zigZagDecode32(val.value);
    } else {
      val = SmartBuffer.zigZagDecode32(val);
    }
    return val;
  }

  /**
     * Writes a 64bit base 128 variable-length integer
     *
     * @param {ateos.math.Long | string | number} value
     * @param {number} [offset] Offset to write to
     * @returns {this | number} this if offset is omitted, else the actual number of bytes written
     */
  writeVarint64(value, offset) {
    const relative = offset === void 0;
    if (relative) {
      offset = this.woffset;
    }
    if (!this.noAssert) {
      if (typeof value === "number") {
        value = Long.fromNumber(value);
      } else if (_isString(value)) {
        value = Long.fromString(value);
      } else if (!(typeof value === "object" && value instanceof Long)) {
        throw new TypeError(`Illegal value: ${value} (not an integer or Long)`);
      }
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      offset >>>= 0;
      if (offset < 0 || offset + 0 > this.buffer.length) {
        throw new RangeError(`Illegal offset: 0 <= ${offset} (0) <= ${this.buffer.length}`);
      }
    }
    if (typeof value === "number") {
      value = Long.fromNumber(value, false);
    } else if (_isString(value)) {
      value = Long.fromString(value, false);
    } else if (value.unsigned !== false) {
      value = value.toSigned();
    }
    const size = SmartBuffer.calculateVarint64(value);
    const part0 = value.toInt() >>> 0;
    const part1 = value.shru(28).toInt() >>> 0;
    const part2 = value.shru(56).toInt() >>> 0;
    offset += size;
    let capacity11 = this.buffer.length;
    if (offset > capacity11) {
      this.resize((capacity11 *= 2) > offset ? capacity11 : offset);
    }
    offset -= size;
    switch (size) {
      case 10:
        this.buffer[offset + 9] = (part2 >>> 7) & 0x01;
      // falls through
      case 9:
        this.buffer[offset + 8] = size !== 9 ? (part2) | 0x80 : (part2) & 0x7F;
      // falls through
      case 8:
        this.buffer[offset + 7] = size !== 8 ? (part1 >>> 21) | 0x80 : (part1 >>> 21) & 0x7F;
      // falls through
      case 7:
        this.buffer[offset + 6] = size !== 7 ? (part1 >>> 14) | 0x80 : (part1 >>> 14) & 0x7F;
      // falls through
      case 6:
        this.buffer[offset + 5] = size !== 6 ? (part1 >>> 7) | 0x80 : (part1 >>> 7) & 0x7F;
      // falls through
      case 5:
        this.buffer[offset + 4] = size !== 5 ? (part1) | 0x80 : (part1) & 0x7F;
      // falls through
      case 4:
        this.buffer[offset + 3] = size !== 4 ? (part0 >>> 21) | 0x80 : (part0 >>> 21) & 0x7F;
      // falls through
      case 3:
        this.buffer[offset + 2] = size !== 3 ? (part0 >>> 14) | 0x80 : (part0 >>> 14) & 0x7F;
      // falls through
      case 2:
        this.buffer[offset + 1] = size !== 2 ? (part0 >>> 7) | 0x80 : (part0 >>> 7) & 0x7F;
      // falls through
      case 1:
        this.buffer[offset] = size !== 1 ? (part0) | 0x80 : (part0) & 0x7F;
    }
    if (relative) {
      this.woffset += size;
      return this;
    }
    return size;

  }

  /**
     * Writes a zig-zag encoded 64bit base 128 variable-length integer
     *
     * @param {ateos.math.I.Longable} value
     * @param {number} [offset] Offset to write to
     * @returns {this | number} this if offset is omitted, else the actual number of bytes written
     */
  writeVarint64ZigZag(value, offset) {
    return this.writeVarint64(SmartBuffer.zigZagEncode64(value), offset);
  }

  /**
     * Reads a 64bit base 128 variable-length integer
     *
     * @param {number} [offset] Offset to read from
     * @returns {number | { value: ateos.math.Long, c: number }} The value read if offset is omitted,
     *      else the value read and the actual number of bytes read
     */
  readVarint64(offset): LongValue {
    const relative = offset === void 0;
    if (relative) {
      offset = this.roffset;
    }
    if (!this.noAssert) {
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      offset >>>= 0;
      if (offset < 0 || offset + 1 > this.buffer.length) {
        throw new RangeError(`Illegal offset: 0 <= ${offset} (1) <= ${this.buffer.length}`);
      }
    }
    // ref: src/google/protobuf/io/coded_stream.cc
    const start = offset;
    let part0 = 0;
    let part1 = 0;
    let part2 = 0;
    let b = 0;
    b = this.buffer[offset++];
    part0 = (b & 0x7F);
    if (b & 0x80) {
      b = this.buffer[offset++];
      part0 |= (b & 0x7F) << 7;
      if ((b & 0x80) || (this.noAssert && b === void 0)) {
        b = this.buffer[offset++];
        part0 |= (b & 0x7F) << 14;
        if ((b & 0x80) || (this.noAssert && b === void 0)) {
          b = this.buffer[offset++];
          part0 |= (b & 0x7F) << 21;
          if ((b & 0x80) || (this.noAssert && b === void 0)) {
            b = this.buffer[offset++];
            part1 = (b & 0x7F);
            if ((b & 0x80) || (this.noAssert && b === void 0)) {
              b = this.buffer[offset++];
              part1 |= (b & 0x7F) << 7;
              if ((b & 0x80) || (this.noAssert && b === void 0)) {
                b = this.buffer[offset++];
                part1 |= (b & 0x7F) << 14;
                if ((b & 0x80) || (this.noAssert && b === void 0)) {
                  b = this.buffer[offset++];
                  part1 |= (b & 0x7F) << 21;
                  if ((b & 0x80) || (this.noAssert && b === void 0)) {
                    b = this.buffer[offset++];
                    part2 = (b & 0x7F);
                    if ((b & 0x80) || (this.noAssert && b === void 0)) {
                      b = this.buffer[offset++];
                      part2 |= (b & 0x7F) << 7;
                      if ((b & 0x80) || (this.noAssert && b === void 0)) {
                        throw new RangeError("Buffer overrun");
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    const value = Long.fromBits(part0 | (part1 << 28), (part1 >>> 4) | (part2) << 24, false);
    if (relative) {
      this.roffset = offset;
      return value;
    }
    return { value, length: offset - start };
  }

  /**
     * Reads a zig-zag encoded 64bit base 128 variable-length integer
     *
     * @param {number} [offset] Offset to read from
     * @returns {number | { value: ateos.math.Long, c: number }} The value read if offset is omitted,
     *      else the value read and the actual number of bytes read
     */
  readVarint64ZigZag(offset): LongValue {
    let val = this.readVarint64(offset);
    if (typeof val === "object" && (val as SLong).value instanceof Long) {
      (val as SLong).value = SmartBuffer.zigZagDecode64((val as SLong).value);
    } else {
      val = SmartBuffer.zigZagDecode64(val);
    }
    return val;
  }

  /**
     * Writes a NULL-terminated UTF8 encoded string.
     * For this to work the specified string must not contain any NULL characters itself
     *
     * @param {string} str
     * @param {number} [offset] Offset to write to
     * @returns {this | number} this if offset is omitted, else the actual number of bytes written
     */
  writeCString(str, offset) {
    const relative = offset === void 0;
    if (relative) {
      offset = this.woffset;
    }
    let i;
    let k = str.length;
    if (!this.noAssert) {
      if (!_isString(str)) {
        throw new TypeError("Illegal str: Not a string");
      }
      for (i = 0; i < k; ++i) {
        if (str.charCodeAt(i) === 0) {
          throw new TypeError("Illegal str: Contains NULL-characters");
        }
      }
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      offset >>>= 0;
      if (offset < 0 || offset + 0 > this.buffer.length) {
        throw new RangeError(`Illegal offset: 0 <= ${offset} (0) <= ${this.buffer.length}`);
      }
    }
    // UTF8 strings do not contain zero bytes in between except for the zero character, so:
    k = Buffer.byteLength(str, "utf8");
    offset += k + 1;
    let capacity12 = this.buffer.length;
    if (offset > capacity12) {
      this.resize((capacity12 *= 2) > offset ? capacity12 : offset);
    }
    offset -= k + 1;
    offset += this.buffer.write(str, offset, k, "utf8");
    this.buffer[offset++] = 0;
    if (relative) {
      this.woffset = offset;
      return this;
    }
    return k;
  }

  /**
     * Reads a NULL-terminated UTF8 encoded string.
     * For this to work the string read must not contain any NULL characters itself
     *
     * @param {number} [offset] Offset to read from
     * @returns {string | { string: string, length: number }} The string read if offset is omitted,
     *      else the string read and the actual number of bytes read
     */
  readCString(offset) {
    const relative = offset === void 0;
    if (relative) {
      offset = this.roffset;
    }
    if (!this.noAssert) {
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      offset >>>= 0;
      if (offset < 0 || offset + 1 > this.buffer.length) {
        throw new RangeError(`Illegal offset: 0 <= ${offset} (1) <= ${this.buffer.length}`);
      }
    }
    const start = offset;
    let temp;
    // UTF8 strings do not contain zero bytes in between except for the zero character itself, so:
    do {
      if (offset >= this.buffer.length) {
        throw new RangeError(`Index out of range: ${offset} <= ${this.buffer.length}`);
      }
      temp = this.buffer[offset++];
    } while (temp !== 0);
    const str = this.buffer.toString("utf8", start, offset - 1);
    if (relative) {
      this.roffset = offset;
      return str;
    }
    return { string: str, length: offset - start };
  }

  /**
     * Writes an UTF8 encoded string
     *
     * @param {string} str
     * @param {offset} offset Offset to write to
     * @returns {this | number} this if offset is omitted, else the actual number of bytes written
     */
  writeString(str, offset) {
    const relative = offset === void 0;
    if (relative) {
      offset = this.woffset;
    }
    if (!this.noAssert) {
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      offset >>>= 0;
      if (offset < 0 || offset + 0 > this.buffer.length) {
        throw new RangeError(`Illegal offset: 0 <= ${offset} (0) <= ${this.buffer.length}`);
      }
    }
    const k = Buffer.byteLength(str, "utf8");
    offset += k;
    let capacity14 = this.buffer.length;
    if (offset > capacity14) {
      capacity14 *= 2;
      this.resize(capacity14 > offset ? capacity14 : offset);
    }
    offset -= k;
    offset += this.buffer.write(str, offset, k, "utf8");
    if (relative) {
      this.woffset = offset;
      return this;
    }
    return k;
  }

  /**
     * Reads an UTF8 encoded string
     *
     * @param {number} length Number of characters or bytes to read
     * @param {Metrics} [metrics] Metrics specifying what n is meant to count. Defaults to SmartBuffer.METRICS_CHARS("c")
     * @param {number} [offset] Offset to read from
     * @returns {string | { string: string, length: number}} The string read if offset is omitted,
     *      else the string read and the actual number of bytes read
     */
  readString(length, metrics, offset) {
    if (typeof metrics === "number") {
      offset = metrics;
      metrics = undefined;
    }
    const relative = offset === void 0;
    if (relative) {
      offset = this.roffset;
    }
    if (metrics === void 0) {
      metrics = SmartBuffer.METRICS_CHARS;
    }
    if (!this.noAssert) {
      if (typeof length !== "number" || length % 1 !== 0) {
        throw new TypeError(`Illegal length: ${length} (not an integer)`);
      }
      length |= 0;
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      offset >>>= 0;
      if (offset < 0 || offset + 0 > this.buffer.length) {
        throw new RangeError(`Illegal offset: 0 <= ${offset} (0) <= ${this.buffer.length}`);
      }
    }
    let i = 0;
    const start = offset;
    let temp;
    let sd;
    if (metrics === SmartBuffer.METRICS_CHARS) {
      sd = stringDestination();
      utfx.decodeUTF8(() => i < length && offset < this.buffer.length ? this.buffer[offset++] : null, (cp) => {
        ++i;
        utfx.UTF8toUTF16(cp, sd);
      });
      if (i !== length) {
        throw new RangeError(`Illegal range: Truncated data, ${i} == ${length}`);
      }
      if (relative) {
        this.roffset = offset;
        return sd();
      }
      return { string: sd(), length: offset - start };
    } else if (metrics === SmartBuffer.METRICS_BYTES) {
      if (!this.noAssert) {
        if (typeof offset !== "number" || offset % 1 !== 0) {
          throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
        }
        offset >>>= 0;
        if (offset < 0 || offset + length > this.buffer.length) {
          throw new RangeError(`Illegal offset: 0 <= ${offset} (${length}) <= ${this.buffer.length}`);
        }
      }
      temp = this.buffer.toString("utf8", offset, offset + length);
      if (relative) {
        this.roffset += length;
        return temp;
      }
      return { string: temp, length };

    }
    throw new TypeError(`Unsupported metrics: ${metrics}`);
  }

  /**
     * Writes a length as varint32 prefixed UTF8 encoded string
     *
     * @param {string} str
     * @param {number} [offset] Offset to read from
     * @returns {this | number} this if offset is omitted, else the actual number of bytes written
     */
  writeVString(str, offset) {
    const relative = offset === void 0;
    if (relative) {
      offset = this.woffset;
    }
    if (!this.noAssert) {
      if (!_isString(str)) {
        throw new TypeError("Illegal str: Not a string");
      }
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      offset >>>= 0;
      if (offset < 0 || offset + 0 > this.buffer.length) {
        throw new RangeError(`Illegal offset: 0 <= ${offset} (0) <= ${this.buffer.length}`);
      }
    }
    const start = offset;
    const k = Buffer.byteLength(str, "utf8");
    const l = SmartBuffer.calculateVarint32(k);
    offset += l + k;
    let capacity15 = this.buffer.length;
    if (offset > capacity15) {
      this.resize((capacity15 *= 2) > offset ? capacity15 : offset);
    }
    offset -= l + k;
    offset += this.writeVarint32(k, offset);
    offset += this.buffer.write(str, offset, k, "utf8");
    if (relative) {
      this.woffset = offset;
      return this;
    }
    return offset - start;
  }

  /**
     * Reads a length as varint32 prefixed UTF8 encoded string
     *
     * @param {number} [offset] Offset to read from
     * @returns {string | { string: string, length: number }} The string read if offset is omitted,
     *      else the string read and the actual number of bytes read
     */
  readVString(offset) {
    const relative = offset === void 0;
    if (relative) {
      offset = this.roffset;
    }
    if (!this.noAssert) {
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      offset >>>= 0;
      if (offset < 0 || offset + 1 > this.buffer.length) {
        throw new RangeError(`Illegal offset: 0 <= ${offset} (1) <= ${this.buffer.length}`);
      }
    }
    const start = offset;
    const len = this.readVarint32(offset);
    const str = this.readString((len as SNumber).value, SmartBuffer.METRICS_BYTES, offset += (len as SNumber).length);
    offset += str.length;
    if (relative) {
      this.roffset = offset;
      return str.string;
    }
    return { string: str.string, length: offset - start };
  }

  /**
     * Appends this SmartBuffer's contents to another SmartBuffer.
     * This will overwrite any contents behind the specified offset up to the length of this SmartBuffer's data
     *
     * @param {SmartBuffer} target
     * @param {number} [offset] Offset to append to
     * @returns {this}
     */
  appendTo(target, offset) {
    target.write(this, offset);
    return this;
  }

  /**
     * Enables or disables assertions of argument types and offsets.
     * Assertions are enabled by default but you can opt to disable them if your code already makes sure that everything is valid
     *
     * @param {boolean} assert
     */
  assert(assert) {
    this.noAssert = !assert;
    return this;
  }

  /**
     * Resets this SmartBuffer's offsets.
     *
     * @returns {this}
     */
  reset(resetWOffset = false) {
    this.roffset = 0;
    if (resetWOffset) {
      this.woffset = 0;
    }
    return this;
  }

  /**
     * Creates a cloned instance of this SmartBuffer, preset with this SmartBuffer's values for roffset and woffset.
     *
     * @param {boolean} copy Whether to copy the backing buffer or to return another view on the same, false by default
     * @param {SmartBuffer}
     */
  clone(copy?: boolean) {
    const bb = new SmartBuffer(0, this.noAssert);
    if (copy) {
      const buffer = Buffer.allocUnsafe(this.buffer.length);
      this.buffer.copy(buffer);
      bb.buffer = buffer;
    } else {
      bb.buffer = this.buffer;
    }
    bb.roffset = this.roffset;
    bb.woffset = this.woffset;
    return bb;
  }

  /**
     * Compacts this SmartBuffer to be backed by a buffer of its contents' length.
     * Will set offset = 0 and limit = capacity.
     *
     * @param {number} begin Offset to start at, buffer offset by default
     * @param {number} end Offset to end at, buffer limit by default
     * @returns {this}
     */
  compact(begin, end) {
    begin = begin === void 0 ? this.roffset : begin;
    end = end === void 0 ? this.buffer.length : end;
    if (!this.noAssert) {
      if (typeof begin !== "number" || begin % 1 !== 0) {
        throw new TypeError("Illegal begin: Not an integer");
      }
      begin >>>= 0;
      if (typeof end !== "number" || end % 1 !== 0) {
        throw new TypeError("Illegal end: Not an integer");
      }
      end >>>= 0;
      if (begin < 0 || begin > end || end > this.buffer.length) {
        throw new RangeError(`Illegal range: 0 <= ${begin} <= ${end} <= ${this.buffer.length}`);
      }
    }
    if (begin === 0 && end === this.buffer.length) {
      return this; // Already compacted
    }
    const len = end - begin;
    if (len === 0) {
      this.buffer = EMPTY_BUFFER;
      this.roffset = 0;
      this.woffset = 0;
      return this;
    }
    const buffer = Buffer.allocUnsafe(len);
    this.buffer.copy(buffer, 0, begin, end);
    this.buffer = buffer;
    this.woffset -= this.roffset;
    this.roffset = 0;
    return this;
  }

  /**
     * Creates a copy of this SmartBuffer's contents.
     *
     * @param {number} begin Begin offset, buffer offset by default
     * @param {number} end End offset, buffer limit by default
     * @returns {SmartBuffer}
     */
  copy(begin, end) {
    begin = begin === void 0 ? this.roffset : begin;
    end = end === void 0 ? this.woffset : end;
    if (!this.noAssert) {
      if (typeof begin !== "number" || begin % 1 !== 0) {
        throw new TypeError("Illegal begin: Not an integer");
      }
      begin >>>= 0;
      if (typeof end !== "number" || end % 1 !== 0) {
        throw new TypeError("Illegal end: Not an integer");
      }
      end >>>= 0;
      if (begin < 0 || begin > end || end > this.buffer.length) {
        throw new RangeError(`Illegal range: 0 <= ${begin} <= ${end} <= ${this.buffer.length}`);
      }
    }
    if (begin === end) {
      return new SmartBuffer(0, this.noAssert);
    }
    const capacity = end - begin;
    const bb = new SmartBuffer(capacity, this.noAssert);
    bb.roffset = 0;
    bb.woffset = 0;
    this.copyTo(bb, 0, begin, end);
    return bb;
  }

  /**
     * Copies this SmartBuffer's contents to another SmartBuffer.
     *
     * @param {SmartBuffer} target
     * @param {number} [targetOffset] Offset to copy to. Will use and increase the target's offset by the number of bytes copied if omitted
     * @param {number} [sourceStart] Offset to start copying from. Will use and increase offset by the number of bytes copied if omitted
     * @param {number} [sourceEnd] Offset to end copying from, defaults to the buffer limit
     * @returns {this}
     */
  copyTo(target, targetOffset, sourceStart, sourceEnd) {
    let relative;
    let targetRelative;
    if (!this.noAssert) {
      if (!(target instanceof SmartBuffer)) {
        throw new TypeError("'target' is not a SmartBuffer");
      }
    }
    targetOffset = (targetRelative = targetOffset === void 0) ? target.woffset : targetOffset | 0;
    sourceStart = (relative = sourceStart === void 0) ? this.roffset : sourceStart | 0;
    sourceEnd = sourceEnd === void 0 ? this.woffset : sourceEnd | 0;

    if (targetOffset < 0 || targetOffset > target.buffer.length) {
      throw new RangeError(`Illegal target range: 0 <= ${targetOffset} <= ${target.buffer.length}`);
    }
    if (sourceStart < 0 || sourceEnd > this.buffer.length) {
      throw new RangeError(`Illegal source range: 0 <= ${sourceStart} <= ${this.buffer.length}`);
    }

    const len = sourceEnd - sourceStart;
    if (len === 0) {
      return target; // Nothing to copy
    }

    target.ensureCapacity(targetOffset + len);

    this.buffer.copy(target.buffer, targetOffset, sourceStart, sourceEnd);

    if (relative) {
      this.roffset += len;
    }
    if (targetRelative) {
      target.woffset += len;
    }

    return this;
  }

  /**
     * Makes sure that this SmartBuffer is backed by a SmartBuffer#buffer of at least the specified capacity.
     * If the current capacity is exceeded, it will be doubled.
     * If double the current capacity is less than the required capacity, the required capacity will be used instead
     *
     * @param {number} capacity
     * @returns {this}
     */
  ensureCapacity(capacity) {
    let current = this.buffer.length;
    if (current < capacity) {
      return this.resize((current *= 2) > capacity ? current : capacity);
    }
    return this;
  }

  /**
     * Overwrites this SmartBuffer's contents with the specified value.
     *
     * @param {number | string} value Byte value to fill with. If given as a string, the first character is used
     * @param {number} [begin] Begin offset. Will use and increase offset by the number of bytes written if omitted. defaults to offset
     * @param {number} [end] End offset, defaults to limit.
     * @returns {this}
     */
  fill(value, begin, end) {
    const relative = begin === void 0;
    if (relative) {
      begin = this.woffset;
    }
    if (_isString(value) && value.length > 0) {
      value = value.charCodeAt(0);
    }
    if (end === void 0) {
      end = this.buffer.length; // ??? may be woffset
    }
    if (!this.noAssert) {
      if (typeof value !== "number" || value % 1 !== 0) {
        throw new TypeError(`Illegal value: ${value} (not an integer)`);
      }
      value |= 0;
      if (typeof begin !== "number" || begin % 1 !== 0) {
        throw new TypeError("Illegal begin: Not an integer");
      }
      begin >>>= 0;
      if (typeof end !== "number" || end % 1 !== 0) {
        throw new TypeError("Illegal end: Not an integer");
      }
      end >>>= 0;
      if (begin < 0 || begin > end || end > this.buffer.length) {
        throw new RangeError(`Illegal range: 0 <= ${begin} <= ${end} <= ${this.buffer.length}`);
      }
    }
    if (begin >= end) {
      return this; // Nothing to fill
    }
    this.buffer.fill(value, begin, end);
    if (relative) {
      this.woffset = end;
    }
    return this;
  }

  /**
     * Prepends some data to this SmartBuffer.
     * This will overwrite any contents before the specified offset up to the prepended data's length.
     * If there is not enough space available before the specified offset,
     * the backing buffer will be resized and its contents moved accordingly
     *
     * @param {Wrappable} source Data to prepend
     * @param {string} [encoding] Encoding if data is a string
     * @param {number} [offset] Offset to prepend at. Will use and decrease offset by the number of bytes prepended if omitted.
     * @returns {this}
     */
  prepend(source, encoding, offset) {
    if (typeof encoding === "number" || !_isString(encoding)) {
      offset = encoding;
      encoding = undefined;
    }
    const relative = offset === void 0;
    if (relative) {
      offset = this.roffset;
    }
    if (!this.noAssert) {
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError(`Illegal offset: ${offset} (not an integer)`);
      }
      offset >>>= 0;
      if (offset < 0 || offset + 0 > this.buffer.length) {
        throw new RangeError(`Illegal offset: 0 <= ${offset} (0) <= ${this.buffer.length}`);
      }
    }
    if (!(source instanceof SmartBuffer)) {
      source = SmartBuffer.wrap(source, encoding);
    }
    const len = source.buffer.length - source.roffset;
    if (len <= 0) {
      return this; // Nothing to prepend
    }
    const diff = len - offset;
    if (diff > 0) { // Not enough space before offset, so resize + move
      const buffer = Buffer.allocUnsafe(this.buffer.length + diff);
      this.buffer.copy(buffer, len, offset, this.buffer.length);
      this.buffer = buffer;
      this.roffset += diff;
      this.woffset += diff;
      offset += diff;
    }
    source.buffer.copy(this.buffer, offset - len, source.roffset, source.buffer.length);

    source.roffset = source.buffer.length;
    if (relative) {
      this.roffset -= len;
    }
    return this;
  }

  /**
     * Prepends this SmartBuffer to another SmartBuffer.
     * This will overwrite any contents before the specified offset up to the prepended data's length.
     * If there is not enough space available before the specified offset,
     * the backing buffer will be resized and its contents moved accordingly
     *
     * @param {Wrappable} target
     * @param {number} offset Offset to prepend at
     */
  prependTo(target, offset) {
    target.prepend(this, offset);
    return this;
  }

  /**
     * Resizes this SmartBuffer to be backed by a buffer of at least the given capacity.
     * Will do nothing if already that large or larger.
     *
     * @param {number} capacity	Capacity required
     * @returns {this}
     */
  resize(capacity) {
    if (!this.noAssert) {
      if (typeof capacity !== "number" || capacity % 1 !== 0) {
        throw new TypeError(`'capacity' is not an integer: ${capacity}`);
      }
      capacity |= 0;
      if (capacity < 0) {
        throw new TypeError(`Not valid capacity value: 0 <= ${capacity}`);
      }
    }
    if (this.buffer.length < capacity) {
      const buffer = Buffer.allocUnsafe(capacity);
      this.buffer.copy(buffer);
      this.buffer = buffer;
    }
    return this;
  }

  /**
     * Reverses this SmartBuffer's contents.
     *
     * @param {number} [begin] Offset to start at, defaults to roffset
     * @param {number} [end] Offset to end at, defaults to woffset
     * @returns {this}
     */
  reverse(begin, end) {
    begin = begin === void 0 ? this.roffset : begin;
    end = end === void 0 ? this.woffset : end;
    if (!this.noAssert) {
      if (typeof begin !== "number" || begin % 1 !== 0) {
        throw new TypeError("Illegal begin: Not an integer");
      }
      begin >>>= 0;
      if (typeof end !== "number" || end % 1 !== 0) {
        throw new TypeError("Illegal end: Not an integer");
      }
      end >>>= 0;
      if (begin < 0 || begin > end || end > this.buffer.length) {
        throw new RangeError(`Illegal range: 0 <= ${begin} <= ${end} <= ${this.buffer.length}`);
      }
    }
    if (begin === end) {
      return this; // Nothing to reverse
    }
    Array.prototype.reverse.call(this.buffer.slice(begin, end));
    return this;
  }

  /**
     * Skips the next length bytes. This will just advance.
     *
     * @param {number} length
     * @returns {this}
     */
  skipRead(length) {
    if (!this.noAssert) {
      if (typeof length !== "number" || length % 1 !== 0) {
        throw new TypeError(`Illegal length: ${length} (not an integer)`);
      }
      length |= 0;
    }
    const offset = this.roffset + length;
    if (!this.noAssert) {
      if (offset < 0 || offset > this.buffer.length) {
        throw new RangeError(`Illegal length: 0 <= ${this.roffset} + ${length} <= ${this.buffer.length}`);
      }
    }
    this.roffset = offset;
    return this;
  }

  /**
     * Skips the next length bytes. This will just advance.
     *
     * @param {number} length
     * @returns {this}
     */
  skipWrite(length) {
    if (!this.noAssert) {
      if (typeof length !== "number" || length % 1 !== 0) {
        throw new TypeError(`Illegal length: ${length} (not an integer)`);
      }
      length |= 0;
    }
    const offset = this.woffset + length;
    if (!this.noAssert) {
      if (offset < 0 || offset > this.buffer.length) {
        throw new RangeError(`Illegal length: 0 <= ${this.woffset} + ${length} <= ${this.buffer.length}`);
      }
    }
    this.woffset = offset;
    return this;
  }

  /**
     * Slices this SmartBuffer by creating a cloned instance with roffset = begin and woffset = end
     *
     * @param {number} [begin] Begin offset, defaults to offset
     * @param {number} [end] End offset, defaults to limit
     * @returns {SmartBuffer}
     */
  slice(begin, end) {
    begin = begin === void 0 ? this.roffset : begin;
    end = end === void 0 ? this.woffset : end;
    if (!this.noAssert) {
      if (typeof begin !== "number" || begin % 1 !== 0) {
        throw new TypeError("Illegal begin: Not an integer");
      }
      begin >>>= 0;
      if (typeof end !== "number" || end % 1 !== 0) {
        throw new TypeError("Illegal end: Not an integer");
      }
      end >>>= 0;
      if (begin < 0 || begin > end || end > this.buffer.length) {
        throw new RangeError(`Illegal range: 0 <= ${begin} <= ${end} <= ${this.buffer.length}`);
      }
    }
    const bb = new SmartBuffer(end - begin);
    bb.buffer = this.buffer.slice(begin, end);
    bb.woffset = bb.capacity;
    return bb;
  }

  /**
     * Returns a copy of the backing buffer that contains this SmartBuffer's contents.
     *
     * @param {boolean} [forceCopy] If true returns a copy, otherwise returns a view referencing the same memory if possible,
     *      false by default
     * @param {number} [begin] Begin offset, roffset by default
     * @param {number} [end] End offset, woffset by default
     * @returns {Buffer}
     */
  toBuffer(forceCopy, begin, end) {
    begin = begin === void 0 ? this.roffset : begin;
    end = end === void 0 ? this.woffset : end;
    begin >>>= 0;
    end >>>= 0;
    if (!this.noAssert) {
      if (typeof begin !== "number" || begin % 1 !== 0) {
        throw new TypeError("Illegal begin: Not an integer");
      }
      if (typeof end !== "number" || end % 1 !== 0) {
        throw new TypeError("Illegal end: Not an integer");
      }
      if (begin < 0 || begin > end || end > this.buffer.length) {
        throw new RangeError(`Illegal range: 0 <= ${begin} <= ${end} <= ${this.buffer.length}`);
      }
    }
    if (forceCopy) {
      const buffer = Buffer.allocUnsafe(end - begin);
      this.buffer.copy(buffer, 0, begin, end);
      return buffer;
    }
    if (begin === 0 && end === this.buffer.length) {
      return this.buffer;
    }
    return this.buffer.slice(begin, end);
  }

  /**
     * Returns a raw buffer compacted to contain this SmartBuffer's contents
     *
     * @returns {ArrayBuffer}
     */
  toArrayBuffer() {
    let offset = this.roffset;
    let limit = this.woffset;
    if (!this.noAssert) {
      if (typeof offset !== "number" || offset % 1 !== 0) {
        throw new TypeError("Illegal offset: Not an integer");
      }
      offset >>>= 0;
      if (typeof limit !== "number" || limit % 1 !== 0) {
        throw new TypeError("Illegal limit: Not an integer");
      }
      limit >>>= 0;
      if (offset < 0 || offset > limit || limit > this.buffer.length) {
        throw new RangeError(`Illegal range: 0 <= ${offset} <= ${limit} <= ${this.buffer.length}`);
      }
    }
    const ab = new ArrayBuffer(limit - offset);
    const dst = new Uint8Array(ab);
    this.buffer.copy(dst);
    return ab;
  }

  /**
     * Converts the SmartBuffer's contents to a string
     *
     * @param {string} encoding Output encoding
     * @param {number} [begin] Begin offset, offset by default
     * @param {number} [end] End offset, limit by default
     * @returns {string}
     */
  toString(encoding, begin, end) {
    if (encoding === void 0) {
      return `ByteArrayNB(roffset=${this.roffset},woffset=${this.woffset},capacity=${this.capacity})`;
    }

    switch (encoding) {
      case "utf8":
        return this.toUTF8(begin, end);
      case "base64":
        return this.toBase64(begin, end);
      case "hex":
        return this.toHex(begin, end);
      case "binary":
        return this.toBinary(begin, end);
      case "debug":
        return this.toDebug();
      default:
        throw new TypeError(`Unsupported encoding: ${encoding}`);
    }
  }

  /**
     * Encodes this SmartBuffer's contents to a base64 encoded string
     *
     * @param {number} [begin] Begin offset, offset by default
     * @param {number} [end] End offset, limit by default
     * @returns {string}
     */
  toBase64(begin, end) {
    begin = begin === void 0 ? this.roffset : begin;
    end = end === void 0 ? this.woffset : end;
    begin = begin | 0; end = end | 0;
    if (begin < 0 || end > this.buffer.length || begin > end) {
      throw new RangeError("begin, end");
    }
    return this.buffer.toString("base64", begin, end);
  }

  /**
     * Encodes this SmartBuffer to a binary encoded string, that is using only characters 0x00-0xFF as bytes
     *
     * @param {number} [begin] Begin offset, offset by default
     * @param {number} [end] End offset, limit by default
     * @returns {string}
     */
  toBinary(begin, end) {
    begin = begin === void 0 ? this.roffset : begin;
    end = end === void 0 ? this.woffset : end;
    begin |= 0; end |= 0;
    if (begin < 0 || end > this.capacity || begin > end) {
      throw new RangeError("begin, end");
    }
    return this.buffer.toString("binary", begin, end);
  }

  /**
     * Encodes this SmartBuffer to a hex encoded string with marked offsets
     *
     * '<' - roffset
     * '>' - woffset
     * '|' - roffset=woffset=capacity
     * '^' - roffset=woffset
     * ']' - woffset=capacity
     * '*' - capacity
     *
     * @param {boolean} [columns] If true returns two columns hex + ascii, defaults to false
     * @returns {string}
     */
  toDebug(columns?: boolean) {
    let i = -1;
    const k = this.buffer.length;
    let b;
    let hex = "";
    let asc = "";
    let out = "";
    while (i < k) {
      if (i !== -1) {
        b = this.buffer[i];
        if (b < 0x10) {
          hex += `0${b.toString(16).toUpperCase()}`;
        } else {
          hex += b.toString(16).toUpperCase();
        }
        if (columns) {
          asc += b > 32 && b < 127 ? String.fromCharCode(b) : ".";
        }
      }
      ++i;
      if (columns) {
        if (i > 0 && i % 16 === 0 && i !== k) {
          while (hex.length < 3 * 16 + 3) {
            hex += " ";
          }
          out += `${hex + asc}\n`;
          hex = asc = "";
        }
      }
      if (i === this.roffset && this.roffset === this.woffset && this.woffset === this.buffer.length) {
        hex += "|";
      } else if (i === this.roffset && this.roffset === this.woffset) {
        hex += "^";
      } else if (i === this.roffset && this.roffset === this.buffer.length) {
        hex += "[";
      } else if (i === this.woffset && this.woffset === this.buffer.length) {
        hex += "]";
      } else if (i === this.roffset) {
        hex += "<";
      } else if (i === this.woffset) {
        hex += ">";
      } else if (i === this.buffer.length) {
        hex += "*";
      } else {
        hex += (columns || (i !== 0 && i !== k) ? " " : "");
      }
    }
    if (columns && hex !== " ") {
      while (hex.length < 3 * 16 + 3) {
        hex += " ";
      }
      out += `${hex + asc}\n`;
    }
    return columns ? out : hex;
  }

  /**
     * Encodes this SmartBuffer's contents to a hex encoded string
     *
     * @param {number} [begin] Begin offset, offset by default
     * @param {number} [end] End offset, limit by default
     * @returns {string}
     */
  toHex(begin, end) {
    begin = begin === void 0 ? this.roffset : begin;
    end = end === void 0 ? this.woffset : end;
    if (!this.noAssert) {
      if (typeof begin !== "number" || begin % 1 !== 0) {
        throw new TypeError("Illegal begin: Not an integer");
      }
      begin >>>= 0;
      if (typeof end !== "number" || end % 1 !== 0) {
        throw new TypeError("Illegal end: Not an integer");
      }
      end >>>= 0;
      if (begin < 0 || begin > end || end > this.buffer.length) {
        throw new RangeError(`Illegal range: 0 <= ${begin} <= ${end} <= ${this.buffer.length}`);
      }
    }
    return this.buffer.toString("hex", begin, end);
  }

  /**
     * Encodes this SmartBuffer's contents to an UTF8 encoded string
     *
     * @param {number} [begin] Begin offset, offset by default
     * @param {number} [end] End offset, limit by default
     * @returns {string}
     */
  toUTF8(begin, end) {
    begin = begin === void 0 ? this.roffset : begin;
    end = end === void 0 ? this.woffset : end;
    if (!this.noAssert) {
      if (typeof begin !== "number" || begin % 1 !== 0) {
        throw new TypeError("Illegal begin: Not an integer");
      }
      begin >>>= 0;
      if (typeof end !== "number" || end % 1 !== 0) {
        throw new TypeError("Illegal end: Not an integer");
      }
      end >>>= 0;
      if (begin < 0 || begin > end || end > this.buffer.length) {
        throw new RangeError(`Illegal range: 0 <= ${begin} <= ${end} <= ${this.buffer.length}`);
      }
    }
    return this.buffer.toString("utf8", begin, end);
  }

  /**
     * Allocates a new SmartBuffer backed by a buffer of the specified capacity.
     *
     * @param {number} [capacity] Initial capacity. Defaults to SmartBuffer.DEFAULT_CAPACITY(64)
     * @param {boolean} [noAssert] Whether to skip assertions of offsets and values. Defaults to SmartBuffer.DEFAULT_NOASSERT(false)
     */
  static alloc(capacity, noAssert) {
    return new SmartBuffer(capacity, noAssert);
  }

  /**
     * Concatenates multiple ByteArrays into one
     *
     * @param {Wrappable[]} buffers
     * @param {string} encoding Encoding for strings
     * @param {boolean} noAssert Whether to skip assertions of offsets and values. Defaults to SmartBuffer.DEFAULT_NOASSERT(false)
     */
  static concat(buffers, encoding, noAssert) {
    if (typeof encoding === "boolean" || !_isString(encoding)) {
      noAssert = encoding;
      encoding = undefined;
    }
    let capacity = 0;
    const k = buffers.length;
    let i = 0;
    let length;
    for (; i < k; ++i) {
      if (!(buffers[i] instanceof SmartBuffer)) {
        buffers[i] = SmartBuffer.wrap(buffers[i], encoding);
      }
      length = buffers[i].woffset - buffers[i].roffset;
      if (length > 0) {
        capacity += length;
      }
    }
    if (capacity === 0) {
      return new SmartBuffer(0, noAssert);
    }
    const bb = new SmartBuffer(capacity, noAssert);
    let bi;
    i = 0;

    while (i < k) {
      bi = buffers[i++];
      length = bi.woffset - bi.roffset;
      if (length <= 0) {
        continue;
      }
      bi.buffer.copy(bb.buffer, bb.woffset, bi.roffset, bi.woffset);
      bb.woffset += length;
    }
    bb.roffset = 0;
    return bb;
  }

  /**
     * Wraps a buffer or a string.
     * Sets the allocated SmartBuffer's offset to 0 and its limit to the length of the wrapped data
     *
     * @param {Wrappable} buffer
     * @param {string} encoding Encoding for strings
     * @param {boolean} noAssert Whether to skip assertions of offsets and values. Defaults to SmartBuffer.DEFAULT_NOASSERT(false)
     */
  static wrap(buffer: any, encoding?: string, noAssert?: boolean) {
    if (_isString(buffer)) {
      if (encoding === void 0) {
        encoding = "utf8";
      }
      switch (encoding) {
        case "base64":
          return SmartBuffer.fromBase64(buffer);
        case "hex":
          return SmartBuffer.fromHex(buffer);
        case "binary":
          return SmartBuffer.fromBinary(buffer);
        case "utf8":
          return SmartBuffer.fromUTF8(buffer);
        case "debug":
          return SmartBuffer.fromDebug(buffer);
        default:
          throw new TypeError(`Unsupported encoding: ${encoding}`);
      }
    }

    let bb;
    if (buffer instanceof SmartBuffer) {
      bb = buffer.clone();
      return bb;
    }

    let b;

    if (buffer instanceof Uint8Array) { // Extract bytes from Uint8Array
      b = Buffer.from(buffer);
      buffer = b;
    } else if (buffer instanceof ArrayBuffer) { // Convert ArrayBuffer to Buffer
      b = Buffer.from(buffer);
      buffer = b;
    } else if (!(buffer instanceof Buffer)) { // Create from octets if it is an error, otherwise fail
      if (!Array.isArray(buffer)) {
        throw new TypeError("Illegal buffer");
      }
      buffer = Buffer.from(buffer);
    }
    bb = new SmartBuffer(0, noAssert);
    if (buffer.length > 0) { // Avoid references to more than one EMPTY_BUFFER
      bb.buffer = buffer;
      bb.woffset = buffer.length;
    }
    return bb;
  }

  /**
     * Calculates the actual number of bytes required to store a 32bit base 128 variable-length integer
     *
     * @param {number} value
     * @returns {number}
     */
  static calculateVarint32(value) {
    value = value >>> 0;
    if (value < 1 << 7) {
      return 1;
    } else if (value < 1 << 14) {
      return 2;
    } else if (value < 1 << 21) {
      return 3;
    } else if (value < 1 << 28) {
      return 4;
    }
    return 5;
  }

  /**
     * Zigzag encodes a signed 32bit integer so that it can be effectively used with varint encoding
     *
     * @param {number} n
     * @returns {number}
     */
  static zigZagEncode32(n) {
    return (((n |= 0) << 1) ^ (n >> 31)) >>> 0; // ref: src/google/protobuf/wire_format_lite.h
  }

  /**
     * Decodes a zigzag encoded signed 32bit integer
     *
     * @param {number}
     * @returns {number}
     */
  static zigZagDecode32(n) {
    return ((n >>> 1) ^ -(n & 1)) | 0; // // ref: src/google/protobuf/wire_format_lite.h
  }

  /**
     * Calculates the actual number of bytes required to store a 64bit base 128 variable-length integer
     *
     * @param {ateos.math.Long | number | string} value
     * @returns {number}
     */
  static calculateVarint64(value) {
    if (typeof value === "number") {
      value = Long.fromNumber(value);
    } else if (_isString(value)) {
      value = Long.fromString(value);
    }
    // ref: src/google/protobuf/io/coded_stream.cc
    const part0 = value.toInt() >>> 0;
    const part1 = value.shru(28).toInt() >>> 0;
    const part2 = value.shru(56).toInt() >>> 0;
    if (part2 === 0) {
      if (part1 === 0) {
        if (part0 < 1 << 14) {
          return part0 < 1 << 7 ? 1 : 2;
        }
        return part0 < 1 << 21 ? 3 : 4;

      }
      if (part1 < 1 << 14) {
        return part1 < 1 << 7 ? 5 : 6;
      }
      return part1 < 1 << 21 ? 7 : 8;
    }
    return part2 < 1 << 7 ? 9 : 10;

  }

  /**
     * Zigzag encodes a signed 64bit integer so that it can be effectively used with varint encoding
     *
     * @param {ateos.math.Long | number | string} value
     * @returns {ateos.math.Long}
     */
  static zigZagEncode64(value) {
    if (typeof value === "number") {
      value = Long.fromNumber(value, false);
    } else if (_isString(value)) {
      value = Long.fromString(value, false);
    } else if (value.unsigned !== false) {
      value = value.toSigned();
    }
    // ref: src/google/protobuf/wire_format_lite.h
    return value.shl(1).xor(value.shr(63)).toUnsigned();
  }

  /**
     * Decodes a zigzag encoded signed 64bit integer.
     *
     * @param {ateos.math.Long | number | string} value
     * @returns {ateos.math.Long}
     */
  static zigZagDecode64(value) {
    if (typeof value === "number") {
      value = Long.fromNumber(value, false);
    } else if (_isString(value)) {
      value = Long.fromString(value, false);
    } else if (value.unsigned !== false) {
      value = value.toSigned();
    }
    // ref: src/google/protobuf/wire_format_lite.h
    return value.shru(1).xor(value.and(Long.ONE).toSigned().negate()).toSigned();
  }

  /**
     * Calculates the number of UTF8 characters of a string.
     * JavaScript itself uses UTF-16, so that a string's length property does not reflect its actual UTF8 size
     * if it contains code points larger than 0xFFFF
     *
     * @param {string} str
     * @returns {number}
     */
  static calculateUTF8Chars(str) {
    return utfx.calculateUTF16asUTF8(stringSource(str))[0];
  }

  /**
     *  Calculates the number of UTF8 bytes of a string.
     *
     * @param {string} str
     * @returns {number}
     */
  static calculateString(str) {
    if (!_isString(str)) {
      throw new TypeError(`Illegal argument: ${typeof str}`);
    }
    return Buffer.byteLength(str, "utf8");
  }

  /**
     * Decodes a base64 encoded string to a SmartBuffer
     *
     * @param {string} str
     * @returns {SmartBuffer}
     */
  static fromBase64(str) {
    return SmartBuffer.wrap(Buffer.from(str, "base64"));
  }

  /**
     * Encodes a binary string to base64 like window.btoa does
     *
     * @param {string} str
     * @returns {SmartBuffer}
     */
  static btoa(str) {
    return SmartBuffer.fromBinary(str).toBase64();
  }

  /**
     * Decodes a base64 encoded string to binary like window.atob does
     *
     * @param {string} b64
     * @returns {SmartBuffer}
     */
  static atob(b64) {
    return SmartBuffer.fromBase64(b64).toBinary();
  }

  /**
     * Decodes a binary encoded string, that is using only characters 0x00-0xFF as bytes, to a SmartBuffer
     *
     * @param {string} str
     * @returns {SmartBuffer}
     */
  static fromBinary(str) {
    return SmartBuffer.wrap(Buffer.from(str, "binary"));
  }

  /**
     * Decodes a hex encoded string with marked offsets to a SmartBuffer
     *
     * @param {string} str
     * @param {boolean} [noAssert]
     * @returns {SmartBuffer}
     */
  static fromDebug(str, noAssert?: boolean) {
    const k = str.length;
    const bb = new SmartBuffer(((k + 1) / 3) | 0, noAssert);
    let i = 0;
    let j = 0;
    let ch;
    let b;
    let rs = false; // Require symbol next
    let hw = false;
    let hr = false;
    let hl = false;
    let fail = false;
    while (i < k) {
      switch (ch = str.charAt(i++)) {
        case "|":
          if (!noAssert) {
            if (hr || hw || hl) {
              fail = true;
              break;
            }
            hr = hw = hl = true;
          }
          bb.roffset = bb.woffset = j;
          rs = false;
          break;
        case "]":
          if (!noAssert) {
            if (hw || hl) {
              fail = true;
              break;
            }
            hw = hl = true;
          }
          bb.woffset = j;
          rs = false;
          break;
        case "^":
          if (!noAssert) {
            if (hr || hw) {
              fail = true;
              break;
            }
            hr = hw = true;
          }
          bb.roffset = bb.woffset = j;
          rs = false;
          break;
        case "<":
          if (!noAssert) {
            if (hr) {
              fail = true;
              break;
            }
            hr = true;
          }
          bb.roffset = j;
          rs = false;
          break;
        case "*":
          if (!noAssert) {
            if (hl) {
              fail = true;
              break;
            }
            hl = true;
          }
          rs = false;
          break;
        case ">":
          if (!noAssert) {
            if (hw) {
              fail = true;
              break;
            }
            hw = true;
          }
          bb.woffset = j;
          rs = false;
          break;
        case " ":
          rs = false;
          break;
        default:
          if (!noAssert) {
            if (rs) {
              fail = true;
              break;
            }
          }
          b = parseInt(ch + str.charAt(i++), 16);
          if (!noAssert) {
            if (isNaN(b) || b < 0 || b > 255) {
              throw new RangeError("Not a debug encoded string");
            }
          }
          bb.buffer[j++] = b;
          rs = true;
      }
      if (fail) {
        throw new RangeError(`Invalid symbol at ${i}`);
      }
    }
    if (!noAssert) {
      if (!hr || !hw || !hl) {
        throw new RangeError(`Missing roffset or woffset or limit: ${str}`);
      }
      if (j < bb.buffer.length) {
        throw new RangeError(`Not a debug encoded string (is it hex?) ${j} < ${k}`);
      }
    }
    return bb;
  }

  /**
     * Decodes a hex encoded string to a SmartBuffer
     *
     * @param {string} str
     * @param {boolean} [noAssert]
     */
  static fromHex(str, noAssert?: boolean) {
    if (!noAssert) {
      if (!_isString(str)) {
        throw new TypeError("Illegal str: Not a string");
      }
      if (str.length % 2 !== 0) {
        throw new TypeError("Illegal str: Length not a multiple of 2");
      }
    }
    const bb = new SmartBuffer(0, true);
    bb.buffer = Buffer.from(str, "hex");
    bb.woffset = bb.buffer.length;
    return bb;
  }

  /**
     * Decodes an UTF8 encoded string to a SmartBuffer
     *
     * @param {string} str
     * @param {boolean} [noAssert]
     * @returns {SmartBuffer}
     */
  static fromUTF8(str, noAssert?: boolean) {
    if (!noAssert) {
      if (!_isString(str)) {
        throw new TypeError("Illegal str: Not a string");
      }
    }
    const bb = new SmartBuffer(0, noAssert);
    bb.buffer = Buffer.from(str, "utf8");
    bb.woffset = bb.buffer.length;
    return bb;
  }
}
