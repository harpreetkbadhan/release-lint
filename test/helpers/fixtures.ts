import { zipSync } from 'fflate';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Writes bytes to a fresh temp directory and returns the file path. */
export async function writeTemp(name: string, bytes: Uint8Array): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'release-lint-'));
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

type XmlPlistValue = string | number | boolean | XmlPlistValue[] | { [key: string]: XmlPlistValue };

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Serializes a simple value as an XML property list, like the entitlements Xcode embeds. */
export function plistXml(value: XmlPlistValue): string {
  const encode = (v: XmlPlistValue): string => {
    if (typeof v === 'string') return `<string>${escapeXml(v)}</string>`;
    if (typeof v === 'number') return Number.isInteger(v) ? `<integer>${v}</integer>` : `<real>${v}</real>`;
    if (typeof v === 'boolean') return v ? '<true/>' : '<false/>';
    if (Array.isArray(v)) return `<array>${v.map(encode).join('')}</array>`;
    return `<dict>${Object.entries(v)
      .map(([k, item]) => `<key>${escapeXml(k)}</key>${encode(item)}`)
      .join('')}</dict>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">${encode(value)}</plist>\n`;
}

export const CPU_ARM64 = 0x0100000c;
export const CPU_X86_64 = 0x01000007;

/**
 * Builds a minimal thin 64-bit Mach-O with one LC_CODE_SIGNATURE load command. The signature is a
 * SuperBlob holding a dummy CodeDirectory and, if given, an entitlements blob with that XML.
 */
export function machO({ entitlements, cputype = CPU_ARM64 }: { entitlements?: string; cputype?: number } = {}): Buffer {
  const blobs: Array<[type: number, blob: Buffer]> = [[0, blob(0xfade0c02, Buffer.alloc(16))]];
  if (entitlements !== undefined) {
    blobs.push([5, blob(0xfade7171, Buffer.from(entitlements))]);
  }
  const indexSize = 12 + blobs.length * 8;
  const index = Buffer.alloc(indexSize);
  let offset = indexSize;
  blobs.forEach(([type, data], i) => {
    index.writeUInt32BE(type, 12 + i * 8);
    index.writeUInt32BE(offset, 16 + i * 8);
    offset += data.length;
  });
  index.writeUInt32BE(0xfade0cc0, 0);
  index.writeUInt32BE(offset, 4);
  index.writeUInt32BE(blobs.length, 8);
  const signature = Buffer.concat([index, ...blobs.map(([, data]) => data)]);

  const header = Buffer.alloc(32 + 16);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(cputype, 4);
  header.writeUInt32LE(2, 12);
  header.writeUInt32LE(1, 16);
  header.writeUInt32LE(16, 20);
  header.writeUInt32LE(0x1d, 32);
  header.writeUInt32LE(16, 36);
  header.writeUInt32LE(header.length + 64, 40);
  header.writeUInt32LE(signature.length, 44);
  return Buffer.concat([header, Buffer.alloc(64), signature]);
}

function blob(magic: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(magic, 0);
  head.writeUInt32BE(8 + payload.length, 4);
  return Buffer.concat([head, payload]);
}

/** Wraps Mach-O slices in a fat (universal) binary, 32-bit or 64-bit fat headers. */
export function fatMachO(slices: Array<{ cputype: number; data: Buffer }>, { wide = false } = {}): Buffer {
  const entrySize = wide ? 32 : 20;
  const header = Buffer.alloc(8 + slices.length * entrySize);
  header.writeUInt32BE(wide ? 0xcafebabf : 0xcafebabe, 0);
  header.writeUInt32BE(slices.length, 4);
  let offset = header.length;
  slices.forEach(({ cputype, data }, i) => {
    const at = 8 + i * entrySize;
    header.writeUInt32BE(cputype, at);
    if (wide) {
      header.writeBigUInt64BE(BigInt(offset), at + 8);
      header.writeBigUInt64BE(BigInt(data.length), at + 16);
    } else {
      header.writeUInt32BE(offset, at + 8);
      header.writeUInt32BE(data.length, at + 12);
    }
    offset += data.length;
  });
  return Buffer.concat([header, ...slices.map((s) => s.data)]);
}

/**
 * Builds a minimal Hermes bytecode file: a 128-byte header, zeroed function headers, string
 * kinds, identifier hashes, the small and overflow string tables and the string storage.
 * Layout checked against real `hermesc` output (bytecode version 98, 12-byte function headers).
 */
export function hbc({
  strings,
  identifiers = [],
  version = 98,
  functionCount = 1,
  functionHeaderSize = 12,
}: {
  strings: string[];
  identifiers?: string[];
  version?: number;
  functionCount?: number;
  functionHeaderSize?: number;
}): Buffer {
  const all = [...strings, ...identifiers];
  const align = (b: Buffer) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const storage: Buffer[] = [];
  const small = Buffer.alloc(all.length * 4);
  const overflow: Buffer[] = [];
  let offset = 0;
  all.forEach((s, i) => {
    const utf16 = /[^\u0000-ÿ]/.test(s);
    const bytes = Buffer.from(s, utf16 ? 'utf16le' : 'latin1');
    let entryOffset = offset;
    let length = s.length;
    if (length >= 255) {
      const o = Buffer.alloc(8);
      o.writeUInt32LE(offset, 0);
      o.writeUInt32LE(length, 4);
      entryOffset = overflow.length;
      length = 255;
      overflow.push(o);
    }
    small.writeUInt32LE((((length << 24) | (entryOffset << 1) | (utf16 ? 1 : 0)) >>> 0), i * 4);
    storage.push(bytes);
    offset += bytes.length;
  });
  const kinds = Buffer.alloc(8);
  kinds.writeUInt32LE(strings.length, 0);
  kinds.writeUInt32LE((0x80000000 | identifiers.length) >>> 0, 4);
  const storageBytes = Buffer.concat(storage);

  const header = Buffer.alloc(128);
  header.writeBigUInt64LE(0x1f1903c103bc1fc6n, 0);
  header.writeUInt32LE(version, 8);
  header.writeUInt32LE(functionCount, 40);
  header.writeUInt32LE(2, 44);
  header.writeUInt32LE(identifiers.length, 48);
  header.writeUInt32LE(all.length, 52);
  header.writeUInt32LE(overflow.length, 56);
  header.writeUInt32LE(storageBytes.length, 60);
  const file = Buffer.concat([
    header,
    align(Buffer.alloc(functionCount * functionHeaderSize)),
    kinds,
    Buffer.alloc(identifiers.length * 4),
    small,
    ...overflow,
    align(storageBytes),
    Buffer.alloc(16),
  ]);
  file.writeUInt32LE(file.length, 32);
  return file;
}

export const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

export interface ProtoAttr {
  name: string;
  /** Source text; aapt2 keeps it for most attributes. */
  value?: string;
  android?: boolean;
  /** Compiled value only, as aapt2 stores some booleans. */
  bool?: boolean;
  /** A resource reference such as @string/host. */
  refId?: number;
  /** Binary XML only: a raw string stored next to a typed value (they can disagree). */
  raw?: string;
  /** Binary XML only: the resource ID written to the resource map for this attribute name. */
  resId?: number;
}

export interface ProtoEl {
  name: string;
  attrs?: ProtoAttr[];
  children?: ProtoEl[];
  text?: string;
}

const varint = (value: number): Buffer => {
  const bytes: number[] = [];
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
  return Buffer.from(bytes);
};
const field = (num: number, payload: Buffer | string): Buffer => {
  const bytes = Buffer.from(payload);
  return Buffer.concat([varint((num << 3) | 2), varint(bytes.length), bytes]);
};
const numberField = (num: number, value: number): Buffer => Buffer.concat([varint(num << 3), varint(value)]);

/** Encodes an element as an aapt2 `XmlNode` protobuf, the format of the manifest in an .aab. */
export function protoXml(el: ProtoEl): Buffer {
  const attr = (a: ProtoAttr): Buffer => {
    const parts = [field(2, a.name)];
    if (a.android) parts.unshift(field(1, ANDROID_NS));
    if (a.value !== undefined) parts.push(field(3, a.value));
    if (a.bool !== undefined) parts.push(field(6, field(7, numberField(8, a.bool ? 1 : 0))));
    if (a.refId !== undefined) parts.push(field(6, field(1, numberField(2, a.refId))));
    return Buffer.concat(parts);
  };
  const element = Buffer.concat([
    field(1, Buffer.concat([field(1, 'android'), field(2, ANDROID_NS)])),
    field(3, el.name),
    ...(el.attrs ?? []).map((a) => field(4, attr(a))),
    ...(el.text ? [field(5, field(2, el.text))] : []),
    ...(el.children ?? []).map((c) => field(5, protoXml(c))),
    numberField(99, 7),
  ]);
  return Buffer.concat([field(1, element), field(3, Buffer.concat([numberField(1, 1)]))]);
}

/** android:* attribute resource IDs, as `aapt2 dump xmltree` shows them for a real release APK. */
export const ANDROID_ATTR_IDS: Record<string, number> = {
  label: 0x01010001,
  name: 0x01010003,
  debuggable: 0x0101000f,
  scheme: 0x01010027,
  host: 0x01010028,
  versionCode: 0x0101021b,
  versionName: 0x0101021c,
  usesCleartextTraffic: 0x010104ec,
  autoVerify: 0x010104ee,
};

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const chunk = (type: number, headerSize: number, header: Buffer, body: Buffer = Buffer.alloc(0)) =>
  Buffer.concat([u16(type), u16(headerSize), u32(8 + header.length + body.length), header, body]);
const NO_INDEX = 0xffffffff;

/**
 * Encodes an element as Android binary XML (the AndroidManifest.xml in an .apk): a string pool (UTF-16 like aapt2,
 * or UTF-8), a resource map for the android: attribute names, namespace and element chunks. `stripNames` blanks the
 * attribute names, as some obfuscators do, leaving only the resource IDs.
 */
export function axml(root: ProtoEl, { utf8 = false, stripNames = false }: { utf8?: boolean; stripNames?: boolean } = {}): Buffer {
  const androidNames: string[] = [];
  const resIds = new Map<string, number>();
  const others: string[] = [ANDROID_NS, 'android'];
  const walk = (el: ProtoEl) => {
    others.push(el.name);
    for (const a of el.attrs ?? []) {
      if (a.android && !androidNames.includes(a.name)) androidNames.push(a.name);
      if (!a.android) others.push(a.name);
      if (a.value !== undefined) others.push(a.value);
      if (a.raw !== undefined) others.push(a.raw);
      if (a.android && a.resId !== undefined) resIds.set(a.name, a.resId);
    }
    el.children?.forEach(walk);
  };
  walk(root);
  const pool = [...androidNames.map((n) => (stripNames ? '' : n)), ...new Set(others)];
  const index = (s: string, android = false) => (android ? androidNames.indexOf(s) : pool.indexOf(s, androidNames.length));

  const encoded = pool.map((s) => {
    if (utf8) {
      const bytes = Buffer.from(s, 'utf8');
      return Buffer.concat([Buffer.from([s.length, bytes.length]), bytes, Buffer.from([0])]);
    }
    return Buffer.concat([u16(s.length), Buffer.from(s, 'utf16le'), u16(0)]);
  });
  const offsets: number[] = [];
  let at = 0;
  for (const e of encoded) {
    offsets.push(at);
    at += e.length;
  }
  const data = Buffer.concat(encoded);
  const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  const stringsStart = 28 + pool.length * 4;
  const poolHeader = Buffer.concat([u32(pool.length), u32(0), u32(utf8 ? 0x100 : 0), u32(stringsStart), u32(0)]);
  const stringPool = chunk(0x0001, 28, poolHeader, Buffer.concat([...offsets.map(u32), padded]));
  const resourceMap = chunk(0x0180, 8, Buffer.concat(androidNames.map((n) => u32(resIds.get(n) ?? ANDROID_ATTR_IDS[n] ?? 0))));

  const nsBody = Buffer.concat([u32(index('android')), u32(index(ANDROID_NS))]);
  const nodeHeader = Buffer.concat([u32(1), u32(NO_INDEX)]);
  const elements: Buffer[] = [];
  const emit = (el: ProtoEl) => {
    const attrs = (el.attrs ?? []).map((a) => {
      const ns = a.android ? index(ANDROID_NS) : NO_INDEX;
      const name = index(a.name, a.android);
      let raw = NO_INDEX;
      let type = 0x03;
      let value = 0;
      if (a.value !== undefined) {
        raw = index(a.value);
        value = raw;
      } else if (a.bool !== undefined) {
        type = 0x12;
        value = a.bool ? 0xffffffff : 0;
      } else if (a.refId !== undefined) {
        type = 0x01;
        value = a.refId;
      }
      if (a.raw !== undefined) raw = index(a.raw);
      return Buffer.concat([u32(ns), u32(name), u32(raw), u16(8), Buffer.from([0, type]), u32(value)]);
    });
    const ext = Buffer.concat([u32(NO_INDEX), u32(index(el.name)), u16(20), u16(20), u16(attrs.length), u16(0), u16(0), u16(0)]);
    elements.push(chunk(0x0102, 16, nodeHeader, Buffer.concat([ext, ...attrs])));
    el.children?.forEach(emit);
    elements.push(chunk(0x0103, 16, nodeHeader, Buffer.concat([u32(NO_INDEX), u32(index(el.name))])));
  };
  emit(root);
  const body = Buffer.concat([
    stringPool,
    resourceMap,
    chunk(0x0100, 16, nodeHeader, nsBody),
    ...elements,
    chunk(0x0101, 16, nodeHeader, nsBody),
  ]);
  return Buffer.concat([u16(0x0003), u16(8), u32(8 + body.length), body]);
}

type Files = Record<string, Uint8Array>;

export interface IpaOptions {
  info?: Record<string, XmlPlistValue>;
  entitlements?: Record<string, XmlPlistValue>;
  bundle?: Buffer | string;
  expoConfig?: unknown;
  extra?: Files;
}

/** Builds a synthetic .ipa: Payload/Demo.app with Info.plist, a signed executable and optional bundle. */
export function ipa({ info = {}, entitlements, bundle, expoConfig, extra = {} }: IpaOptions = {}): Uint8Array {
  const app = 'Payload/Demo.app/';
  const files: Files = {
    [`${app}Info.plist`]: Buffer.from(
      plistXml({ CFBundleIdentifier: 'com.example.demo', CFBundleShortVersionString: '1.4.0', CFBundleVersion: '42', CFBundleExecutable: 'Demo', ...info }),
    ),
    [`${app}Demo`]: machO(entitlements ? { entitlements: plistXml(entitlements) } : {}),
    ...extra,
  };
  if (bundle !== undefined) files[`${app}main.jsbundle`] = Buffer.from(bundle);
  if (expoConfig !== undefined) files[`${app}EXConstants.bundle/app.config`] = Buffer.from(JSON.stringify(expoConfig));
  return zipSync(files);
}

export interface AabOptions {
  manifest?: ProtoEl;
  bundle?: Buffer | string;
  expoConfig?: unknown;
  extra?: Files;
}

export const androidManifest = (application: ProtoAttr[] = [], children: ProtoEl[] = []): ProtoEl => ({
  name: 'manifest',
  attrs: [
    { name: 'package', value: 'com.example.demo' },
    { name: 'versionName', android: true, value: '1.4.0' },
    { name: 'versionCode', android: true, value: '42' },
  ],
  children: [{ name: 'application', attrs: application, children }],
});

/** Builds a synthetic .aab: base/manifest (protobuf), base/assets bundle and Expo config. */
export function aab({ manifest = androidManifest(), bundle, expoConfig, extra = {} }: AabOptions = {}): Uint8Array {
  const files: Files = { 'base/manifest/AndroidManifest.xml': protoXml(manifest), 'BundleConfig.pb': new Uint8Array(0), ...extra };
  if (bundle !== undefined) files['base/assets/index.android.bundle'] = Buffer.from(bundle);
  if (expoConfig !== undefined) files['base/assets/app.config'] = Buffer.from(JSON.stringify(expoConfig));
  return zipSync(files);
}

/** Builds a synthetic .apk: binary XML manifest at the root, bundle and Expo config under assets/. */
export function apk({ manifest = androidManifest(), bundle, expoConfig, extra = {} }: AabOptions = {}): Uint8Array {
  const files: Files = { 'AndroidManifest.xml': axml(manifest), 'classes.dex': new Uint8Array(0), ...extra };
  if (bundle !== undefined) files['assets/index.android.bundle'] = Buffer.from(bundle);
  if (expoConfig !== undefined) files['assets/app.config'] = Buffer.from(JSON.stringify(expoConfig));
  return zipSync(files);
}

/**
 * Rewrites a plain zip so its end-of-central-directory goes through a zip64 record and
 * locator, as large archives do. Central directory entries keep their 32-bit values.
 */
export function toZip64(zip: Uint8Array): Buffer {
  const buf = Buffer.from(zip);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeUInt16LE(45, 12);
  record.writeUInt16LE(45, 14);
  record.writeBigUInt64LE(BigInt(entries), 24);
  record.writeBigUInt64LE(BigInt(entries), 32);
  record.writeBigUInt64LE(BigInt(cdSize), 40);
  record.writeBigUInt64LE(BigInt(cdOffset), 48);

  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(eocd), 8);
  locator.writeUInt32LE(1, 16);

  const end = Buffer.from(buf.subarray(eocd));
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);

  return Buffer.concat([buf.subarray(0, eocd), record, locator, end]);
}
