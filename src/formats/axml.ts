import { ReleaseLintError, type XmlElement } from '../types.js';

const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
const RES_XML_TYPE = 0x0003;
const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const RES_XML_END_ELEMENT_TYPE = 0x0103;
const UTF8_FLAG = 0x100;
const NO_INDEX = 0xffffffff;
const ATTRIBUTE_SIZE = 20;
const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

/** Real manifests are a few levels deep with a few hundred elements; these limits stop hostile files. */
const MAX_DEPTH = 100;
const MAX_ELEMENTS = 20_000;
const MAX_ATTRIBUTES = 100_000;
/** Strings are decoded on demand; many entries pointing at one huge string must not multiply memory. */
const MAX_DECODED_BYTES = 16 * 1024 * 1024;

/**
 * The android:* attributes release-lint reads, by resource ID (checked with `aapt2 dump xmltree` on a release APK).
 * Android itself identifies attributes by these IDs, so they win over the name string, which a file can fake.
 */
const ANDROID_ATTR_NAMES: ReadonlyMap<number, string> = new Map([
  [0x01010001, 'label'],
  [0x01010003, 'name'],
  [0x0101000f, 'debuggable'],
  [0x01010027, 'scheme'],
  [0x01010028, 'host'],
  [0x0101021b, 'versionCode'],
  [0x0101021c, 'versionName'],
  [0x010104ec, 'usesCleartextTraffic'],
  [0x010104ee, 'autoVerify'],
]);

const malformed = () => new ReleaseLintError('The manifest is truncated or malformed');

type Lookup = (index: number) => string;

/**
 * Parses Android binary XML (`AndroidManifest.xml` in an .apk) into an element tree. It reads the file the way Android
 * does (attribute names by resource ID, typed values over raw strings) and rejects anything a real build tool never
 * writes (a second string pool, duplicate or fake-namespaced attributes, elements after the root), so a crafted
 * manifest cannot show the scanner something different from what the device runs.
 */
export function parseAxml(buf: Buffer): XmlElement {
  try {
    return parse(buf);
  } catch (error) {
    if (error instanceof RangeError) throw malformed();
    throw error;
  }
}

function parse(buf: Buffer): XmlElement {
  if (buf.length < 8 || buf.readUInt16LE(0) !== RES_XML_TYPE) {
    throw new ReleaseLintError('AndroidManifest.xml is not Android binary XML');
  }
  const end = buf.readUInt32LE(4);
  if (end > buf.length) throw malformed();

  let str: Lookup | undefined;
  let resourceIds: number[] = [];
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  let elements = 0;
  const attributes = { count: 0 };

  for (let pos = buf.readUInt16LE(2); pos + 8 <= end; ) {
    const type = buf.readUInt16LE(pos);
    const headerSize = buf.readUInt16LE(pos + 2);
    const size = buf.readUInt32LE(pos + 4);
    if (size < 8 || headerSize > size || pos + size > end) throw malformed();
    const chunk = buf.subarray(pos, pos + size);

    if (type === RES_STRING_POOL_TYPE) {
      if (str || root) throw malformed(); // one pool, before the first element
      str = stringPool(chunk);
    } else if (type === RES_XML_RESOURCE_MAP_TYPE) {
      if (resourceIds.length > 0 || root) throw malformed();
      resourceIds = Array.from({ length: Math.floor((size - headerSize) / 4) }, (_, i) => chunk.readUInt32LE(headerSize + i * 4));
    } else if (type === RES_XML_START_ELEMENT_TYPE) {
      if (!str || (root && stack.length === 0)) throw malformed(); // no strings yet, or a second root
      if (stack.length >= MAX_DEPTH) throw new ReleaseLintError('The manifest is nested too deep');
      if (++elements > MAX_ELEMENTS) throw malformed();
      const el = element(chunk, headerSize, str, resourceIds, attributes);
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(el);
      else root = el;
      stack.push(el);
    } else if (type === RES_XML_END_ELEMENT_TYPE) {
      if (stack.length === 0) throw malformed();
      stack.pop();
    }
    pos += size;
  }
  if (!root) throw new ReleaseLintError('The manifest has no root element');
  if (stack.length > 0) throw malformed();
  if (root.name !== 'manifest') throw new ReleaseLintError('AndroidManifest.xml does not start with <manifest>');
  return root;
}

