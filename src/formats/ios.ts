import { ReleaseLintError, type AppModel, type DeepLink, type NetworkException, type PermissionUsageDescription } from '../types.js';
import { MAX_BUNDLE_BYTES, MAX_CONFIG_BYTES, readBundle, readExpoConfig, readOptional, sourceMaps } from './common.js';
import { readEntitlements } from './macho.js';
import { isPlistDict, parsePlist, type PlistDict, type PlistValue } from './plist.js';
import type { ZipArchive } from './zip.js';

const INFO_PLIST = /^Payload\/[^/]+\.app\/Info\.plist$/;
const ASSOCIATED_DOMAINS = 'com.apple.developer.associated-domains';

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Reads an .ipa into the app model. Throws `ReleaseLintError` if Info.plist is missing or broken.
 * `exported: false` is an .app or .xcarchive from Xcode: its signing changes on export, so get-task-allow is not read.
 */
export async function readIpa(zip: ZipArchive, file: string, { exported = true }: { exported?: boolean } = {}): Promise<AppModel> {
  const infoName = [...zip.entries.keys()].find((name) => INFO_PLIST.test(name));
  if (!infoName) {
    throw new ReleaseLintError('Not an iOS app: no Payload/<App>.app/Info.plist');
  }
  const appDir = infoName.slice(0, -'Info.plist'.length);
  const info = parsePlist(await zip.read(infoName, MAX_CONFIG_BYTES));
  if (!isPlistDict(info)) {
    throw new ReleaseLintError('Info.plist is not a dictionary');
  }

  const problems: string[] = [];
  const executable = `${appDir}${str(info['CFBundleExecutable'])}`;
  const entitlements = await readOptional(zip, executable, problems, readEntitlements);
  const bundleName = `${appDir}main.jsbundle`;
  const bundle = await readOptional(zip, bundleName, problems, (buf) => readBundle(bundleName, buf), MAX_BUNDLE_BYTES);
  const expoName = `${appDir}EXConstants.bundle/app.config`;
  const expoConfig = await readOptional(zip, expoName, problems, (buf) => readExpoConfig(expoName, buf), MAX_CONFIG_BYTES);

  const ats = info['NSAppTransportSecurity'];
  const arbitraryLoads = isPlistDict(ats) ? ats['NSAllowsArbitraryLoads'] : undefined;
  const expoPlistName = `${appDir}Expo.plist`;
  const expoPlist = await readOptional(zip, expoPlistName, problems, parsePlist, MAX_CONFIG_BYTES);
  const updates = updatesChannel(expoPlist, expoPlistName);
  const getTaskAllow = exported ? entitlements?.['get-task-allow'] : undefined;
  const simulator = info['DTPlatformName'] === 'iphonesimulator';
  const networkExceptions = atsExceptions(ats, infoName);
  const permissionUsageDescriptions = usageDescriptions(info, infoName);

  return {
    platform: 'ios',
    file,
    appId: str(info['CFBundleIdentifier']),
    version: str(info['CFBundleShortVersionString']),
    build: str(info['CFBundleVersion']),
    flags: {
      ...(typeof arbitraryLoads === 'boolean' ? { allowsArbitraryLoads: arbitraryLoads } : {}),
      ...(typeof getTaskAllow === 'boolean' ? { debuggable: getTaskAllow } : {}),
      ...(simulator ? { simulator } : {}),
    },
    deepLinks: entitlements ? associatedDomains(entitlements, executable) : [],
    ...(permissionUsageDescriptions.length > 0 ? { permissionUsageDescriptions } : {}),
    ...(networkExceptions.length > 0 ? { networkExceptions } : {}),
    ...(updates ? { updates } : {}),
    ...(bundle ? { bundle } : {}),
    ...(expoConfig ? { expoConfig } : {}),
    sourceMaps: sourceMaps(zip),
    problems,
    ...(exported ? {} : { unexported: true as const }),
  };
}

/** expo-updates config, copied into the app as Expo.plist (a binary plist in a real build). */
function updatesChannel(plist: PlistValue | undefined, file: string): AppModel['updates'] {
  if (!isPlistDict(plist) || plist['EXUpdatesEnabled'] === false) return undefined;
  const headers = plist['EXUpdatesRequestHeaders'];
  const channel = isPlistDict(headers) ? headers['expo-channel-name'] : undefined;
  return typeof channel === 'string' && channel ? { channel, file } : undefined;
}

const INSECURE_HTTP_KEYS = ['NSExceptionAllowsInsecureHTTPLoads', 'NSTemporaryExceptionAllowsInsecureHTTPLoads'];

/**
 * Hosts that App Transport Security lets the app reach over plain HTTP. NSAllowsLocalNetworking is not reported:
 * Expo's iOS template turns it on for every app, and it only covers local addresses.
 */
function atsExceptions(ats: PlistValue | undefined, file: string): NetworkException[] {
  const domains = isPlistDict(ats) ? ats['NSExceptionDomains'] : undefined;
  if (!isPlistDict(domains)) return [];
  return Object.entries(domains).flatMap(([host, settings]): NetworkException[] => {
    const key = isPlistDict(settings) ? INSECURE_HTTP_KEYS.find((k) => settings[k] === true) : undefined;
    return key ? [{ kind: 'cleartext', host, evidence: `NSExceptionDomains → ${host}: ${key} = true`, file }] : [];
  });
}

/** `applinks:example.com?mode=developer` → `{ kind: 'applinks', host: 'example.com' }`. */
/** Every NS*UsageDescription entry in Info.plist, in plist order. */
function usageDescriptions(info: PlistDict, file: string): PermissionUsageDescription[] {
  return Object.entries(info).flatMap(([key, value]): PermissionUsageDescription[] =>
    key.endsWith('UsageDescription') && typeof value === 'string' ? [{ key, text: value, file }] : [],
  );
}

function associatedDomains(entitlements: PlistDict, file: string): DeepLink[] {
  const domains = entitlements[ASSOCIATED_DOMAINS];
  if (!Array.isArray(domains)) {
    return [];
  }
  return domains.filter((d): d is string => typeof d === 'string' && d.includes(':')).map((entry) => {
    const [kind = '', rest = ''] = entry.split(/:(.*)/s);
    return { host: rest.split('?')[0] ?? '', kind, file };
  });
}
