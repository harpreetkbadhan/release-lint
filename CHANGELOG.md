# Changelog

## 0.3.10

- New rule `secret/discord-webhook`: Discord webhook URLs, which let anyone post to your channel. Thanks
  [@tarekooooooo](https://github.com/tarekooooooo) (#44), closing good first issue #32.
- New rule `secret/npm-token`: npm access tokens (`npm_`), which let anyone publish packages as you. Thanks
  [@daocuong11](https://github.com/daocuong11) (#45), closing good first issue #35.
- New rule `secret/notion-token`: Notion integration tokens (`ntn_`), which can read and edit the pages shared with
  them. Thanks [@daocuong11](https://github.com/daocuong11) (#46), closing good first issue #37.
- New rule `secret/twilio-api-key`: Twilio API keys (`SK…`), which let anyone send SMS on your bill. Account SIDs
  (`AC…`) only identify the account and are not reported. Thanks [@tarekooooooo](https://github.com/tarekooooooo)
  (#47), closing good first issue #34.
- New rule `secret/replicate-api-token`: Replicate API tokens (`r8_`), which let anyone run models on your account.
  Thanks [@tarekooooooo](https://github.com/tarekooooooo) (#49), closing good first issue #30.
- New rule `secret/resend-api-key`: Resend API keys (`re_`), which let anyone send email from your domain. Thanks
  [@tarekooooooo](https://github.com/tarekooooooo) (#50), closing good first issue #31.
- New rule `secret/brevo-api-key`: Brevo (Sendinblue) API keys (`xkeysib-`), which let anyone send from your account
  and read your contacts. Thanks [@tarekooooooo](https://github.com/tarekooooooo) (#48), closing good first issue #33.

## 0.3.9

- New rule `secret/groq-api-key`: Groq API keys (`gsk_`). Thanks [@ChaseZhang-ai](https://github.com/ChaseZhang-ai)
  (#24).
- New rule `secret/perplexity-api-key`: Perplexity API keys (`pplx-`). Thanks
  [@ChaseZhang-ai](https://github.com/ChaseZhang-ai) (#25).
- New rule `secret/posthog-api-key`: PostHog personal and project secret API keys (`phx_`, `phs_`). The project token
  (`phc_`) is public by design and never reported. Thanks [@Aadithya-kl](https://github.com/Aadithya-kl) (#26).
- `secret/square-access-token` no longer fires inside base64 data. `EAAA` is common in base64 of binary files such as
  embedded fonts, which raised false errors; Square tokens never contain `+`, `/` or `=`, so those now count as part
  of the surrounding text. On fonts and images from 31 real apps: 63 false alarms before, 0 after.

## 0.3.8

- New rule `secret/sentry-auth-token`: Sentry user tokens (`sntryu_`) and organization tokens (`sntrys_`), which
  upload source maps at build time. Sentry DSNs are public by design and never reported. Thanks
  [@ChaseZhang-ai](https://github.com/ChaseZhang-ai) (#19).
- New rule `secret/supabase-secret-key`: Supabase secret keys (`sb_secret_`), which bypass every Row Level Security
  policy. Supabase publishable keys (`sb_publishable_`) are public by design and never reported. Thanks
  [@ChaseZhang-ai](https://github.com/ChaseZhang-ai) (#20), closing good first issue #18.

## 0.3.7

- New rule `secret/huggingface-token`: Hugging Face access and organization tokens (`hf_`, `api_org_`). Thanks
  [@ChaseZhang-ai](https://github.com/ChaseZhang-ai) (#15).
- New rule `secret/square-access-token`: Square access tokens (`sq0atp-`, `EAAA`). Square application IDs (`sq0idp-`)
  are public by design and never reported. Thanks [@ChaseZhang-ai](https://github.com/ChaseZhang-ai) (#16).

## 0.3.6

- New rule `secret/shopify-token`: Shopify Admin API access tokens and app secrets (`shpat_`, `shpca_`, `shppa_`,
  `shpss_`) in the bundle or Expo config. Thanks [@shiwng](https://github.com/shiwng) (#12), closing good first issue #4.

## 0.3.5

- **No more `host/localhost` for axios's built-in `http://localhost`.** axios uses it as the base for parsing
  relative URLs outside a browser (`lib/platform/common/utils.js`), so it is in every bundle that uses axios: 6 of the
  31 apps in the benchmark. Like React Native's dev-server default, the exact string is ignored in bundles. Longer
  localhost URLs (`http://localhost/api`, `http://localhost:3000`) and values in the app config are still reported.

## 0.3.4

Fixes from running release-lint on 39 public release builds of 31 open-source apps (React Native, Expo, Flutter and
native Android).

- **`secret/private-key` no longer fires on a bare PEM header.** Crypto libraries ship
  `-----BEGIN … PRIVATE KEY-----` strings to parse PEM files, so the rule raised errors on six real apps with no key
  present. It now needs at least 64 base64 characters of key body after the header (real or escaped newlines,
  optional `Proc-Type` / `DEK-Info` lines). The evidence is the header line only; a key body is never printed.
- **Hermes bundles decode exactly** when a library uses the one-character property key `'\0'`. That single key made
  the string table check fail, so bundles of React Native 0.83 (bytecode v96) and some v98 apps fell back to
  approximate strings (`scan/hermes-approximate`).
- **Large network security configs are read**, up to 32 MiB; anything larger is reported as `scan/unreadable`. An
  8 MB config listing 65,541 hosts used to be skipped without a word.
- **`android:usesCleartextTraffic` is not reported when a network security config overrides it** (Android 7+, minSdk
  24 and up). With a lower minSdk, the finding says it applies to Android 6 and older.
- **Certificate revocation hosts** (CRL and OCSP of well-known CAs, such as `c.lencr.org` or `o.pki.goog`) are no
  longer reported as plain-HTTP exceptions: they serve signed data over HTTP by design.
- **More than 20 plain-HTTP hosts in one config are summed up** in one finding, local and development hosts first.
- **A zipped `.app` without the `Payload/` folder** (as some projects publish unsigned builds) is read as an `.ipa`.
- **Flavored release APKs are found** without a file argument (`outputs/apk/<flavor>/release/`).

## 0.3.3

- `debug/user-ca-trusted` now also reports user CAs inside `<debug-overrides>` when the build is debuggable, because
  Android turns `<debug-overrides>` on for any build with `android:debuggable="true"`, such as a release build type
  that got it set by mistake. The finding says so, next to the `debug/debuggable` error. Release builds stay silent.
  Suggested by u/dawedev on Reddit, thanks. Checked on aapt2-compiled .apk and .aab files.

## 0.3.2

- New rule `updates/non-production-channel` (#5, suggested on Reddit): an Expo app built to get over-the-air updates
  (EAS Update) from a tester channel (`preview`, `staging`, `development`, `beta`, …). Updates meant for testers would
  reach your users, and fixes published to production never would. Read from the Android manifest
  (`expo.modules.updates` meta-data) and the iOS `Expo.plist`; skipped when updates are turned off. Confirmed on a
  real Expo SDK 58 release `.aab` built with Gradle, and a real `.ipa`'s `Expo.plist`.

## 0.3.1

- **iOS without an `.ipa`.** release-lint now reads an Xcode `.app` or `.xcarchive` folder directly, so you can scan an
  archive before exporting it. Everything is checked as in the `.ipa`, except signing: Xcode signs the app again on
  export, so `get-task-allow` is not judged there (an info note says so). Symlinks inside the folder are never followed.
- New rule `debug/simulator-build` (error): an iOS Simulator build. It is not what you upload, so a clean scan of it
  would prove nothing.

## 0.3.0

- **Network security exceptions** (#6). New rules, from a Reddit thread on the launch post (thanks u/dawedev):
  - `debug/cleartext-exception`: plain HTTP allowed for one host, from the Android network security config
    (`<domain-config cleartextTrafficPermitted="true">`, including nested configs) or iOS `NSExceptionDomains`. Dev
    hosts such as `10.0.2.2`, LAN addresses or staging are named as such.
  - `debug/user-ca-trusted`: the network security config trusts user-installed CA certificates in `<base-config>` or a
    `<domain-config>`. Inside `<debug-overrides>` they only apply to debuggable builds, so they are not reported.
  - `debug/cleartext-traffic` now also fires for `<base-config cleartextTrafficPermitted="true">`.
- The config is found by its root element, so release APKs with shortened resource paths (`res/8G.xml`) are covered.
  Tested against files compiled by aapt2 (.apk, path-shortened .apk, .aab), and with no new findings on real Expo and
  React Native release builds.
- `NSAllowsLocalNetworking` is not reported: Expo's iOS template turns it on for every app.

## 0.2.4

- **No file needed.** `npx app-release-lint` with no file finds the release build in the usual output folders (project
  folder, `build/`, `ios/build/`, release variants in `android/app/build/outputs/`; debug builds are skipped). One
  build: it scans it and says which. Several: it asks which one, newest first, in a terminal; in CI and AI agents it
  lists them and exits 2. It never walks the whole tree, so `node_modules` is never read.
- The text report now ends with a plain answer that matches the exit code: *Do not upload this build…*, or, when the
  findings are below `--fail-on`, *Nothing at or above --fail-on …, read the findings above before you upload*.
- README: an *If something goes wrong* table, a time column in *Start here*, and a report-only line for the agent
  prompt. The real-output example is regenerated with 0.2.4.

## 0.2.3

- README: **Paste one prompt into your agent**, a copy-paste prompt for Claude Code, Codex, Cursor or Copilot. The agent finds
  the release build, runs release-lint, explains each finding and fixes it at its source (app config, EAS profile, env
  vars).
- **Claude Code plugin.** `/plugin marketplace add harpreetkbadhan/release-lint`, then
  `/plugin install app-release-lint@release-lint`, then type `/app-release-lint`. The skill is now named
  `app-release-lint` to match; its file path is unchanged.
- No changes to the CLI.

## 0.2.2

- No false alarms from the Sentry SDK: its built-in Spotlight URL (`http://localhost:8969/stream`) and links to Sentry's
  own domains (`develop.sentry.dev`, `*.sentry.io`) are no longer reported. Found by scanning a real Sentry-enabled app.
- Framework URLs such as React Native's `http://localhost:8081/` are now also ignored in plain JavaScript bundles, not
  only in Hermes ones. An app's own URLs next to them are still reported.
- README: the quick-start command no longer has an inline `#` comment, which zsh (the macOS default shell) passed on
  as extra arguments when copied.

## 0.2.1

- New rule `secret/google-oauth-client-secret`: Google OAuth client secrets (`GOCSPX-…`) in the bundle or Expo config.
  Thanks [@techkayacodes](https://github.com/techkayacodes) (#7), the first outside contribution.
- New rule `secret/mapbox-secret-token`: Mapbox secret tokens (`sk.…`); public `pk.` tokens are never reported.
  Thanks [@konpeeyush](https://github.com/konpeeyush) (#9).

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
