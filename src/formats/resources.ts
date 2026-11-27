// Look up Android string resources by resource id (0xPPTTEEEE).
//
// Two formats are supported, matching the two Android distribution
// formats release-lint already reads:
//   - resources.arsc in an .apk (the binary Android resource table)
//   - base/resources.pb in an .aab (the aapt2 ResourceTable protobuf)
//
// Only the "string" type is collected: that is what a deep link host
// written as @string/app_link_host resolves to. When several
// configurations carry a value for the same id, the default
// configuration wins; any other configuration is only a fallback.
// No new dependencies: both parsers are hand-written in the style of
// the existing parsers in src/formats/ (zip, binary XML, protobuf).

const TYPE_STRING = 0x03;
const RES_TABLE_TYPE = 0x0002;
const RES_STRING_POOL_TYPE = 0x0001;
const RES_TABLE_PACKAGE_TYPE = 0x0200;
const RES_TABLE_TYPE_TYPE = 0x0201;
const UTF8_FLAG = 0x100;
const FLAG_COMPLEX = 0x0001;

/** Merge fallback values with default-configuration values on top. */
function mergeValues(fallback: Map<number, string>, defaults: Map<number, string>): Map<number, string> {
  return new Map([...fallback, ...defaults]);
}

interface StringPool {
  strings: string[];
  size: number;
}

/** Read a UTF-8 length as stored in a string pool: one byte, or two
 *  bytes when the high bit of the first byte is set. */
function readUtf8Length(buf: Buffer, pos: number): [number, number] {
  const first = buf.readUInt8(pos);
  if ((first & 0x80) !== 0) {
    return [((first & 0x7f) << 8) | buf.readUInt8(pos + 1), pos + 2];
  }
  return [first, pos + 1];
}

function parseStringPool(buf: Buffer, offset: number): StringPool {
  if (offset + 28 > buf.length || buf.readUInt16LE(offset) !== RES_STRING_POOL_TYPE) {
    throw new Error('invalid resources.arsc: expected a string pool');
  }
  const headerSize = buf.readUInt16LE(offset + 2);
  const size = buf.readUInt32LE(offset + 4);
  const stringCount = buf.readUInt32LE(offset + 8);
  const flags = buf.readUInt16LE(offset + 16);
  const stringsStart = buf.readUInt32LE(offset + 20);
  const strings: string[] = [];
  for (let i = 0; i < stringCount; i++) {
    const stringOffset = buf.readUInt32LE(offset + headerSize + i * 4);
    let pos = offset + stringsStart + stringOffset;
    if ((flags & UTF8_FLAG) !== 0) {
      // A UTF-8 string stores its UTF-16 length first, then its
      // UTF-8 byte length, then the bytes and a NUL terminator.
      const [, afterUtf16Length] = readUtf8Length(buf, pos);
      const [byteLength, afterUtf8Length] = readUtf8Length(buf, afterUtf16Length);
      pos = afterUtf8Length;
      strings.push(buf.toString('utf8', pos, pos + byteLength));
    } else {
      let length = buf.readUInt16LE(pos);
      pos += 2;
      if ((length & 0x8000) !== 0) {
        length = ((length & 0x7fff) << 16) | buf.readUInt16LE(pos);
        pos += 2;
      }
      strings.push(buf.toString('utf16le', pos, pos + length * 2));
    }
  }
  return { strings, size };
}

/**
 * Parse resources.arsc and return the string resources keyed by
 * resource id. Only entries whose value has data type TYPE_STRING
 * are returned.
 */
export function parseResourcesArsc(buf: Buffer): Map<number, string> {
  if (buf.length < 12 || buf.readUInt16LE(0) !== RES_TABLE_TYPE) {
    throw new Error('invalid resources.arsc: expected a resource table');
  }
  const values = parseStringPool(buf, 12).strings;
  const poolSize = parseStringPool(buf, 12).size;
  const defaults = new Map<number, string>();
  const fallback = new Map<number, string>();
  let offset = 12 + poolSize;
  while (offset + 8 <= buf.length) {
    const chunkType = buf.readUInt16LE(offset);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkSize < 8 || offset + chunkSize > buf.length) {
      break;
    }
    if (chunkType === RES_TABLE_PACKAGE_TYPE) {
      const packageId = buf.readUInt32LE(offset + 8);
      // ResTable_package_header: chunk header (8), id (4), name
      // (128 UTF-16 code units, 256 bytes), then typeStrings (4),
      // lastPublicType (4), keyStrings (4), lastPublicKey (4).
      const typeStringsOffset = buf.readUInt32LE(offset + 268);
      const typeStrings = parseStringPool(buf, offset + typeStringsOffset).strings;
      const packageEnd = offset + chunkSize;
      const headerSize = buf.readUInt16LE(offset + 2);
      let pos = offset + headerSize;
      while (pos + 8 <= packageEnd) {
        const type = buf.readUInt16LE(pos);
        const size = buf.readUInt32LE(pos + 4);
        if (size < 8 || pos + size > packageEnd) {
          break;
        }
        if (type === RES_TABLE_TYPE_TYPE && typeStrings[buf.readUInt8(pos + 8) - 1] === 'string') {
          const typeId = buf.readUInt8(pos + 8);
          const entryCount = buf.readUInt32LE(pos + 12);
          const entriesStart = buf.readUInt32LE(pos + 16);
          const configSize = buf.readUInt32LE(pos + 20);
          // The default configuration is all zeroes after the
          // config size field; any other value means a specific
          // configuration (locale, density, ...).
          let configIsDefault = configSize >= 4;
          for (let i = pos + 24; i < pos + 20 + configSize; i++) {
            if (buf.readUInt8(i) !== 0) {
              configIsDefault = false;
              break;
            }
          }
          const entriesPos = pos + entriesStart;
          for (let entryIndex = 0; entryIndex < entryCount; entryIndex++) {
            const entryOffset = buf.readUInt32LE(entriesPos + entryIndex * 4);
            if (entryOffset === 0xffffffff) {
              continue;
            }
            const entryPos = entriesPos + entryOffset;
            const entrySize = buf.readUInt16LE(entryPos);
            const entryFlags = buf.readUInt16LE(entryPos + 2);
            if ((entryFlags & FLAG_COMPLEX) !== 0) {
              continue;
            }
            const valuePos = entryPos + entrySize;
            if (buf.readUInt8(valuePos + 3) !== TYPE_STRING) {
              continue;
            }
            const value = values[buf.readUInt32LE(valuePos + 4)];
            if (value === undefined) {
              continue;
            }
            const id = ((packageId << 24) | (typeId << 16) | entryIndex) >>> 0;
            if (configIsDefault) {
              defaults.set(id, value);
            } else if (!fallback.has(id)) {
              fallback.set(id, value);
            }
          }
        }
        pos += size;
      }
    }
    offset += chunkSize;
  }
  return mergeValues(fallback, defaults);
}

