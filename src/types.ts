/** Thrown when the input file cannot be read as a supported app. The CLI exits with code 2. */
export class ReleaseLintError extends Error {
  override name = 'ReleaseLintError';
}

export type Platform = 'ios' | 'android';

export type Severity = 'error' | 'warning' | 'info';

/** Lowest to highest, for `--fail-on` comparisons and sorting. */
export const SEVERITIES: readonly Severity[] = ['info', 'warning', 'error'];

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  /** What was found. Secrets are always masked. */
  evidence: string;
  /** Archive entry, plus a config path for Expo values. */
  location: string;
  fix: string;
}

export interface RuleOptions {
  /** Hosts that are never reported: exact (`api.example.com`) or a suffix (`*.example.com`). */
  allowHosts: readonly string[];
}

/** An XML element from an Android manifest. Android-namespace attributes are keyed `android:<name>`. */
export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** Text content, such as the host in `<domain>10.0.2.2</domain>`; absent when the element has none. */
  text?: string;
}

/** Plain HTTP or user-installed CAs allowed by the network security settings (Android config, iOS ATS). */
export interface NetworkException {
  kind: 'cleartext' | 'user-ca';
  /** The host, or `*` for the whole app. */
  host: string;
  /** What the file says, for the report. */
  evidence: string;
  /** Archive entry it was read from. */
  file: string;
  /** From `<debug-overrides>`: Android applies it only when the build is debuggable. */
  debugOverrides?: true;
}

export interface DeepLink {
  /** The host, or an unresolved `@0x…` resource reference on Android. */
  host: string;
  /** iOS associated-domains service (`applinks`, `webcredentials`, …), or Android `app-link` (autoVerify) / `intent-filter`. */
  kind: string;
  /** Archive entry the host was read from. */
  file: string;
}

/** One NS*UsageDescription entry from an iOS Info.plist. */
export interface PermissionUsageDescription {
  /** The Info.plist key, such as NSCameraUsageDescription. */
  key: string;
  /** The description text as written in Info.plist. */
  text: string;
  /** Archive entry the description was read from. */
  file: string;
}

export interface JsBundle {
  file: string;
  kind: 'hermes' | 'javascript';
  hermesVersion?: number;
  /** True when Hermes strings came from the printable-run fallback. */
  approximate: boolean;
  /** Hermes string table, or the whole source as one string for a plain JavaScript bundle. */
  strings: string[];
}

/** Everything the rules look at, read once from the app file. */
export interface AppModel {
  platform: Platform;
  /** File name of the scanned app. */
  file: string;
  appId: string;
  version: string;
  build: string;
  flags: {
    /** Android `android:debuggable`; iOS `get-task-allow` (development signing). */
    debuggable?: boolean;
    usesCleartextTraffic?: boolean;
    /** Android: the manifest names a network security config. Android 7+ then ignores `usesCleartextTraffic`. */
    networkSecurityConfig?: boolean;
    allowsArbitraryLoads?: boolean;
    /** iOS: built for the Simulator (Info.plist DTPlatformName). */
    simulator?: boolean;
  };
  /** Android `uses-sdk` `android:minSdkVersion`, when it is a number. */
  minSdk?: number;
  deepLinks: DeepLink[];
  /** iOS permission usage descriptions (NS*UsageDescription) from Info.plist, when the app has any. */
  permissionUsageDescriptions?: PermissionUsageDescription[];
  /** Present only when the app has any. */
  networkExceptions?: NetworkException[];
  /** An iOS .app or .xcarchive folder: Xcode signs it again on export, so its signing is not judged. */
  unexported?: true;
  /** expo-updates (EAS Update): the channel this build gets over-the-air updates from. Absent when updates are off. */
  updates?: { channel: string; file: string };
  bundle?: JsBundle;
  expoConfig?: { file: string; value: unknown };
  /** Archive entries ending in `.map`. */
  sourceMaps: string[];
  /** Parts of the app that could not be read; reported, never silently skipped. */
  problems: string[];
}
