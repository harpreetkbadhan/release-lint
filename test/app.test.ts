import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readApp } from '../src/formats/app.js';
import { ReleaseLintError } from '../src/types.js';
import { aab, androidManifest, apk, hbc, ipa, writeTemp } from './helpers/fixtures.js';

const text = (value: string) => Buffer.from(value);
const DOMAINS = 'com.apple.developer.associated-domains';

describe('readApp (.ipa)', () => {
  it('builds the app model from Info.plist, entitlements, bundle, Expo config and source maps', async () => {
    const path = await writeTemp(
      'demo.ipa',
      ipa({
        info: { NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } },
        entitlements: {
          'get-task-allow': false,
          [DOMAINS]: ['applinks:example.com', 'applinks:staging.example.com?mode=developer', 'webcredentials:example.com'],
        },
        bundle: hbc({ strings: ['https://api.staging.example.com'], identifiers: ['x'] }),
        expoConfig: { name: 'Demo', extra: { apiUrl: 'http://localhost:3000' } },
        extra: { 'Payload/Demo.app/main.jsbundle.map': text('{}') },
      }),
    );
    expect(await readApp(path)).toEqual({
      platform: 'ios',
      file: 'demo.ipa',
      appId: 'com.example.demo',
      version: '1.4.0',
      build: '42',
      flags: { allowsArbitraryLoads: true, debuggable: false },
      deepLinks: [
        { host: 'example.com', kind: 'applinks', file: 'Payload/Demo.app/Demo' },
        { host: 'staging.example.com', kind: 'applinks', file: 'Payload/Demo.app/Demo' },
        { host: 'example.com', kind: 'webcredentials', file: 'Payload/Demo.app/Demo' },
      ],
      bundle: {
        file: 'Payload/Demo.app/main.jsbundle',
        kind: 'hermes',
        hermesVersion: 98,
        approximate: false,
        strings: ['https://api.staging.example.com', 'x'],
      },
      expoConfig: { file: 'Payload/Demo.app/EXConstants.bundle/app.config', value: { name: 'Demo', extra: { apiUrl: 'http://localhost:3000' } } },
      sourceMaps: ['Payload/Demo.app/main.jsbundle.map'],
      problems: [],
    });
  });

  it('reads a plain JavaScript bundle and an unsigned executable', async () => {
    const model = await readApp(await writeTemp('demo.ipa', ipa({ bundle: 'var __DEV__=false;' })));
    expect(model.bundle).toEqual({ file: 'Payload/Demo.app/main.jsbundle', kind: 'javascript', approximate: false, strings: ['var __DEV__=false;'] });
    expect(model.deepLinks).toEqual([]);
    expect(model.flags).toEqual({});
  });

  it('records an unreadable executable or Expo config as a problem and keeps going', async () => {
    const path = await writeTemp('demo.ipa', ipa({ extra: { 'Payload/Demo.app/Demo': text('not mach-o'), 'Payload/Demo.app/EXConstants.bundle/app.config': text('{oops') } }));
    const model = await readApp(path);
    expect(model.appId).toBe('com.example.demo');
    expect(model.problems).toHaveLength(2);
    expect(model.problems[0]).toMatch(/Payload\/Demo\.app\/Demo/);
    expect(model.problems[1]).toMatch(/app\.config/);
  });
});

describe('readApp (hostile Expo config)', () => {
  const STRIPE_LIVE = 'sk_' + 'live_' + '4eC39HqLyjWDarjtT1zdp7dc';
  const configProblem = async (config: string) => {
    const path = await writeTemp('demo.ipa', ipa({ extra: { 'Payload/Demo.app/EXConstants.bundle/app.config': text(config) } }));
    return (await readApp(path)).problems;
  };

  it('does not quote the file in a JSON error, which could hold a secret', async () => {
    const problems = await configProblem(`${STRIPE_LIVE} not json`);
    expect(problems).toEqual(['Payload/Demo.app/EXConstants.bundle/app.config: invalid JSON']);
  });

  it('refuses a config nested too deep to scan safely', async () => {
    expect(await configProblem(`${'['.repeat(10_000)}${']'.repeat(10_000)}`)).toEqual([expect.stringMatching(/nested deeper than 64/)]);
  });

  it('accepts a config with a UTF-8 byte order mark', async () => {
    const path = await writeTemp('demo.ipa', ipa({ extra: { 'Payload/Demo.app/EXConstants.bundle/app.config': text('﻿{"extra":{}}') } }));
    expect((await readApp(path)).expoConfig?.value).toEqual({ extra: {} });
  });
});

