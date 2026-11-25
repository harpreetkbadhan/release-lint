import { describe, expect, it } from 'vitest';
import { parseProtoXml } from '../src/formats/proto.js';
import { ReleaseLintError } from '../src/types.js';
import { protoXml, type ProtoAttr } from './helpers/fixtures.js';

const manifest = protoXml({
  name: 'manifest',
  attrs: [{ name: 'package', value: 'com.example.demo' }, { name: 'versionName', android: true, value: '1.4.0' }],
  children: [
    { name: 'uses-permission', attrs: [{ name: 'name', android: true, value: 'android.permission.CAMERA' }] },
    {
      name: 'application',
      attrs: [
        { name: 'debuggable', android: true, value: 'true', bool: true },
        { name: 'usesCleartextTraffic', android: true, bool: true },
        { name: 'label', android: true, refId: 0x7f120001 },
      ],
      text: '\n    ',
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
});

describe('parseProtoXml', () => {
  it('reads elements, attributes and children of an aapt2 proto manifest', () => {
    const root = parseProtoXml(manifest);
    expect(root.name).toBe('manifest');
    expect(root.attributes).toEqual({ package: 'com.example.demo', 'android:versionName': '1.4.0' });
    expect(root.children.map((c) => c.name)).toEqual(['uses-permission', 'application']);

    const application = root.children[1];
    expect(application?.attributes).toEqual({
      'android:debuggable': 'true',
      'android:usesCleartextTraffic': 'true',
      'android:label': '@0x7f120001',
    });
    const filter = application?.children[0]?.children[0];
    expect(filter?.attributes).toEqual({ 'android:autoVerify': 'true' });
    expect(filter?.children[0]?.attributes).toEqual({ 'android:scheme': 'https', 'android:host': 'staging.example.com' });
  });

  it('rejects a truncated message', () => {
    expect(() => parseProtoXml(manifest.subarray(0, manifest.length - 40))).toThrow(ReleaseLintError);
  });

  it('rejects a buffer without a root element', () => {
    expect(() => parseProtoXml(Buffer.alloc(0))).toThrow(ReleaseLintError);
  });

  describe('hostile manifests (same rules as .apk)', () => {
    const app = (attrs: ProtoAttr[]) => protoXml({ name: 'manifest', children: [{ name: 'application', attrs }] });

    it('rejects an attribute without a namespace that is named like an android one', () => {
      expect(() => parseProtoXml(app([{ name: 'debuggable', android: true, bool: true }, { name: 'android:debuggable', value: 'false' }]))).toThrow(ReleaseLintError);
    });

    it('rejects the same attribute twice', () => {
      expect(() => parseProtoXml(app([{ name: 'debuggable', android: true, bool: true }, { name: 'debuggable', android: true, bool: false }]))).toThrow(ReleaseLintError);
    });

    it('uses the compiled value, like Android, when the source text disagrees', () => {
      const root = parseProtoXml(app([{ name: 'debuggable', android: true, value: 'false', bool: true }]));
      expect(root.children[0]?.attributes['android:debuggable']).toBe('true');
    });
  });

  it('rejects nesting deeper than the limit', () => {
    let el = { name: 'leaf' } as { name: string; children?: unknown[] };
    for (let i = 0; i < 200; i++) el = { name: 'n', children: [el] };
    expect(() => parseProtoXml(protoXml(el as Parameters<typeof protoXml>[0]))).toThrow(/deep/);
  });
});
