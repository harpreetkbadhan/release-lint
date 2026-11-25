import { describe, expect, it } from 'vitest';
import { parseAxml } from '../src/formats/axml.js';
import { ReleaseLintError } from '../src/types.js';
import { axml, type ProtoAttr, type ProtoEl } from './helpers/fixtures.js';

const MANIFEST: ProtoEl = {
  name: 'manifest',
  attrs: [
    { name: 'versionCode', android: true, value: '42' },
    { name: 'versionName', android: true, value: '1.4.0' },
    { name: 'package', value: 'com.example.demo' },
  ],
  children: [
    { name: 'uses-permission', attrs: [{ name: 'name', android: true, value: 'android.permission.CAMERA' }] },
    {
      name: 'application',
      attrs: [
        { name: 'debuggable', android: true, bool: true },
        { name: 'usesCleartextTraffic', android: true, bool: false },
        { name: 'label', android: true, refId: 0x7f120001 },
      ],
      children: [
        {
          name: 'activity',
          children: [
            {
              name: 'intent-filter',
              attrs: [{ name: 'autoVerify', android: true, bool: true }],
              children: [
                { name: 'data', attrs: [{ name: 'scheme', android: true, value: 'https' }, { name: 'host', android: true, value: 'staging.example.com' }] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const expectManifest = (root: ReturnType<typeof parseAxml>) => {
  expect(root.name).toBe('manifest');
  expect(root.attributes).toEqual({ 'android:versionCode': '42', 'android:versionName': '1.4.0', package: 'com.example.demo' });
  expect(root.children.map((c) => c.name)).toEqual(['uses-permission', 'application']);
  const application = root.children[1];
  expect(application?.attributes).toEqual({
    'android:debuggable': 'true',
    'android:usesCleartextTraffic': 'false',
    'android:label': '@0x7f120001',
  });
  const filter = application?.children[0]?.children[0];
  expect(filter?.attributes).toEqual({ 'android:autoVerify': 'true' });
  expect(filter?.children[0]?.attributes).toEqual({ 'android:scheme': 'https', 'android:host': 'staging.example.com' });
};

describe('parseAxml', () => {
  it('reads a binary manifest with a UTF-16 string pool (what aapt2 writes)', () => {
    expectManifest(parseAxml(axml(MANIFEST)));
  });

  it('reads a binary manifest with a UTF-8 string pool', () => {
    expectManifest(parseAxml(axml(MANIFEST, { utf8: true })));
  });

  it('names android attributes from the resource map when their names were stripped', () => {
    expectManifest(parseAxml(axml(MANIFEST, { stripNames: true })));
  });

  it('does not let a "__proto__" attribute change the prototype', () => {
    const root = parseAxml(axml({ name: 'manifest', attrs: [{ name: '__proto__', value: 'x' }] }));
    expect(Object.getPrototypeOf(root.attributes)).toBe(null);
    expect(root.attributes['__proto__']).toBe('x');
  });

  it('rejects a text XML file', () => {
    expect(() => parseAxml(Buffer.from('<?xml version="1.0"?><manifest/>'))).toThrow(ReleaseLintError);
  });

  it('rejects a truncated manifest', () => {
    const buf = axml(MANIFEST);
    expect(() => parseAxml(buf.subarray(0, buf.length - 30))).toThrow(ReleaseLintError);
  });

  it('rejects a string pool that claims more strings than fit', () => {
    const buf = Buffer.from(axml(MANIFEST));
    buf.writeUInt32LE(0x7fffffff, 8 + 8); // string count of the first chunk (the pool)
    expect(() => parseAxml(buf)).toThrow(ReleaseLintError);
  });

  describe('hostile manifests (security review)', () => {
    const splitChunks = (buf: Buffer) => {
      const out: Buffer[] = [];
      for (let p = buf.readUInt16LE(2); p < buf.length; p += buf.readUInt32LE(p + 4)) out.push(Buffer.from(buf.subarray(p, p + buf.readUInt32LE(p + 4))));
      return out;
    };
    const joinChunks = (chunks: Buffer[]) => {
      const body = Buffer.concat(chunks);
      const head = Buffer.alloc(8);
      head.writeUInt16LE(0x0003, 0);
      head.writeUInt16LE(8, 2);
      head.writeUInt32LE(8 + body.length, 4);
      return Buffer.concat([head, body]);
    };
    const app = (attrs: ProtoAttr[]): ProtoEl => ({ name: 'manifest', children: [{ name: 'application', attrs }] });
    const debuggable = (root: ReturnType<typeof parseAxml>) => root.children[0]?.attributes['android:debuggable'];

    it('stays fast when a million string entries point at one huge string', () => {
      const units = 1_000_000;
      const count = 200_000;
      const str = Buffer.alloc(4 + units * 2 + 2, 0x61);
      str.writeUInt16LE(0x8000 | (units >>> 16), 0);
      str.writeUInt16LE(units & 0xffff, 2);
      str.writeUInt16LE(0, 4 + units * 2);
      const header = Buffer.alloc(28);
      header.writeUInt16LE(0x0001, 0);
      header.writeUInt16LE(28, 2);
      header.writeUInt32LE(28 + count * 4 + str.length, 4);
      header.writeUInt32LE(count, 8);
      header.writeUInt32LE(28 + count * 4, 20);
      const pool = Buffer.concat([header, Buffer.alloc(count * 4), str]);
      const [, ...rest] = splitChunks(axml({ name: 'manifest' }));
      const start = performance.now();
      expect(() => parseAxml(joinChunks([pool, ...rest]))).toThrow(ReleaseLintError);
      expect(performance.now() - start).toBeLessThan(1_000);
    });

    it('rejects an attribute without a namespace that is named like an android one', () => {
      const buf = axml(app([{ name: 'debuggable', android: true, bool: true }, { name: 'android:debuggable', value: 'false' }]));
      expect(() => parseAxml(buf)).toThrow(ReleaseLintError);
    });

    it('rejects the same attribute twice', () => {
      const buf = axml(app([{ name: 'debuggable', android: true, bool: true }, { name: 'debuggable', android: true, bool: false }]));
      expect(() => parseAxml(buf)).toThrow(ReleaseLintError);
    });

    it('uses the typed value, like Android, when a raw string disagrees', () => {
      expect(debuggable(parseAxml(axml(app([{ name: 'debuggable', android: true, bool: true, raw: 'false' }]))))).toBe('true');
    });

    it('names an attribute by its resource ID, like Android, whatever its name string says', () => {
      const buf = axml(app([{ name: 'xdebuggable', android: true, bool: true, resId: 0x0101000f }]));
      expect(debuggable(parseAxml(buf))).toBe('true');
    });

    it('rejects a second string pool after the first element', () => {
      const chunks = splitChunks(axml(app([{ name: 'debuggable', android: true, bool: true }])));
      chunks.splice(4, 0, Buffer.from(chunks[0] ?? Buffer.alloc(0)));
      expect(() => parseAxml(joinChunks(chunks))).toThrow(ReleaseLintError);
    });

    it('rejects an element after the root element closed', () => {
      const chunks = splitChunks(axml(app([{ name: 'debuggable', android: true, bool: true }])));
      chunks.splice(4, 0, Buffer.from(chunks[chunks.length - 2] ?? Buffer.alloc(0))); // close <manifest> early
      expect(() => parseAxml(joinChunks(chunks))).toThrow(ReleaseLintError);
    });

    it('rejects an attribute size that would re-read the same bytes', () => {
      const chunks = splitChunks(axml(app([{ name: 'debuggable', android: true, bool: true }])));
      chunks[4]?.writeUInt16LE(0, 16 + 10); // <application> attribute size
      expect(() => parseAxml(joinChunks(chunks))).toThrow(ReleaseLintError);
    });

    it('rejects a root element other than <manifest>', () => {
      expect(() => parseAxml(axml({ name: 'resources' }))).toThrow(ReleaseLintError);
    });
  });

  it('rejects nesting deeper than the limit', () => {
    let el: ProtoEl = { name: 'leaf' };
    for (let i = 0; i < 200; i++) el = { name: 'n', children: [el] };
    expect(() => parseAxml(axml(el))).toThrow(/deep/);
  });
});
