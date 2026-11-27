import { describe, expect, it } from 'vitest';
import { readApp } from '../src/formats/app.js';
import { parseResourcesArsc, parseResourcesPb } from '../src/formats/resources.js';
import { runRules } from '../src/rules.js';
import { aab, androidManifest, apk, writeTemp } from './helpers/fixtures.js';

// Synthetic resource tables only: no real .apk/.aab is used here.
// The resource id under test is 0x7f120034 (package 0x7f, string
// type 0x12, entry 0x34), as in the issue.
const HOST_ID = 0x7f120034;
const HOST_ENTRY = 0x34;
const STRING_TYPE_ID = 0x12;

function manifestWithHostRef(refId: number) {
  return androidManifest([], [
    {
      name: 'activity',
      attrs: [{ name: 'name', android: true, value: 'com.example.MainActivity' }],
      children: [
        {
          name: 'intent-filter',
          children: [
            { name: 'action', attrs: [{ name: 'name', android: true, value: 'android.intent.action.VIEW' }] },
            { name: 'category', attrs: [{ name: 'name', android: true, value: 'android.intent.category.BROWSABLE' }] },
            {
              name: 'data',
              attrs: [
                { name: 'scheme', android: true, value: 'https' },
                { name: 'host', android: true, refId },
              ],
            },
          ],
        },
      ],
    },
  ]);
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function chunk(type: number, headerSize: number, body: Buffer): Buffer {
  return Buffer.concat([u16(type), u16(headerSize), u32(8 + body.length), body]);
}

/** A minimal UTF-8 string pool, in the layout resources.arsc uses. */
function buildStringPool(strings: string[]): Buffer {
  const offsets: number[] = [];
  const parts: Buffer[] = [];
  let offset = 0;
  for (const value of strings) {
    offsets.push(offset);
    const bytes = Buffer.from(value, 'utf8');
    const data = Buffer.concat([Buffer.from([value.length, bytes.length]), bytes, Buffer.from([0])]);
    parts.push(data);
    offset += data.length;
  }
  const stringsStart = 28 + strings.length * 4;
  const header = Buffer.concat([
    u16(0x0001),
    u16(28),
    u32(28 + strings.length * 4 + offset),
    u32(strings.length),
    u32(0),
    u32(0x100),
    u32(stringsStart),
    u32(0),
  ]);
  return Buffer.concat([header, ...offsets.map(u32), ...parts]);
}

/**
 * A minimal resources.arsc holding one string resource (entry 0x34 of
 * the string type). `nonDefaultValue`, when given, is stored under a
 * non-default configuration and must lose to the default value.
 */
function buildArsc(defaultValue: string, nonDefaultValue?: string): Buffer {
  const values = nonDefaultValue === undefined ? [defaultValue] : [defaultValue, nonDefaultValue];
  const globalPool = buildStringPool(values);
  const typeNames = Array.from({ length: STRING_TYPE_ID }, (_, i) => (i === STRING_TYPE_ID - 1 ? 'string' : `type${i + 1}`));
  const typePool = buildStringPool(typeNames);
  const keyPool = buildStringPool(['app_link_host']);
  const entryCount = HOST_ENTRY + 1;
  const typeSpec = chunk(
    0x0202,
    16,
    Buffer.concat([Buffer.from([STRING_TYPE_ID, 0]), u16(0), u32(entryCount), Buffer.alloc(entryCount * 4)]),
  );
  const buildTypeChunk = (value: string, isDefault: boolean): Buffer => {
    // Entry offsets are relative to the start of the entries array,
    // so the single entry sits after the offset table itself.
    const entryOffsets = Buffer.alloc(entryCount * 4, 0xff);
    entryOffsets.writeUInt32LE(entryCount * 4, HOST_ENTRY * 4);
    const config = isDefault ? u32(4) : Buffer.concat([u32(8), u32(1)]);
    const entry = Buffer.concat([
      u16(8),
      u16(0),
      u32(0),
      u16(8),
      Buffer.from([0, 0x03]),
      u32(values.indexOf(value)),
    ]);
    return chunk(
      0x0201,
      20,
      Buffer.concat([
        Buffer.from([STRING_TYPE_ID, 0]),
        u16(0),
        u32(entryCount),
        u32(20 + config.length),
        config,
        entryOffsets,
        entry,
      ]),
    );
  };
  const typeChunks = [buildTypeChunk(defaultValue, true)];
  if (nonDefaultValue !== undefined) {
    typeChunks.unshift(buildTypeChunk(nonDefaultValue, false));
  }
  const packageBody = Buffer.concat([
    u32(0x7f),
    Buffer.alloc(256),
    u32(292),
    u32(0),
    u32(292 + typePool.length),
    u32(0),
    u32(0),
    u32(0),
    typePool,
    keyPool,
    typeSpec,
    ...typeChunks,
  ]);
  const packageChunk = chunk(0x0200, 292, packageBody);
  const header = Buffer.concat([u16(0x0002), u16(12), u32(12 + globalPool.length + packageChunk.length), u32(1)]);
  return Buffer.concat([header, globalPool, packageChunk]);
}

// --- base/resources.pb (aapt2 ResourceTable protobuf) ---------------------

function pbVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

function pbFieldVarint(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([pbVarint((fieldNumber << 3) | 0), pbVarint(value)]);
}

function pbFieldBytes(fieldNumber: number, data: Buffer): Buffer {
  return Buffer.concat([pbVarint((fieldNumber << 3) | 2), pbVarint(data.length), data]);
}

function pbFieldString(fieldNumber: number, value: string): Buffer {
  return pbFieldBytes(fieldNumber, Buffer.from(value, 'utf8'));
}

function buildResourcesPb(values: Array<{ value: string; isDefault: boolean }>): Buffer {
  const configValues = values.map(({ value, isDefault }) => {
    const config = isDefault ? Buffer.alloc(0) : pbFieldVarint(1, 1);
    const stringMessage = pbFieldString(1, value);
    const item = pbFieldBytes(2, stringMessage);
    const valueMessage = pbFieldBytes(1, item);
    return Buffer.concat([pbFieldBytes(1, config), pbFieldBytes(2, valueMessage)]);
  });
  const entry = Buffer.concat([
    pbFieldVarint(1, HOST_ENTRY),
    pbFieldString(2, 'app_link_host'),
    ...configValues.map((configValue) => pbFieldBytes(6, configValue)),
  ]);
  const type = Buffer.concat([
    pbFieldVarint(1, STRING_TYPE_ID),
    pbFieldString(2, 'string'),
    pbFieldBytes(3, entry),
  ]);
  const packageMessage = Buffer.concat([
    pbFieldVarint(1, 0x7f),
    pbFieldString(2, 'com.example.demo'),
    pbFieldBytes(3, type),
  ]);
  return pbFieldBytes(1, packageMessage);
}

describe('deep link hosts written as resource references', () => {
  it('parses resources.arsc and base/resources.pb directly', () => {
    expect(parseResourcesArsc(buildArsc('staging.example.com')).get(HOST_ID)).toBe('staging.example.com');
    expect(parseResourcesPb(buildResourcesPb([{ value: 'staging.example.com', isDefault: true }])).get(HOST_ID)).toBe(
      'staging.example.com',
    );
  });

  it('resolves a staging host from resources.arsc in an APK', async () => {
    const file = await writeTemp(
      'demo.apk',
      await apk({ manifest: manifestWithHostRef(HOST_ID), extra: { 'resources.arsc': buildArsc('staging.example.com') } }),
    );
    const app = await readApp(file);
    expect(app.deepLinks).toEqual([{ host: 'staging.example.com', kind: 'intent-filter', file: 'AndroidManifest.xml' }]);
    expect(runRules(app, { allowHosts: [] }).map((finding) => finding.ruleId)).toContain('deeplink/non-production-host');
  });

  it('prefers the default configuration over a non-default one in resources.arsc', async () => {
    const file = await writeTemp(
      'demo.apk',
      await apk({
        manifest: manifestWithHostRef(HOST_ID),
        extra: { 'resources.arsc': buildArsc('staging.example.com', 'prod.example.com') },
      }),
    );
    const app = await readApp(file);
    expect(app.deepLinks).toEqual([{ host: 'staging.example.com', kind: 'intent-filter', file: 'AndroidManifest.xml' }]);
  });

  it('resolves a staging host from base/resources.pb in an AAB', async () => {
    const file = await writeTemp(
      'demo.aab',
      await aab({
        manifest: manifestWithHostRef(HOST_ID),
        extra: { 'base/resources.pb': buildResourcesPb([{ value: 'staging.example.com', isDefault: true }]) },
      }),
    );
    const app = await readApp(file);
    expect(app.deepLinks).toEqual([{ host: 'staging.example.com', kind: 'intent-filter', file: 'AndroidManifest.xml' }]);
    expect(runRules(app, { allowHosts: [] }).map((finding) => finding.ruleId)).toContain('deeplink/non-production-host');
  });

  it('prefers the default configuration over a non-default one in base/resources.pb', () => {
    const table = parseResourcesPb(
      buildResourcesPb([
        { value: 'prod.example.com', isDefault: false },
        { value: 'staging.example.com', isDefault: true },
      ]),
    );
    expect(table.get(HOST_ID)).toBe('staging.example.com');
  });

  it('keeps deeplink/unresolved-host when the resource cannot be resolved', async () => {
    const file = await writeTemp('demo.apk', await apk({ manifest: manifestWithHostRef(0x7f120099) }));
    const app = await readApp(file);
    expect(app.deepLinks).toEqual([{ host: '@0x7f120099', kind: 'intent-filter', file: 'AndroidManifest.xml' }]);
    expect(runRules(app, { allowHosts: [] }).map((finding) => finding.ruleId)).toContain('deeplink/unresolved-host');
  });
});
