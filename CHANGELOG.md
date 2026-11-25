# Changelog

## Unreleased

- New rule `secret/google-oauth-client-secret`: Google OAuth client secrets (`GOCSPX-…`) in the bundle or Expo config.
  Thanks [@techkayacodes](https://github.com/techkayacodes) (#7), the first outside contribution.

## 0.2.0

- **`.apk` support.** Reads the binary XML `AndroidManifest.xml` (UTF-16 and UTF-8 string pools; attribute names
  recovered from the resource map when an obfuscator stripped them). Tested on real release and debug APKs.
- **SARIF output:** `--sarif <path>` writes a SARIF 2.1.0 report for GitHub code scanning, with stable fingerprints.
  The GitHub Action has a matching `sarif` input.
- Secret patterns live in their own file with a one-line-per-rule test table, so adding a rule is a two-file change.

## 0.1.1

- In GitHub Actions, findings now appear as annotations on the run page and as a table in the job summary.
- A GitHub Action: `uses: harpreetkbadhan/release-lint@v0`.

## 0.1.0

First release.

- Reads `.ipa` and `.aab` files in place: zip (with zip64), binary and XML plists, the entitlements in the iOS code
  signature, the App Bundle's protobuf manifest, Hermes bytecode (verified on v98 and v99; other versions fall back to approximate strings) and the embedded Expo config.
- Rules for leaked secret keys, localhost / private network / tunnel / staging hosts, non-production deep link domains,
  debuggable and development-signed builds, development bundles and shipped source maps.
- Text and JSON reports, `--fail-on`, `--ignore`, and `release-lint.config.json`.
