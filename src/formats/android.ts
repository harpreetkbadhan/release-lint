import type { AppModel, DeepLink, NetworkException, XmlElement } from '../types.js';
import { parseAxml } from './axml.js';
import { MAX_BUNDLE_BYTES, MAX_CONFIG_BYTES, readBundle, readExpoConfig, readOptional, sourceMaps } from './common.js';
import { parseProtoXml } from './proto.js';
import { parseResourcesArsc, parseResourcesPb } from './resources.js';
import type { ZipArchive } from './zip.js';

const NETWORK_CONFIG_ROOT = 'network-security-config';
/** Only files containing the root element's name are parsed: UTF-8 (protobuf, UTF-8 pools) or UTF-16 (aapt2's default pool). */
const NETWORK_CONFIG_MARKERS = [Buffer.from(NETWORK_CONFIG_ROOT, 'utf8'), Buffer.from(NETWORK_CONFIG_ROOT, 'utf16le')];
const AXML_MAGIC = 0x0003;
/**
 * Other config files are kilobytes, but a network security config can list every LAN address (BlueWallet: 8.1 MB
 * compiled). Larger XML resources are reported as unreadable, never skipped silently.
 */
const MAX_NETWORK_CONFIG_BYTES = 32 * 1024 * 1024;

/** Where an Android package keeps its manifest, assets and XML resources, and how they are encoded. */
interface Layout {
  manifest: string;
  assets: string;
  parseManifest: (buf: Buffer) => XmlElement;
  /** XML resources that may hold the network security config. */
  resourceXml: RegExp;
  /** Name of the resource table file, if the layout has one. */
  resourceTable: string;
  /** Parses the resource table into string resources keyed by resource id. */
  parseResourceTable: (buf: Buffer) => Map<number, string>;
  /** Parses a compiled XML resource; `undefined` for a raw file, which Android never reads as the config. */
  parseResource: (buf: Buffer) => XmlElement | undefined;
}

/** .aab: protobuf manifest and resources, everything under base/, full resource paths. */
export const AAB_MANIFEST = 'base/manifest/AndroidManifest.xml';
const AAB: Layout = {
  manifest: AAB_MANIFEST,
  assets: 'base/assets/',
  resourceTable: 'base/resources.pb',
  parseResourceTable: parseResourcesPb,
  parseManifest: parseProtoXml,
  resourceXml: /^base\/res\/xml[^/]*\/[^/]+\.xml$/,
  parseResource: parseProtoXml,
};