/** Returns a lookup that decodes each string on first use, once per offset, within a total budget. */
function stringPool(chunk: Buffer): Lookup {
  const headerSize = chunk.readUInt16LE(2);
  const count = chunk.readUInt32LE(8);
  const utf8 = (chunk.readUInt32LE(16) & UTF8_FLAG) !== 0;
  const stringsStart = chunk.readUInt32LE(20);
  if (headerSize + count * 4 > chunk.length || stringsStart > chunk.length) throw malformed();
  const cache = new Map<number, string>();
  let decoded = 0;
  return (index) => {
    if (index === NO_INDEX || index >= count) return '';
    const offset = stringsStart + chunk.readUInt32LE(headerSize + index * 4);
    const known = cache.get(offset);
    if (known !== undefined) return known;
    const value = decodeString(chunk, offset, utf8);
    decoded += value.length * 2;
    if (decoded > MAX_DECODED_BYTES) throw malformed();
    cache.set(offset, value);
    return value;
  };
}

/** Pool strings are length-prefixed: UTF-16 with a 1-2 unit char count, UTF-8 with 1-2 byte char and byte counts. */
function decodeString(chunk: Buffer, at: number, utf8: boolean): string {
  let pos = at;
  if (utf8) {
    const readLength = () => {
      const first = chunk.readUInt8(pos);
      const value = first & 0x80 ? ((first & 0x7f) << 8) | chunk.readUInt8(pos + 1) : first;
      pos += first & 0x80 ? 2 : 1;
      return value;
    };
    readLength(); // character count, not needed
    const bytes = readLength();
    if (pos + bytes > chunk.length) throw malformed();
    return chunk.toString('utf8', pos, pos + bytes);
  }
  let units = chunk.readUInt16LE(pos);
  pos += 2;
  if (units & 0x8000) {
    units = ((units & 0x7fff) << 16) | chunk.readUInt16LE(pos);
    pos += 2;
  }
  if (pos + units * 2 > chunk.length) throw malformed();
  return chunk.toString('utf16le', pos, pos + units * 2);
}

function element(chunk: Buffer, headerSize: number, str: Lookup, resourceIds: number[], budget: { count: number }): XmlElement {
  const ext = headerSize;
  const attrStart = chunk.readUInt16LE(ext + 8);
  const attrSize = chunk.readUInt16LE(ext + 10);
  const count = chunk.readUInt16LE(ext + 12);
  // A size below 20 would re-read overlapping bytes; all attributes must fit in the chunk.
  if (count > 0 && (attrSize < ATTRIBUTE_SIZE || ext + attrStart + count * attrSize > chunk.length)) throw malformed();
  budget.count += count;
  if (budget.count > MAX_ATTRIBUTES) throw malformed();

  const attributes = Object.create(null) as Record<string, string>;
  for (let i = 0; i < count; i++) {
    const at = ext + attrStart + i * attrSize;
    const nameIndex = chunk.readUInt32LE(at + 4);
    const known = ANDROID_ATTR_NAMES.get(resourceIds[nameIndex] ?? 0);
    let key: string;
    if (known) {
      key = `android:${known}`;
    } else {
      const name = str(nameIndex);
      if (name.includes(':')) throw malformed(); // a name never carries its own prefix: "android:debuggable" is fake
      key = str(chunk.readUInt32LE(at)) === ANDROID_NS ? `android:${name}` : name;
    }
    if (key in attributes) throw malformed();
    attributes[key] = attributeValue(str, chunk.readUInt32LE(at + 8), chunk.readUInt8(at + 15), chunk.readUInt32LE(at + 16));
  }
  return { name: str(chunk.readUInt32LE(ext + 4)), attributes, children: [] };
}

/** The typed value, as Android reads it; the raw string only when there is no typed value. */
function attributeValue(str: Lookup, raw: number, dataType: number, data: number): string {
  switch (dataType) {
    case TYPE_INT_BOOLEAN:
      return data !== 0 ? 'true' : 'false';
    case TYPE_REFERENCE:
      return `@0x${data.toString(16).padStart(8, '0')}`;
    case TYPE_STRING:
      return str(data);
    case TYPE_INT_DEC:
      return String(data | 0);
    case TYPE_INT_HEX:
      return `0x${data.toString(16)}`;
    default:
      return raw !== NO_INDEX ? str(raw) : String(data);
  }
}