describe('readApp (.aab)', () => {
  it('builds the app model from the protobuf manifest, bundle and Expo config', async () => {
    const manifest = androidManifest(
      [
        { name: 'debuggable', android: true, value: 'true' },
        { name: 'usesCleartextTraffic', android: true, bool: true },
      ],
      [
        {
          name: 'activity',
          children: [
            {
              name: 'intent-filter',
              attrs: [{ name: 'autoVerify', android: true, bool: true }],
              children: [{ name: 'data', attrs: [{ name: 'scheme', android: true, value: 'https' }, { name: 'host', android: true, value: 'staging.example.com' }] }],
            },
            { name: 'intent-filter', children: [{ name: 'data', attrs: [{ name: 'host', android: true, refId: 0x7f120001 }] }] },
          ],
        },
      ],
    );
    const path = await writeTemp('demo.aab', aab({ manifest, bundle: 'console.log(1)\n//# sourceMappingURL=index.map', expoConfig: { extra: {} } }));
    expect(await readApp(path)).toEqual({
      platform: 'android',
      file: 'demo.aab',
      appId: 'com.example.demo',
      version: '1.4.0',
      build: '42',
      flags: { debuggable: true, usesCleartextTraffic: true },
      deepLinks: [
        { host: 'staging.example.com', kind: 'app-link', file: 'base/manifest/AndroidManifest.xml' },
        { host: '@0x7f120001', kind: 'intent-filter', file: 'base/manifest/AndroidManifest.xml' },
      ],
      bundle: { file: 'base/assets/index.android.bundle', kind: 'javascript', approximate: false, strings: ['console.log(1)\n//# sourceMappingURL=index.map'] },
      expoConfig: { file: 'base/assets/app.config', value: { extra: {} } },
      sourceMaps: [],
      problems: [],
    });
  });

  it('does not count the R8 mapping in BUNDLE-METADATA as a shipped source map', async () => {
    const extra = {
      'BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map': text('# mapping'),
      'base/assets/index.android.bundle.map': text('{}'),
    };
    expect((await readApp(await writeTemp('demo.aab', aab({ extra })))).sourceMaps).toEqual(['base/assets/index.android.bundle.map']);
  });

  it('reports release flags as false when they are explicitly off', async () => {
    const manifest = androidManifest([{ name: 'debuggable', android: true, bool: false }]);
    const model = await readApp(await writeTemp('demo.aab', aab({ manifest })));
    expect(model.flags).toEqual({ debuggable: false });
    expect(model.bundle).toBeUndefined();
  });
});

describe('readApp (.apk)', () => {
  it('builds the app model from the binary XML manifest, bundle and Expo config', async () => {
    const manifest = androidManifest(
      [
        { name: 'debuggable', android: true, bool: true },
        { name: 'usesCleartextTraffic', android: true, bool: false },
      ],
      [
        {
          name: 'activity',
          children: [
            {
              name: 'intent-filter',
              attrs: [{ name: 'autoVerify', android: true, bool: true }],
              children: [{ name: 'data', attrs: [{ name: 'scheme', android: true, value: 'https' }, { name: 'host', android: true, value: 'staging.example.com' }] }],
            },
          ],
        },
      ],
    );
    const path = await writeTemp(
      'demo.apk',
      apk({ manifest, bundle: hbc({ strings: ['https://api.example.com'], identifiers: ['x'] }), expoConfig: { extra: {} }, extra: { 'assets/index.android.bundle.map': text('{}') } }),
    );
    expect(await readApp(path)).toEqual({
      platform: 'android',
      file: 'demo.apk',
      appId: 'com.example.demo',
      version: '1.4.0',
      build: '42',
      flags: { debuggable: true, usesCleartextTraffic: false },
      deepLinks: [{ host: 'staging.example.com', kind: 'app-link', file: 'AndroidManifest.xml' }],
      bundle: { file: 'assets/index.android.bundle', kind: 'hermes', hermesVersion: 98, approximate: false, strings: ['https://api.example.com', 'x'] },
      expoConfig: { file: 'assets/app.config', value: { extra: {} } },
      sourceMaps: ['assets/index.android.bundle.map'],
      problems: [],
    });
  });
});

describe('readApp (unsupported files)', () => {
  it('rejects an .apk whose manifest is not binary XML', async () => {
    const path = await writeTemp('demo.apk', zipSync({ 'AndroidManifest.xml': text('<manifest/>'), 'classes.dex': text('x') }));
    await expect(readApp(path)).rejects.toThrow(/binary XML/);
  });

  it('rejects a zip that is not an app', async () => {
    await expect(readApp(await writeTemp('a.zip', zipSync({ 'readme.txt': text('hi') })))).rejects.toThrow(ReleaseLintError);
  });

  it('rejects an .ipa without Info.plist', async () => {
    await expect(readApp(await writeTemp('a.ipa', zipSync({ 'Payload/Demo.app/Demo': text('x') })))).rejects.toThrow(/Info\.plist/);
  });
});