/** .apk: binary XML at the root. Release builds often shorten resource paths (res/xml/x.xml → res/zq.xml). */
export const APK_MANIFEST = 'AndroidManifest.xml';
const APK: Layout = {
  manifest: APK_MANIFEST,
  assets: 'assets/',
  resourceTable: 'resources.arsc',
  parseResourceTable: parseResourcesArsc,
  parseManifest: (buf) => parseAxml(buf),
  resourceXml: /^res\/(?:xml[^/]*\/)?[^/]+\.xml$/,
  parseResource: (buf) => (buf.length >= 2 && buf.readUInt16LE(0) === AXML_MAGIC ? parseAxml(buf, { root: NETWORK_CONFIG_ROOT }) : undefined),
};

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
  const networkSecurityConfig = application?.attributes['android:networkSecurityConfig'] !== undefined;
  const minSdkText = manifest.children.find((child) => child.name === 'uses-sdk')?.attributes['android:minSdkVersion'];
  const minSdk = minSdkText !== undefined && /^\d{1,3}$/.test(minSdkText) ? Number(minSdkText) : undefined;

  const problems: string[] = [];
  const bundleName = `${layout.assets}index.android.bundle`;
  const bundle = await readOptional(zip, bundleName, problems, (buf) => readBundle(bundleName, buf), MAX_BUNDLE_BYTES);
  const configName = `${layout.assets}app.config`;
  const expoConfig = await readOptional(zip, configName, problems, (buf) => readExpoConfig(configName, buf), MAX_CONFIG_BYTES);
  const networkExceptions = await readNetworkExceptions(zip, layout, problems);
  const updates = application ? updatesChannel(application, layout.manifest) : undefined;
  const deepLinks = application ? intentFilterHosts(application, layout.manifest) : [];
  // A host written as @string/... reaches the model as a resource
  // reference (@0x...). Resolve it through the resource table so the
  // deep link rules see the real host; anything still unresolved
  // keeps its reference and is reported by deeplink/unresolved-host.
  const resourceTable = await readOptional(zip, layout.resourceTable, problems, (buf) => layout.parseResourceTable(buf), MAX_CONFIG_BYTES);
  if (resourceTable) {
    for (const link of deepLinks) {
      if (link.host.startsWith('@0x') && link.host.length === 11) {
        const resolved = resourceTable.get(Number.parseInt(link.host.slice(3), 16));
        if (resolved !== undefined) link.host = resolved;
      }
    }
  }

  return {
    platform: 'android',
    file,
    appId: manifest.attributes['package'] ?? '',
    version: manifest.attributes['android:versionName'] ?? '',
    build: manifest.attributes['android:versionCode'] ?? '',
    flags: {
      ...(debuggable !== undefined ? { debuggable } : {}),
      ...(usesCleartextTraffic !== undefined ? { usesCleartextTraffic } : {}),
      ...(networkSecurityConfig ? { networkSecurityConfig } : {}),
    },
    ...(minSdk !== undefined ? { minSdk } : {}),
    deepLinks,
    ...(networkExceptions.length > 0 ? { networkExceptions } : {}),
    ...(updates ? { updates } : {}),
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

const UPDATES_META = 'expo.modules.updates.';

/** expo-updates keeps its config in <meta-data> (checked on a real SDK 58 prebuild); the request headers are JSON. */
function updatesChannel(application: XmlElement, file: string): AppModel['updates'] {
  const meta = new Map(application.children.filter((c) => c.name === 'meta-data').map((m) => [m.attributes['android:name'] ?? '', m.attributes['android:value'] ?? '']));
  if (meta.get(`${UPDATES_META}ENABLED`) === 'false') return undefined;
  let headers: unknown;
  try {
    headers = JSON.parse(meta.get(`${UPDATES_META}UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY`) ?? '');
  } catch {
    return undefined; // no headers, or not JSON: expo-updates cannot use them either
  }
  const channel = headers && typeof headers === 'object' ? (headers as Record<string, unknown>)['expo-channel-name'] : undefined;
  return typeof channel === 'string' && channel ? { channel, file } : undefined;
}

/**
 * The network security config, found by its root element rather than its name (release APKs shorten resource paths).
 * ponytail: does not resolve android:networkSecurityConfig through resources.arsc; a second, unreferenced config file
 * would be reported too. Resolve the reference if that ever shows up in a real build.
 */
async function readNetworkExceptions(zip: ZipArchive, layout: Layout, problems: string[]): Promise<NetworkException[]> {
  // No size filter here: an entry over the limit makes readOptional record a problem (fail closed), not a silent skip.
  const names = [...zip.entries.values()].filter((e) => layout.resourceXml.test(e.name)).map((e) => e.name);
  const found: NetworkException[] = [];
  for (const name of names) {
    const parse = (buf: Buffer) => (NETWORK_CONFIG_MARKERS.some((marker) => buf.includes(marker)) ? layout.parseResource(buf) : undefined);
    const root = await readOptional(zip, name, problems, parse, MAX_NETWORK_CONFIG_BYTES);
    if (root?.name === NETWORK_CONFIG_ROOT) found.push(...networkConfigExceptions(root, name));
  }
  return found;
}

const trustsUserCas = (el: XmlElement) =>
  el.children.some((anchors) => anchors.name === 'trust-anchors' && anchors.children.some((c) => c.name === 'certificates' && c.attributes['src'] === 'user'));

/** Plain HTTP and user CAs. `<debug-overrides>` is marked: Android applies it only when the build is debuggable. */
function networkConfigExceptions(root: XmlElement, file: string): NetworkException[] {
  const domainConfig = (el: XmlElement, inheritedCleartext: boolean): NetworkException[] => {
    const value = el.attributes['cleartextTrafficPermitted'];
    const cleartext = value === undefined ? inheritedCleartext : value === 'true';
    const domains = el.children.filter((c) => c.name === 'domain').map((d) => d.text?.trim() ?? '').filter(Boolean);
    return [
      ...(cleartext ? domains.map((host): NetworkException => ({ kind: 'cleartext', host, evidence: `<domain-config cleartextTrafficPermitted="true"> ${host}`, file })) : []),
      ...(trustsUserCas(el) ? [{ kind: 'user-ca', host: domains.join(', ') || '*', evidence: `<domain-config> for ${domains.join(', ')} trusts <certificates src="user">`, file } satisfies NetworkException] : []),
      ...el.children.filter((c) => c.name === 'domain-config').flatMap((child) => domainConfig(child, cleartext)),
    ];
  };
  return root.children.flatMap((el): NetworkException[] => {
    if (el.name === 'domain-config') return domainConfig(el, false);
    if (el.name === 'debug-overrides') {
      return trustsUserCas(el) ? [{ kind: 'user-ca', host: '*', evidence: '<debug-overrides> trusts <certificates src="user">', file, debugOverrides: true }] : [];
    }
    if (el.name !== 'base-config') return [];
    return [
      ...(el.attributes['cleartextTrafficPermitted'] === 'true' ? [{ kind: 'cleartext', host: '*', evidence: '<base-config cleartextTrafficPermitted="true">', file } satisfies NetworkException] : []),
      ...(trustsUserCas(el) ? [{ kind: 'user-ca', host: '*', evidence: '<base-config> trusts <certificates src="user">', file } satisfies NetworkException] : []),
    ];
  });
}
