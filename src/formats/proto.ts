import { ReleaseLintError, type XmlElement } from '../types.js';

const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
/** A real manifest nests about 6 levels deep; this stops hostile input from blowing the stack. */
const MAX_DEPTH = 100;
const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_LENGTH = 2;
const WIRE_32BIT = 5;

type Fields = Map<number, Array<number | Buffer>>;

/**
 * Parses an aapt2 protobuf `XmlNode` (`base/manifest/AndroidManifest.xml` in an .aab) into an
 * element tree. Field numbers follow aapt2's Resources.proto; unknown fields are skipped.
 */
export function parseProtoXml(buf: Buffer): XmlElement {
  const root = decode(buf).get(1)?.[0];
  if (!Buffer.isBuffer(root)) {
    throw new ReleaseLintError('The manifest has no root element');
  }
  return element(root, 0);
}

function decode(buf: Buffer): Fields {
  const fields: Fields = new Map();
  let pos = 0;
  const readVarint = (): number => {
    let value = 0;
    for (let shift = 0; shift < 70; shift += 7) {
      const byte = buf[pos++];
      if (byte === undefined) throw new ReleaseLintError('The manifest is truncated');
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return value;
    }
    throw new ReleaseLintError('Malformed manifest (varint too long)');
  };
  const take = (length: number): Buffer => {
    if (pos + length > buf.length) throw new ReleaseLintError('The manifest is truncated');
    const out = buf.subarray(pos, pos + length);
    pos += length;
    return out;
  };
  while (pos < buf.length) {
    const key = readVarint();
    const num = Math.floor(key / 8);
    const wire = key % 8;
    let value: number | Buffer;
    if (wire === WIRE_VARINT) value = readVarint();
    else if (wire === WIRE_LENGTH) value = take(readVarint());
    else if (wire === WIRE_32BIT) value = take(4).readUInt32LE(0);
    else if (wire === WIRE_64BIT) value = take(8);
    else throw new ReleaseLintError(`Malformed manifest (wire type ${wire})`);
    const list = fields.get(num);
    if (list) list.push(value);
    else fields.set(num, [value]);
  }
  return fields;
}

const text = (value: number | Buffer | undefined): string => (Buffer.isBuffer(value) ? value.toString('utf8') : '');
const messages = (fields: Fields, num: number): Fields[] =>
  (fields.get(num) ?? []).filter(Buffer.isBuffer).map((b) => decode(b));

function element(buf: Buffer, depth: number): XmlElement {
  if (depth > MAX_DEPTH) {
    throw new ReleaseLintError('The manifest is nested too deep');
  }
  const fields = decode(buf);
  const attributes: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const attr of messages(fields, 4)) {
    const name = text(attr.get(2)?.[0]);
    // A name never carries its own prefix ("android:debuggable" without a namespace is fake), and a real build
    // never writes an attribute twice; either would let a crafted manifest hide a value from the scan.
    if (name.includes(':')) throw new ReleaseLintError('The manifest has an invalid attribute name');
    const key = text(attr.get(1)?.[0]) === ANDROID_NS ? `android:${name}` : name;
    if (key in attributes) throw new ReleaseLintError(`The manifest sets ${key} twice`);
    attributes[key] = attributeValue(attr);
  }
  const children = messages(fields, 5)
    .map((node) => node.get(1)?.[0])
    .filter(Buffer.isBuffer)
    .map((child) => element(child, depth + 1));
  return { name: text(fields.get(3)?.[0]), attributes, children };
}

/** The compiled value, as Android reads it (boolean, int or `@0x…` reference); the source text only for strings. */
function attributeValue(attr: Fields): string {
  const item = messages(attr, 6)[0];
  const prim = item && messages(item, 7)[0];
  if (prim?.has(8)) {
    return prim.get(8)?.[0] ? 'true' : 'false';
  }
  const int = prim?.get(6)?.[0] ?? prim?.get(7)?.[0];
  if (typeof int === 'number') {
    return String(int);
  }
  const ref = item && messages(item, 1)[0];
  if (ref) {
    return `@0x${Number(ref.get(2)?.[0] ?? 0).toString(16).padStart(8, '0')}`;
  }
  const source = text(attr.get(3)?.[0]);
  if (source) {
    return source;
  }
  const str = item && (messages(item, 2)[0] ?? messages(item, 3)[0]);
  return str ? text(str.get(1)?.[0]) : '';
}
