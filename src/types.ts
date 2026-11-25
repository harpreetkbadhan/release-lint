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
}

export interface DeepLink {
  /** The host, or an unresolved `@0x…` resource reference on Android. */
  host: string;
  /** iOS associated-domains service (`applinks`, `webcredentials`, …), or Android `app-link` (autoVerify) / `intent-filter`. */
  kind: string;
  /** Archive entry the host was read from. */
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
    allowsArbitraryLoads?: boolean;
  };
  deepLinks: DeepLink[];
  bundle?: JsBundle;
  expoConfig?: { file: string; value: unknown };
  /** Archive entries ending in `.map`. */
  sourceMaps: string[];
  /** Parts of the app that could not be read; reported, never silently skipped. */
  problems: string[];
}