// --- base/resources.pb (aapt2 ResourceTable protobuf) ---------------------
//
// ResourceTable { repeated Package package = 1; }
// Package { uint32 package_id = 1; string name = 2; repeated Type type = 3; }
// Type { uint32 type_id = 1; string name = 2; repeated Entry entry = 3; }
// Entry { uint32 entry_id = 1; string name = 2; ...
//         repeated ConfigValue config_value = 6; }
// ConfigValue { Config config = 1; Value value = 2; }
// Value { Item item = 1; ... }
// Item { ... String str = 2; ... }
// String { string value = 1; }
// The default configuration is an empty Config message.

interface PbField {
  field: number;
  wire: number;
  varint?: number;
  bytes?: Buffer;
}

function readVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  let next = pos;
  for (;;) {
    if (next >= buf.length || shift >= 35) {
      throw new Error('invalid resources.pb: bad varint');
    }
    const byte = buf.readUInt8(next);
    next++;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return [result, next];
    }
    shift += 7;
  }
}

function parsePbFields(buf: Buffer): PbField[] {
  const fields: PbField[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const [tag, afterTag] = readVarint(buf, pos);
    pos = afterTag;
    const field = tag >>> 3;
    const wire = tag & 0x07;
    if (wire === 0) {
      const [value, afterValue] = readVarint(buf, pos);
      pos = afterValue;
      fields.push({ field, wire, varint: value });
    } else if (wire === 2) {
      const [length, afterLength] = readVarint(buf, pos);
      pos = afterLength;
      if (pos + length > buf.length) {
        throw new Error('invalid resources.pb: field overruns the buffer');
      }
      fields.push({ field, wire, bytes: buf.subarray(pos, pos + length) });
      pos += length;
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else {
      throw new Error('invalid resources.pb: unsupported wire type');
    }
  }
  return fields;
}

function pbBytes(fields: PbField[], fieldNumber: number): Buffer | undefined {
  return fields.find((field) => field.field === fieldNumber && field.bytes !== undefined)?.bytes;
}

function pbVarint(fields: PbField[], fieldNumber: number): number | undefined {
  return fields.find((field) => field.field === fieldNumber && field.varint !== undefined)?.varint;
}

function isDefaultConfig(config: Buffer | undefined): boolean {
  if (config === undefined || config.length === 0) {
    return true;
  }
  return [...config].every((byte) => byte === 0);
}

/**
 * Parse base/resources.pb and return the string resources keyed by
 * resource id. Only entries whose value is a String item are returned.
 */
export function parseResourcesPb(buf: Buffer): Map<number, string> {
  const defaults = new Map<number, string>();
  const fallback = new Map<number, string>();
  for (const packageField of parsePbFields(buf)) {
    if (packageField.field !== 1 || packageField.bytes === undefined) {
      continue;
    }
    const packageFields = parsePbFields(packageField.bytes);
    const packageId = pbVarint(packageFields, 1) ?? 0;
    for (const typeField of packageFields) {
      if (typeField.field !== 3 || typeField.bytes === undefined) {
        continue;
      }
      const typeFields = parsePbFields(typeField.bytes);
      if (pbBytes(typeFields, 2)?.toString('utf8') !== 'string') {
        continue;
      }
      const typeId = pbVarint(typeFields, 1) ?? 0;
      for (const entryField of typeFields) {
        if (entryField.field !== 3 || entryField.bytes === undefined) {
          continue;
        }
        const entryFields = parsePbFields(entryField.bytes);
        const entryId = pbVarint(entryFields, 1) ?? 0;
        for (const configField of entryFields) {
          if (configField.field !== 6 || configField.bytes === undefined) {
            continue;
          }
          const configFields = parsePbFields(configField.bytes);
          const valueBytes = pbBytes(configFields, 2);
          if (valueBytes === undefined) {
            continue;
          }
          const itemBytes = pbBytes(parsePbFields(valueBytes), 1);
          if (itemBytes === undefined) {
            continue;
          }
          const stringBytes = pbBytes(parsePbFields(itemBytes), 2);
          if (stringBytes === undefined) {
            continue;
          }
          const value = pbBytes(parsePbFields(stringBytes), 1)?.toString('utf8');
          if (value === undefined) {
            continue;
          }
          const id = ((packageId << 24) | (typeId << 16) | entryId) >>> 0;
          if (isDefaultConfig(pbBytes(configFields, 1))) {
            defaults.set(id, value);
          } else if (!fallback.has(id)) {
            fallback.set(id, value);
          }
        }
      }
    }
  }
  return mergeValues(fallback, defaults);
}
