---
name: release-lint
description: Check a built iOS or Android app (.ipa, .aab or .apk) for release mistakes before it ships - leaked secrets in the JS bundle or Expo config, staging or localhost servers, staging deep-link domains in the signed entitlements or manifest, debuggable or development-signed builds, and shipped source maps. Use when the user asks to check, lint or verify a release build, before an App Store or Google Play upload, or after an EAS / Gradle / Xcode release build.
---

# release-lint

Scans the final app file, not the source, so it sees what was really built: env-switched `app.config.ts`, generated native projects and config-plugin entitlements.

Only scan apps the user owns or has permission to audit. Never scan third-party apps.

## Run it

1. Find the release file. Common places: the path the user gives, `*.ipa` / `*.aab` / `*.apk` in the project root, `android/app/build/outputs/bundle/release/app-release.aab`, `android/app/build/outputs/apk/release/app-release.apk`, or the `--output` of `eas build --local`. If you cannot find one, ask; do not build one unless the user asks.
2. Run:

   ```sh
   npx app-release-lint@0 <file> --json
   ```

   Exit code `0` = nothing at or above `--fail-on` (default `error`), `1` = findings, `2` = the file could not be read (the message says why).
3. Read `findings` (each has `ruleId`, `severity`, `message`, `evidence`, `location`, `fix`) and `summary`.

## Report and fix

- Lead with errors. For each finding, explain it in one line and fix it **at its source** in the project, not in the binary:
  - `deeplink/non-production-host`: `ios.associatedDomains` / `android.intentFilters` in `app.config.(ts|js)` / `app.json`, often switched by `APP_VARIANT` or an env var; or the Release `.entitlements` / `AndroidManifest.xml` in bare projects. Check which EAS build profile (`eas.json`) produced the file.
  - `host/*`: the API base URL config (`EXPO_PUBLIC_*` env vars, `eas.json` `env`, `.env.production`, `app.config` `extra`).
  - `secret/*` (error): the key must move to a server. Tell the user to **revoke / rotate it now**: it has already shipped if this build was distributed. `secret/google-api-key` (info) is fine to ship; suggest restricting it in Google Cloud Console.
  - `debug/debuggable`: build the release variant / use a distribution (App Store or Ad Hoc) signing profile.
  - `sourcemap/*`: keep maps out of the app; upload them to the crash reporter instead.
- Evidence is already masked. Never try to recover or print the full secret.
- If a finding is intended (for example a known staging CDN that is really production), offer to add it to `release-lint.config.json` (`allowHosts`, or `ignore` with `rule` and optional `match`) instead of changing code.
- After fixing, the user needs a new build; re-run release-lint on it.
