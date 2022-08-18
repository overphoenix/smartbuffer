import { isClass } from "@recalibratedsystems/common";
import Long from "long";
import { isSmartBuffer, SmartBuffer } from "../lib";

describe("SmartBuffer", () => {
  it("init", () => {
    expect(isClass(SmartBuffer)).toBeTruthy();
    expect(isSmartBuffer(new SmartBuffer())).toBeTruthy();
  });

  describe("base", () => {
    it("allocate", () => {
      let bb = new SmartBuffer();
      expect(bb.roffset).toEqual(0);
      expect(bb.woffset).toEqual(0);
      expect(bb.noAssert).toEqual(SmartBuffer.DEFAULT_NOASSERT);
      expect(bb.buffer.length).toEqual(bb.capacity);
      expect(bb.capacity).toEqual(SmartBuffer.DEFAULT_CAPACITY);
      bb = SmartBuffer.alloc(NaN, !SmartBuffer.DEFAULT_NOASSERT);
      expect(bb.capacity).toEqual(SmartBuffer.DEFAULT_CAPACITY);
      expect(bb.noAssert).toEqual(!SmartBuffer.DEFAULT_NOASSERT);

      // Fixed set of properties
      for (const i in bb) {
        if (bb.hasOwnProperty(i) && !["roffset", "woffset", "markedOffset", "limit", "noAssert", "buffer", "view", "ateos_tag"].includes(i)) {
          fail(`Illegal enumerable property: ${i}`);
        }
      }
    });

    it("clone", () => {
      const bb = new SmartBuffer(1, true);
      const bb2 = bb.clone();
      expect(bb.buffer).toEqual(bb2.buffer);
      expect(bb.roffset).toEqual(bb2.roffset);
      expect(bb.woffset).toEqual(bb2.woffset);
      expect(bb.noAssert).toEqual(bb2.noAssert);
      expect(bb).not.toBe(bb2);
    });

    it("assert", () => {
      const bb = new SmartBuffer();
      expect(bb.noAssert).toEqual(false);
      expect(bb.assert(false)).toEqual(bb);
      expect(bb.noAssert).toEqual(true);
      expect(bb.assert(true)).toEqual(bb);
      expect(bb.noAssert).toEqual(false);
    });
  });

  describe("wrap", () => {
    it("Buffer", () => {
      const buf = Buffer.alloc(1);
      buf[0] = 0x01;
      const bb = SmartBuffer.wrap(buf);
      expect(bb.capacity).toEqual(1);
      expect(Buffer.compare(bb.buffer, buf)).toEqual(0);
      expect(bb.toDebug()).toEqual("<01]");
    });

    it("ArrayBuffer", () => {
      const buf = new ArrayBuffer(1);
      const bb = SmartBuffer.wrap(buf);
      expect(bb.capacity).toEqual(1);
      expect(bb.buffer instanceof Buffer).toBeTruthy();
      expect(bb.roffset).toEqual(0);
      expect(bb.woffset).toEqual(1);
    });

    it("Uint8Array", () => {
      // Full view
      const buf = new Uint8Array(1);
      buf[0] = 0x01;
      const bb = SmartBuffer.wrap(buf);
      expect(bb.capacity).toEqual(1);
      expect(bb.buffer instanceof Buffer).toBeTruthy();
      expect(bb.toDebug()).toEqual("<01]");
    });

    it("Array", () => {
      const arr = [1, 255, -1];
      const bb = SmartBuffer.wrap(arr);
      expect(bb.capacity).toEqual(3);
      expect(bb.toDebug()).toEqual("<01 FF FF]");
    });

    it("SmartBuffer", () => {
      const bb2 = SmartBuffer.wrap("\x12\x34\x56\x78", "binary");
      bb2.roffset = 1;
      bb2.woffset = 1;
      const bb = SmartBuffer.wrap(bb2);
      expect(bb2.roffset).toEqual(bb.roffset);
      expect(bb2.woffset).toEqual(bb.woffset);
      expect(bb2.capacity).toEqual(bb.capacity);
      expect(bb2.toString("debug")).toEqual(bb.toString("debug"));
    });

    it("string", () => {
      const bb = SmartBuffer.wrap("\u0061\u0062");
      expect(bb.toDebug()).toEqual("<61 62]");
    });
  });

  describe("encodings", () => {
    it("UTF8", () => {
      ["aäöüß€b", ""].forEach((str) => {
        const bb = SmartBuffer.wrap(str, "utf8"); // Calls SmartBuffer#fromUTF8
        expect(bb.toUTF8()).toEqual(str);
        if (str.length > 2) {
          bb.roffset = 1;
          bb.woffset = bb.capacity - 1;
          expect(bb.toUTF8()).toEqual(str.substring(1, str.length - 1));
        }
      });
    });

    it("debug", () => {
      ["60<61 62>63*", "<60 61 62 63]", "|", "^61*", "12|"].forEach((str) => {
        const bb = SmartBuffer.wrap(str, "debug"); // Calls SmartBuffer#fromDebug
        expect(bb.toDebug()).toEqual(str);
      });
    });

    it("binary", () => {
      ["\x61\x62\x63\x64", "", "  "].forEach((str) => {
        const bb = SmartBuffer.wrap(str, "binary"); // Calls SmartBuffer#fromBinary
        expect(bb.toBinary()).toEqual(str);
        if (str.length > 2) {
          bb.roffset = 1;
          bb.woffset = bb.capacity - 1;
          expect(bb.toBinary()).toEqual(str.substring(1, str.length - 1));
        }
      });
    });

    it("hex", () => {
      ["61626364", "61", ""].forEach((str) => {
        const bb = SmartBuffer.wrap(str, "hex"); // Calls SmartBuffer#fromHex
        expect(bb.toHex()).toEqual(str);
        if (str.length > 2) {
          bb.roffset = 1;
          bb.woffset = bb.capacity - 1;
          expect(bb.toHex()).toEqual(str.substring(2, str.length - 2));
        }
      });
    });

    it("base64", () => {
      ["", "YWI=", "YWJjZGVmZw==", "YWJjZGVmZ2g=", "YWJjZGVmZ2hp"].forEach((str) => {
        const bb = SmartBuffer.wrap(str, "base64"); // Calls SmartBuffer#fromBase64
        expect(bb.toBase64()).toEqual(str);
        if (str.length > 8) {
          bb.roffset = 3;
          bb.woffset = bb.roffset + 3;
          expect(bb.toBase64()).toEqual(str.substr(4, 4));
        }
      });
    });
  });

  describe("methods", () => {
    it("concat", () => {
      const bbs = [
        new ArrayBuffer(1),
        SmartBuffer.fromDebug("00<01 02]"),
        SmartBuffer.fromDebug("00 01 02<03>00*"),
        SmartBuffer.fromDebug("00|"),
        SmartBuffer.fromDebug("<04]"),
        Buffer.alloc(0),
        new Uint8Array(0),
        "05"
      ];
      let bb = SmartBuffer.concat(bbs, "hex", !SmartBuffer.DEFAULT_NOASSERT);
      expect(bb.noAssert).toEqual(!SmartBuffer.DEFAULT_NOASSERT);
      expect(bb.toDebug()).toEqual("<00 01 02 03 04 05]");
      bb = SmartBuffer.concat([]);
      expect(bb.buffer).toEqual(new SmartBuffer(0).buffer); // EMPTY_BUFFER
    });

    it("resize", () => {
      const bb = new SmartBuffer(1);
      bb.roffset = bb.woffset = 1;
      bb.resize(2);
      bb.fill(0, 0, 2);
      expect(bb.capacity).toEqual(2);
      expect(bb.toDebug()).toEqual("00^00*");
    });

    it("ensureCapacity", () => {
      const bb = new SmartBuffer(5);
      expect(bb.capacity).toEqual(5);
      bb.ensureCapacity(6); // Doubles
      expect(bb.capacity).toEqual(10);
      bb.ensureCapacity(21); // Uses 21
      expect(bb.capacity).toEqual(21);
    });

    it("slice", () => {
      const b = SmartBuffer.wrap("\x12\x34\x56");
      const b2 = b.slice(1, 3);
      const b3 = SmartBuffer.wrap("\x34\x56");
      expect(Buffer.compare(b2.buffer, b3.buffer)).toEqual(0);
    });

    it("reset", () => {
      const bb = SmartBuffer.wrap("\x12\x34\x56\x78");
      bb.reset();
      expect(bb.roffset).toEqual(0);
      bb.roffset = 1;
      bb.woffset = 2;
      bb.reset(true);
      expect(bb.roffset).toEqual(0);
      expect(bb.woffset).toEqual(0);
    });

    it("copy", () => {
      const bb = SmartBuffer.wrap("\x01");
      const bb2 = bb.copy();
      expect(bb.roffset).toEqual(0);
      expect(bb).not.toBe(bb2);
      expect(bb.buffer).not.toBe(bb2.buffer);
      expect(bb2.roffset).toEqual(bb.roffset);
      // expect(bb2.markedOffset).toEqual(bb.markedOffset);
      // expect(bb2.littleEndian).toEqual(bb.littleEndian);
      expect(bb2.noAssert).toEqual(bb.noAssert);
    });

    it("copyTo", () => {
      const bb = SmartBuffer.wrap("\x01");
      const bb2 = new SmartBuffer(2).fill(0);
      expect(bb.toDebug()).toEqual("<01]");
      expect(bb2.toDebug()).toEqual("<00 00]");
      // Modifies source and target offsets
      bb2.reset(true);
      bb.copyTo(bb2 /* all offsets omitted */);
      expect(bb.toDebug()).toEqual("01|"); // Read 1 byte
      expect(bb2.toDebug()).toEqual("<01>00*"); // Written 1 byte
      bb.reset();
      expect(bb.toDebug()).toEqual("<01]");
      // Again, but with bb2.offset=1
      bb.copyTo(bb2 /* all offsets omitted */);
      expect(bb.toDebug()).toEqual("01|"); // Read 1 byte
      expect(bb2.toDebug()).toEqual("<01 01]"); // Written 1 byte at 2
      bb.reset();
      bb2.reset(true).fill(0);
      // Modifies source offsets only
      bb.copyTo(bb2, 0 /* source offsets omitted */);
      expect(bb.toDebug()).toEqual("01|"); // Read 1 byte
      expect(bb2.toDebug()).toEqual("<01 00]"); // Written 1 byte (no change)
      // Modifies no offsets at all
      bb.reset();
      bb2.reset(true).fill(0);
      bb.copyTo(bb2, 1, 0, bb.capacity /* no offsets omitted */);
      expect(bb.toDebug()).toEqual("<01]"); // Read 1 byte (no change)
      expect(bb2.toDebug()).toEqual("<00 01]"); // Written 1 byte (no change)
    });

    it("compact", () => {
      const bb = SmartBuffer.wrap("\x01\x02");
      let prevBuffer = bb.buffer;
      bb.compact();
      expect(bb.buffer).toEqual(prevBuffer);
      expect(bb.capacity).toEqual(2);
      expect(bb.roffset).toEqual(0);

      // Empty region
      bb.roffset = 1;
      prevBuffer = bb.buffer;
      bb.compact();
      expect(bb.buffer).not.toBe(prevBuffer);
      expect(bb.capacity).toEqual(1);
      expect(bb.roffset).toEqual(0);
    });

    it("reverse", () => {
      const bb = SmartBuffer.wrap("\x12\x34\x56\x78");
      bb.reverse(1, 3);
      expect(bb.toString("debug")).toEqual("<12 56 34 78]");
      bb.reverse();
      expect(bb.toString("debug")).toEqual("<78 34 56 12]");
      bb.roffset = 1;
      bb.woffset = 3;
      bb.reverse();
      expect(bb.toString("debug")).toEqual("78<56 34>12*");
      bb.reverse(0, 4).reset(true);
      expect(bb.toString("debug")).toEqual("^12 34 56 78*");
    });

    it("write", () => {
      const bb = SmartBuffer.wrap("\x12\x34");
      const bb2 = SmartBuffer.wrap("\x56\x78");
      bb.roffset = 2;
      bb.write(bb2); // Modifies offsets of both
      expect(bb.toString("debug")).toEqual("12 34<56 78]");
      expect(bb2.toString("debug")).toEqual("56 78|");
      bb2.reset();
      bb.write(bb2, 1); // Modifies offsets of bb2 only
      expect(bb.toString("debug")).toEqual("12 56<78 78]");
      expect(bb2.toString("debug")).toEqual("56 78|");
    });

    describe("writeBuffer", () => {
      it("should prepend a buffer", () => {
        const b = new SmartBuffer();
        b.writeBuffer(Buffer.from("hello"));
        b.writeBuffer(Buffer.from(" "));
        b.writeBuffer(Buffer.from("world"));
        expect(b.toBuffer()).toEqual(Buffer.from("hello world"));
      });

      it("should write at the given offset", () => {
        const b = new SmartBuffer();
        b.writeBuffer(Buffer.alloc(7)); // TODO: WTF, otherways it does not work, because the offset prop is zero
        b.writeBuffer(Buffer.from("hello"), 0);
        b.writeBuffer(Buffer.from(" "), 1);
        b.writeBuffer(Buffer.from("world"), 2);
        expect(b.toBuffer()).toEqual(Buffer.from("h world"));
      });
    });

    it("prepend", () => {
      const bb = SmartBuffer.wrap("\x12\x34");
      const bb2 = SmartBuffer.wrap("\x56\x78");
      expect(bb.prepend(bb2)).toEqual(bb); // Relative prepend at 0, 2 bytes (2 overflow)
      expect(bb.toDebug()).toEqual("<56 78 12 34]");
      expect(bb2.toDebug()).toEqual("56 78|");
      bb.roffset = 4;
      bb2.roffset = 1;
      bb.prepend(bb2, 3); // Absolute prepend at 3, 1 byte
      expect(bb.toDebug()).toEqual("56 78 78 34|");
      expect(bb2.toDebug()).toEqual("56 78|");
      bb2.roffset = 0;
      bb.prepend(bb2); // Relative prepend at 4, 2 bytes
      expect(bb.toDebug()).toEqual("56 78<56 78]");
      expect(bb2.toDebug()).toEqual("56 78|");
      bb.roffset = 3;
      bb2.roffset = 0;
      expect(() => {
        bb.prepend(bb2, 6); // Absolute out of bounds
      }).toThrow(RangeError);
      bb.prepend("abcde"); // Relative prepend at 3, 5 bytes (1 overflow)
      expect(bb.toDebug()).toEqual("<61 62 63 64 65 78]");
    });

    it("prependTo", () => {
      const bb = SmartBuffer.wrap("\x12\x34");
      const bb2 = SmartBuffer.wrap("\x56\x78");
      expect(bb2.prependTo(bb)).toEqual(bb2);
      expect(bb.toDebug()).toEqual("<56 78 12 34]");
      expect(bb2.toDebug()).toEqual("56 78|");
    });

    it("length", () => {
      const bb = SmartBuffer.wrap("\x12\x34");
      expect(bb.length).toEqual(2);
      bb.roffset = 2;
      expect(bb.length).toEqual(0);
      bb.roffset = 3;
      expect(bb.length).toEqual(-1);
    });

    it("skipRead", () => {
      const bb = SmartBuffer.wrap("\x12\x34\x56");
      expect(bb.roffset).toEqual(0);
      expect(bb.woffset).toEqual(3);
      bb.skipRead(3);
      expect(bb.roffset).toEqual(3);
      expect(bb.woffset).toEqual(3);
      expect(bb.noAssert).toEqual(false);
      expect(() => {
        bb.skipRead(1);
      }).toThrow(RangeError);
      expect(bb.roffset).toEqual(3);
      expect(bb.woffset).toEqual(3);
      bb.noAssert = true;
      expect(() => {
        bb.skipRead(1);
      }).not.toThrow();
      expect(bb.roffset).toEqual(4);
      expect(bb.woffset).toEqual(3);
    });

    it("skipWrite", () => {
      const bb = new SmartBuffer(3);
      expect(bb.roffset).toEqual(0);
      expect(bb.woffset).toEqual(0);
      bb.skipWrite(3);
      expect(bb.roffset).toEqual(0);
      expect(bb.woffset).toEqual(3);
      expect(bb.noAssert).toEqual(false);
      expect(() => {
        bb.skipWrite(1);
      }).toThrow(RangeError);
      expect(bb.woffset).toEqual(3);
      expect(bb.roffset).toEqual(0);
      bb.noAssert = true;
      expect(() => {
        bb.skipWrite(1);
      }).not.toThrow();
      expect(bb.woffset).toEqual(4);
    });

    it("order", () => {
      const bb = new SmartBuffer(2);
      bb.writeInt32BE(0x12345678);
      bb.reset();
      expect(bb.toHex()).toEqual("12345678");
      bb.reset(true);
      bb.writeInt32LE(0x12345678);
      bb.reset();
      expect(bb.toHex()).toEqual("78563412");
    });
  });

  describe("types", () => {
    const types = [
      // name          | size | input                                   | output                                  | BE representation
      ["Int8", 1, 0xFE, -2, "fe"],
      ["UInt8", 1, -2, 0xFE, "fe"],
      ["Int16", 2, 0xFFFE, -2, "fffe"],
      ["UInt16", 2, -2, 0xFFFE, "fffe"],
      ["Int32", 4, 0xFFFFFFFE, -2, "fffffffe"],
      ["UInt32", 4, -2, 0xFFFFFFFE, "fffffffe"],
      ["Float", 4, 0.5, 0.5, "3f000000"],
      ["Double", 8, 0.1, 0.1, "3fb999999999999a"],
      ["Int64", 8, new Long(0xFFFFFFFE, 0xFFFFFFFF, true), new Long(0xFFFFFFFE, 0xFFFFFFFF, false), "fffffffffffffffe"],
      ["UInt64", 8, new Long(0xFFFFFFFE, 0xFFFFFFFF, false), new Long(0xFFFFFFFE, 0xFFFFFFFF, true), "fffffffffffffffe"],

      // name          | size | input                                   | output                                  | representation
      ["Varint32", 5, 0xFFFFFFFE, -2, "feffffff0f"],
      ["Varint32ZigZag", 1, -1, -1, "01"],
      ["Varint64", 10, new Long(0xFFFFFFFE, 0xFFFFFFFF, true), new Long(0xFFFFFFFE, 0xFFFFFFFF, false), "feffffffffffffffff01"],
      ["Varint64ZigZag", 1, Long.fromNumber(-1), Long.fromNumber(-1), "01"]
    ];

    types.forEach((type) => {
      const [name, size, input, output, be] = type;
      const varint = name.includes("Varint");
      const byte = name.toLowerCase().includes("int8");
      let le = "";
      for (let i = be.length; i > 0; i -= 2) {
        le += be.substr(i - 2, 2);
      }
      it(name.toLowerCase(), () => {
        const bb = new SmartBuffer(size);
        let writeLE: string;
        let readLE;
        let writeBE;
        let readBE;
        if (varint || byte) {
          writeLE = `write${name}`;
          readLE = `read${name}`;
          writeBE = writeLE;
          readBE = readLE;
        } else {
          writeLE = `write${name}LE`;
          readLE = `read${name}LE`;
          writeBE = `write${name}BE`;
          readBE = `read${name}BE`;
        }
        expect(bb).toHaveProperty(writeLE);
        expect(bb).toHaveProperty(readLE);
        expect(bb).toHaveProperty(writeBE);
        expect(bb).toHaveProperty(readBE);

        // Relative BE (always LE for varints)
        expect(bb[writeBE](input)).toEqual(bb);
        let val = bb[readBE]();
        expect(val).toEqual(output);
        bb.reset();
        expect(bb.toHex()).toEqual(be);
        if (!varint && !byte) {
          bb.reset(true);
          // Relative LE
          bb[writeLE](input);
          val = bb[readLE]();
          expect(val).toEqual(output);
          bb.reset();
          expect(bb.toHex()).toEqual(le);
        }
        expect(() => { // OOB
          bb.roffset = bb.capacity - size + 1;
          bb[readLE](input);
        }).toThrow();
        expect(() => { // OOB, automatic resizing * 2
          bb[writeLE](input);
        }).not.toThrow();
        expect(bb.capacity).toEqual(size * 2);
        // Absolute
        bb.reset(true);
        if (!varint) {
          expect(bb[writeLE](input, 1)).toEqual(bb);
        } else {
          expect(bb[writeLE](input, 1)).toEqual(size);
        }
        val = bb[readLE](1);
        if (output instanceof Long) {
          if (!varint) {
            expect(val).toEqual(output);
          } else {
            expect(val).toEqual({ value: output, length: size });
          }
        } else {
          if (!varint) {
            expect(val).toEqual(output);
          } else {
            expect(val).toEqual({ value: output, length: size });
          }
        }
      });
    });

    it("bitset", () => {
      const bb = new SmartBuffer(2);

      const run = (data) => {
        bb.reset(true);
        bb.writeBitSet(data);
        expect(bb.readBitSet()).toEqual(data);
      };

      run([]);
      run([true]);
      run([false]);
      run([false, true]);
      run([false, false, false, false, false, false, false, false]);
      run([true, false, true, false, true, false, true, false]);
      run([true, true, true, true, true, true, true, true]);
      run([true, false, true, false, true, false, true, false]);
      run([true, false, true, false, true, false, true, false, true]);

      bb.reset(true);
      bb.writeBitSet([, null, "", 0, 42, "hello world", new Date(0), {}, []]);
      expect(bb.readBitSet()).toEqual([false, false, false, false, true, true, true, true, true]);
    });

    it("calculateVarint", () => {
      expect(SmartBuffer.MAX_VARINT64_BYTES).toEqual(10);
      expect(SmartBuffer.MAX_VARINT32_BYTES).toEqual(5);
      let values: any[] = [
        [0, 1],
        [-1, 5, 10],
        [1 << 7, 2],
        [1 << 14, 3],
        [1 << 21, 4],
        [1 << 28, 5],
        [0x7FFFFFFF | 0, 5],
        [0xFFFFFFFF, 5],
        [0xFFFFFFFF | 0, 5, 10]
      ];
      for (let i = 0; i < values.length; i++) {
        expect(SmartBuffer.calculateVarint32(values[i][0])).toEqual(values[i][1]);
        expect(SmartBuffer.calculateVarint64(values[i][0])).toEqual(values[i].length > 2 ? values[i][2] : values[i][1]);
      }
      values = [
        [Long.fromNumber(1).shl(35), 6],
        [Long.fromNumber(1).shl(42), 7],
        [Long.fromNumber(1).shl(49), 8],
        [Long.fromNumber(1).shl(56), 9],
        [Long.fromNumber(1).shl(63), 10],
        [Long.fromNumber(1, true).shl(63), 10]
      ];
      for (let i = 0; i < values.length; i++) {
        expect(SmartBuffer.calculateVarint64(values[i][0])).toEqual(values[i][1]);
      }
    });

    it("zigZagVarint", () => {
      let values: any[] = [
        [0, 0],
        [-1, 1],
        [1, 2],
        [-2, 3],
        [2, 4],
        [-3, 5],
        [3, 6],
        [2147483647, 4294967294],
        [-2147483648, 4294967295]
      ];
      for (let i = 0; i < values.length; i++) {
        expect(SmartBuffer.zigZagEncode32(values[i][0])).toEqual(values[i][1]);
        expect(SmartBuffer.zigZagDecode32(values[i][1])).toEqual(values[i][0]);
        expect(SmartBuffer.zigZagEncode64(values[i][0]).toNumber()).toEqual(values[i][1]);
        expect(SmartBuffer.zigZagDecode64(values[i][1]).toNumber()).toEqual(values[i][0]);
      }
      values = [
        [Long.MAX_VALUE, Long.MAX_UNSIGNED_VALUE.sub(Long.ONE)],
        [Long.MIN_VALUE, Long.MAX_UNSIGNED_VALUE]
      ];
      // NOTE: Even 64bit doubles from toNumber() fail for these values so we are using toString() here
      for (let i = 0; i < values.length; i++) {
        expect(SmartBuffer.zigZagEncode64(values[i][0]).toString()).toEqual(values[i][1].toString());
        expect(SmartBuffer.zigZagDecode64(values[i][1]).toString()).toEqual(values[i][0].toString());
      }

      // 32 bit ZZ
      values = [
        0,
        1,
        300,
        -300,
        2147483647,
        -2147483648
      ];
      let bb = new SmartBuffer(10);
      for (let i = 0; i < values.length; i++) {
        const encLen = bb.writeVarint32ZigZag(values[i], 0);
        // bb.limit = encLen;
        const dec = bb.readVarint32ZigZag(0);
        expect(dec.value).toEqual(values[i]);
        expect(encLen).toEqual(dec.length);
        bb.reset(true);
      }

      // 64 bit ZZ
      values = [
        Long.ONE, 1,
        Long.fromNumber(-3),
        Long.fromNumber(300),
        Long.fromNumber(-300),
        Long.fromNumber(0x7FFFFFFF),
        Long.fromNumber(0x8FFFFFFF),
        Long.fromNumber(0xFFFFFFFF),
        Long.fromBits(0xFFFFFFFF, 0x7FFFFFFF),
        Long.fromBits(0xFFFFFFFF, 0xFFFFFFFF)
      ];
      bb = new SmartBuffer(10);
      for (let i = 0; i < values.length; i++) {
        const encLen = bb.writeVarint64ZigZag(values[i], 0);
        const dec = bb.readVarint64ZigZag(0);
        expect(values[i].toString()).toEqual(dec.value.toString());
        expect(encLen).toEqual(dec.length);
      }
    });

    it("utf8string", () => {
      const bb = new SmartBuffer(2);
      const str = "ä☺𠜎️☁️";
      let str2;
      // Writing
      expect(bb.writeString(str)).toEqual(bb);
      bb.reset();
      // Reading
      str2 = bb.readString(SmartBuffer.calculateUTF8Chars(str), SmartBuffer.METRICS_CHARS);
      expect(str2.length).toEqual(str.length);
      expect(str2).toEqual(str);
      bb.reset();
      str2 = bb.readString(bb.capacity, SmartBuffer.METRICS_BYTES);
      expect(str2).toEqual(str);
    });

    it("vstring", () => {
      const bb = new SmartBuffer(2);
      bb.writeVString("ab"); // resizes to 2*2=4
      expect(bb.capacity).toEqual(4);
      expect(bb.woffset).toEqual(3);
      expect(bb.toString("debug").substr(0, 10)).toEqual("<02 61 62>");
      expect(bb.readVString(0)).toEqual({ string: "ab", length: 3 });
      expect(bb.toString("debug").substr(0, 10)).toEqual("<02 61 62>");
      expect(bb.readVString()).toEqual("ab");
      expect(bb.toString("debug").substr(0, 9)).toEqual("02 61 62^");
    });

    it("cstring", () => {
      const bb = new SmartBuffer(2);
      bb.writeCString("a");
      expect(bb.capacity).toEqual(2);
      expect(bb.woffset).toEqual(2);
      bb.woffset = 1;
      bb.writeCString("b"); // resizes to 4
      expect(bb.capacity).toEqual(4);
      expect(bb.woffset).toEqual(3);
      expect(bb.toString("debug").substr(0, 10)).toEqual("<61 62 00>");
      expect(bb.readCString(0)).toEqual({ string: "ab", length: 3 });
      expect(bb.toString("debug").substr(0, 10)).toEqual("<61 62 00>");
      expect(bb.readCString()).toEqual("ab");
      expect(bb.toString("debug").substr(0, 9)).toEqual("61 62 00^");
    });
  });

  describe("convert", () => {
    it("toHex", () => {
      const bb = new SmartBuffer(4);
      bb.writeUInt16BE(0x1234);
      bb.writeUInt8(0x56);
      expect(bb.toHex()).toEqual("123456");
      expect(bb.roffset).toEqual(0);
      expect(bb.woffset).toEqual(3);
      expect(bb.toHex(1)).toEqual("3456");
      expect(bb.toHex(1, 2)).toEqual("34");
      expect(bb.toHex(1, 1)).toEqual("");
      expect(() => {
        bb.toHex(1, 0);
      }).toThrow();
    });

    it("toBase64", () => {
      const bb = new SmartBuffer(8);
      bb.writeString("abcdefg"); // 7 chars
      expect(bb.toBase64()).toEqual("YWJjZGVmZw==");
      expect(bb.roffset).toEqual(0);
      expect(bb.woffset).toEqual(7);
      expect(bb.toBase64(3)).toEqual("ZGVmZw==");
      expect(bb.toBase64(3, 6)).toEqual("ZGVm");
      expect(bb.toBase64(3, 3)).toEqual("");
      expect(() => {
        bb.toBase64(1, 0);
      }).toThrow();
    });

    it("toBinary", () => {
      const bb = new SmartBuffer(5);
      bb.writeUInt32BE(0x001234FF);
      // bb.flip();
      expect(bb.toBinary()).toEqual("\x00\x12\x34\xFF");
      expect(bb.roffset).toEqual(0);
      expect(bb.woffset).toEqual(4);
    });

    it("toString", () => {
      const bb = new SmartBuffer(3);
      bb.writeUInt16BE(0x6162);
      expect(bb.toString("hex")).toEqual("6162");
      expect(bb.toString("base64")).toEqual("YWI=");
      expect(bb.toString("utf8")).toEqual("ab");
      expect(bb.toString("debug").substr(0, 7)).toEqual("<61 62>");
      expect(bb.toString()).toEqual("ByteArrayNB(roffset=0,woffset=2,capacity=3)");
      expect(bb.roffset).toEqual(0);
      expect(bb.woffset).toEqual(2);
    });

    it("toBuffer", () => {
      const bb = new SmartBuffer(2);
      bb.writeUInt16BE(0x1234);
      let buf = bb.toBuffer();
      expect(buf).toEqual(bb.buffer);
      expect(buf instanceof Buffer).toBeTruthy();
      expect(buf.length).toEqual(2);
      bb.woffset = 1;
      buf = bb.toBuffer();
      expect(buf).not.toBe(bb.buffer);
      expect(buf instanceof Buffer).toBeTruthy();
      expect(buf.length).toEqual(1);
    });

    it("toArrayBuffer", () => {
      const bb = new SmartBuffer(3);
      expect(bb.buffer).toBeInstanceOf(Buffer);
      bb.writeUInt16BE(0x1234);
      bb.roffset = 1;
      const ab = bb.toArrayBuffer();
      expect(ab).toBeInstanceOf(ArrayBuffer);
      expect(ab.byteLength).toEqual(1);
    });
  });

  describe("misc", () => {
    it("pbjsi19", () => {
      // assert that this issue is fixed: https://github.com/dcodeIO/ProtoBuf.js/issues/19
      const bb = new SmartBuffer(9); // Trigger resize to 18 in writeVarint64
      bb.writeVarint32(16);
      bb.writeVarint32(2);
      bb.writeVarint32(24);
      bb.writeVarint32(0);
      bb.writeVarint32(32);
      bb.writeVarint64(Long.fromString("1368057600000"));
      bb.writeVarint32(40);
      bb.writeVarint64(Long.fromString("1235455123"));
      bb.reset();
      expect(bb.toString("debug").substr(0, 52)).toEqual("<10 02 18 00 20 80 B0 D9 B4 E8 27 28 93 99 8E CD 04>");
    });

    it("NaN", () => {
      const bb = new SmartBuffer(4);
      expect(isNaN(bb.writeFloatBE(NaN).readFloatBE(0))).toBeTruthy();
      bb.reset(true);
      expect(bb.writeFloatBE(Number(Infinity)).readFloatBE(0)).toEqual(Number(Infinity));
      bb.reset(true);
      expect(bb.writeFloatBE(-Infinity).readFloatBE(0)).toEqual(-Infinity);
      bb.resize(8).reset(true);
      expect(isNaN(bb.writeDoubleBE(NaN).readDoubleBE(0))).toBeTruthy();
      bb.reset(true);
      expect(bb.writeDoubleBE(Number(Infinity)).readDoubleBE(0)).toEqual(Number(Infinity));
      bb.reset(true);
      expect(bb.writeDoubleBE(-Infinity).readDoubleBE(0)).toEqual(-Infinity);

      // letints, however, always need a cast, which results in the following:
      expect(NaN >>> 0).toEqual(0);
      expect(NaN | 0).toEqual(0);
      expect(Infinity >>> 0).toEqual(0);
      expect(Infinity | 0).toEqual(0);
      expect(-Infinity >>> 0).toEqual(0);
      expect(-Infinity | 0).toEqual(0);
    });
  });
});
