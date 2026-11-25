import type { AppModel, DeepLink, XmlElement } from '../types.js';
import { parseAxml } from './axml.js';
import { MAX_BUNDLE_BYTES, MAX_CONFIG_BYTES, readBundle, readExpoConfig, readOptional, sourceMaps } from './common.js';
import { parseProtoXml } from './proto.js';
import type { ZipArchive } from './zip.js';

/** Where an Android package keeps its manifest and assets, and how its manifest is encoded. */
interface Layout {
  manifest: string;
  assets: string;
  parseManifest: (buf: Buffer) => XmlElement;
}

/** .aab: protobuf manifest, everything under base/. */
export const AAB_MANIFEST = 'base/manifest/AndroidManifest.xml';
const AAB: Layout = { manifest: AAB_MANIFEST, assets: 'base/assets/', parseManifest: parseProtoXml };

/** .apk: binary XML manifest at the root. */
export const APK_MANIFEST = 'AndroidManifest.xml';
const APK: Layout = { manifest: APK_MANIFEST, assets: 'assets/', parseManifest: parseAxml };

const descendants = (el: XmlElement, name: string): XmlElement[] =>
  el.children.flatMap((child) => [...(child.name === name ? [child] : []), ...descendants(child, name)]);

/** Reads an .aab (Android App Bundle) into the app model. */
export const readAab = (zip: ZipArchive, file: string) => readAndroid(zip, file, AAB);

/** Reads an .apk into the app model. */
export const readApk = (zip: ZipArchive, file: string) => readAndroid(zip, file, APK);

async function readAndroid(zip: ZipArchive, file: string, layout: Layout): Promise<AppModel> {
  const manifest = layout.parseManifest(await zip.read(layout.manifest, MAX_CONFIG_BYTES));
  const application = manifest.children.find((child) => child.name === 'application');
  const flag = (name: string): boolean | undefined => {
    const value = application?.attributes[`android:${name}`];
    return value === 'true' ? true : value === 'false' ? false : undefined;
  };
  const debuggable = flag('debuggable');
  const usesCleartextTraffic = flag('usesCleartextTraffic');

  const problems: string[] = [];
  const bundleName = `${layout.assets}index.android.bundle`;
  const bundle = await readOptional(zip, bundleName, problems, (buf) => readBundle(bundleName, buf), MAX_BUNDLE_BYTES);
  const configName = `${layout.assets}app.config`;
  const expoConfig = await readOptional(zip, configName, problems, (buf) => readExpoConfig(configName, buf), MAX_CONFIG_BYTES);

  return {
    platform: 'android',
    file,
    appId: manifest.attributes['package'] ?? '',
    version: manifest.attributes['android:versionName'] ?? '',
    build: manifest.attributes['android:versionCode'] ?? '',
    flags: {
      ...(debuggable !== undefined ? { debuggable } : {}),
      ...(usesCleartextTraffic !== undefined ? { usesCleartextTraffic } : {}),
    },
    deepLinks: application ? intentFilterHosts(application, layout.manifest) : [],
    ...(bundle ? { bundle } : {}),
    ...(expoConfig ? { expoConfig } : {}),
    sourceMaps: sourceMaps(zip),
    problems,
  };
}

/** Hosts of every intent filter; `app-link` when the filter has `android:autoVerify="true"`. */
function intentFilterHosts(application: XmlElement, file: string): DeepLink[] {
  return descendants(application, 'intent-filter').flatMap((filter) => {
    const kind = filter.attributes['android:autoVerify'] === 'true' ? 'app-link' : 'intent-filter';
    return descendants(filter, 'data')
      .map((data) => data.attributes['android:host'])
      .filter((host): host is string => Boolean(host))
      .map((host) => ({ host, kind, file }));
  });
}
