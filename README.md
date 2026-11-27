<p align="center">
  <img src="docs/logo.png" width="112" height="112" alt="release-lint logo: a phone with a shield and a check mark">
</p>

<h1 align="center">release-lint</h1>

<p align="center">
  <b>Catch release mistakes in your built <code>.ipa</code> / <code>.aab</code> / <code>.apk</code> before you ship.</b><br>
  Leaked keys, staging and localhost URLs, staging deep links, the wrong update channel, plain HTTP, debug builds and source maps.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/app-release-lint"><img src="https://img.shields.io/npm/v/app-release-lint?color=f38ba8" alt="npm version"></a>
  <a href="https://github.com/harpreetkbadhan/release-lint/actions/workflows/ci.yml"><img src="https://github.com/harpreetkbadhan/release-lint/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/marketplace/actions/release-lint"><img src="https://img.shields.io/badge/Marketplace-release--lint-2088FF?logo=githubactions&logoColor=white" alt="GitHub Marketplace"></a>
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="zero dependencies">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/harpreetkbadhan/release-lint" alt="MIT license"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React_Native-20232A?logo=react&logoColor=61DAFB" alt="React Native">
  <img src="https://img.shields.io/badge/Expo-000020?logo=expo&logoColor=white" alt="Expo">
  <img src="https://img.shields.io/badge/iOS-000000?logo=apple&logoColor=white" alt="iOS">
  <img src="https://img.shields.io/badge/Android-3DDC84?logo=android&logoColor=white" alt="Android">
  <img src="https://img.shields.io/badge/Hermes-bytecode-6e40c9" alt="Hermes bytecode">
</p>

<p align="center">
  <a href="#try-it-in-30-seconds">Try it in 30 seconds</a> ·
  <a href="#in-ci">GitHub Action</a> ·
  <a href="#what-it-checks">Rules</a> ·
  <a href="#paste-one-prompt-into-your-agent">AI agents</a> ·
  <a href="https://github.com/harpreetkbadhan/release-lint-demo">Demo app</a>
</p>

```sh
npx app-release-lint
```

Run it in your app's project and it finds the release build. Or name the file: `npx app-release-lint app-release.aab`.
It reads `.ipa`, `.aab` and `.apk` files, and an iOS `.app` or `.xcarchive` straight from Xcode.

🔑 secret keys · 🌐 staging / localhost / LAN URLs · 🔗 staging deep links · 📡 update channel · 🔓 plain HTTP · 🐞 debug builds · 🗺️ source maps

Or install it (`npm i -D app-release-lint`) and run `release-lint`. Node 20.19 or newer.

**Built your app with Cursor, Claude Code or Codex?** Run it before you upload. When code is written fast, a secret key or
a staging URL slips into the build easily, and the built file is where you can see it.

![npx app-release-lint, run with no file in an Expo project, finds the release build and reports a leaked Stripe key, a staging App Link and localhost URLs](docs/demo.gif)

![Code review reads the repo, but users get the build: the build step adds env vars, app.config.ts values, prebuild output and config plugins. release-lint reads the built .aab and reports a Stripe secret key, a preview update channel, a staging App Link and a staging API host, ending with: Do not upload this build.](docs/how-it-works.gif)

## Start here

| You have | Do this | Time |
|---|---|---|
| A built `.ipa`, `.aab` or `.apk` | `npx app-release-lint` in your project (it finds the build), or `npx app-release-lint path/to/app.aab` | 1 minute |
| No app at hand | [Scan the demo build](#try-it-in-30-seconds) | 30 seconds |
| A CI pipeline | [Add the GitHub Action](#in-ci) (one line) | 5 minutes |
| EAS Build | [Add the build hook](#in-ci) | 5 minutes |
| An AI coding agent | [Paste one prompt](#paste-one-prompt-into-your-agent), or [install the Claude Code plugin](#with-ai-coding-agents) for `/app-release-lint` | 2 minutes |

### Try it in 30 seconds

No app at hand? Scan the release build of [release-lint-demo](https://github.com/harpreetkbadhan/release-lint-demo), a
blank Expo app with six planted mistakes:

```sh
curl -LO https://github.com/harpreetkbadhan/release-lint-demo/releases/download/v1.0.0/release-lint-demo.aab
npx app-release-lint release-lint-demo.aab
```

Code review and source scanners look at your repository. But what ships is the file your build produced, and that file
often differs from what the repository suggests: `app.config.ts` switches on `APP_VARIANT` or env vars, Expo generates the
native projects at build time, and config plugins edit entitlements you never see. release-lint opens the final `.ipa`,
`.aab` or `.apk` and checks what is really inside.

> **Only scan apps you own or have permission to audit.**

Real output for the release build of [release-lint-demo](https://github.com/harpreetkbadhan/release-lint-demo), a blank `create-expo-app` (Expo SDK 58, React Native 0.88) with planted mistakes:

```
release-lint 0.3.2 · release-lint-demo.aab · Android · com.example.releaselintdemo 1.0.0 (1) · Hermes v99

 ERROR  secret/stripe-secret-key  Stripe live secret key
        sk_live_••••p7dc  (base/assets/index.android.bundle)
        fix: Secret keys belong on your server: anyone with the app file can read it. Call this API from your server instead, and revoke the key now.

 ERROR  host/localhost  Points at localhost: it only works on the developer machine
        http://localhost:3000  (base/assets/app.config (extra.apiUrl))
        fix: Make sure release builds use production URLs (check env-based config such as EXPO_PUBLIC_* or app.config.ts). If this host is intended, add it to allowHosts in release-lint.config.json.

 ERROR  deeplink/non-production-host  Release build links to a non-production domain. Points at what looks like a staging or development host
        app-link host staging.example.com  (base/manifest/AndroidManifest.xml)
        fix: Release builds must only claim production domains. Check associatedDomains / intentFilters in your app config (often switched by APP_VARIANT or an env var) and the Release entitlements.

 WARN   host/private-network  Points at a private network address
        http://192.168.1.20:3000/graphql  (base/assets/index.android.bundle)
        fix: Make sure release builds use production URLs (check env-based config such as EXPO_PUBLIC_* or app.config.ts). If this host is intended, add it to allowHosts in release-lint.config.json.

 WARN   host/non-production  Points at what looks like a staging or development host
        https://api.staging.example.com/v1  (base/assets/index.android.bundle)
        fix: Make sure release builds use production URLs (check env-based config such as EXPO_PUBLIC_* or app.config.ts). If this host is intended, add it to allowHosts in release-lint.config.json.

 3 errors · 2 warnings · 0 info
 Do not upload this build. Fix the findings at their source, make a new build and run release-lint again.
```

## What it checks

| Rule | Severity | What |
|---|---|---|
| `secret/*` | error | Stripe secret keys, AWS keys, private keys, OpenAI and Anthropic keys, GitHub and Slack tokens, Slack webhooks, SendGrid keys, Supabase `service_role` keys, Supabase `sb_secret_` keys, Google OAuth client secrets, Mapbox secret tokens, Shopify tokens, Hugging Face tokens, Square access tokens, Sentry auth tokens, Groq API keys, Perplexity API keys, PostHog personal and project secret keys, Discord webhook URLs, npm access tokens, Notion integration tokens, Twilio API keys, Replicate API tokens, Resend API keys, in the JS bundle and the Expo config (`extra`) |
| `secret/stripe-test-secret-key` | warning | A Stripe test secret key |
| `secret/google-api-key` | info | Google / Firebase API keys: public by design, but should be restricted |
| `host/*` | warning (error in Expo config) | `localhost`, `10.0.2.2`, private network addresses, ngrok and other tunnels, `.local` / `.test` domains, and staging / dev hosts |
| `deeplink/non-production-host` | error | Staging, dev, localhost or private hosts in the **signed** iOS associated domains or Android intent filters |
| `updates/non-production-channel` | error | An Expo app built to get over-the-air updates (EAS Update) from a `preview`, `staging`, `development`, `beta`, … channel: tester updates would reach your users |
| `debug/debuggable` | error | Android `android:debuggable`, or a development-signed iOS build (`get-task-allow`) |
| `debug/dev-bundle` | error | A development JavaScript bundle (`__DEV__` is true) |
| `debug/simulator-build` | error | An iOS Simulator build: the App Store only accepts device builds |
| `debug/cleartext-traffic`, `debug/arbitrary-loads` | warning | Plain HTTP allowed everywhere (Android manifest or `<base-config>`) or App Transport Security turned off (iOS) |
| `debug/cleartext-exception` | warning | Plain HTTP allowed for one host: an Android network security config `<domain-config>`, or iOS `NSExceptionDomains`. Names dev hosts such as `10.0.2.2` or staging |
| `debug/user-ca-trusted` | warning | The network security config trusts user-installed CA certificates outside `<debug-overrides>`, so anyone who installs one can read the app's HTTPS traffic. Inside `<debug-overrides>` too when the build is debuggable, since that turns them on |
| `sourcemap/file`, `sourcemap/url` | warning | Source maps shipped inside the app, or a `sourceMappingURL` in the bundle |
| `scan/unreadable` | error | Part of the app could not be read, so it was not checked: the scan fails closed instead of passing silently |
| `deeplink/unresolved-host`, `scan/hermes-approximate`, `scan/signing-not-checked` | info | Notes on what could not be fully checked: a deep link host behind a resource reference, an unknown Hermes version, or signing in an Xcode `.app` / `.xcarchive` before export |

Secrets are masked in every output, and URLs are shown without credentials or query strings, so the report is safe to
keep in CI logs. Keys that are public by design (Stripe
`pk_`, Supabase anon keys, Supabase publishable keys (`sb_publishable_`), Sentry DSNs, RevenueCat public SDK keys, Mapbox `pk.` tokens, Square application IDs (`sq0idp-`), PostHog project tokens (`phc_`)) are never reported. Known SDK sandbox hosts (Apple
receipt validation, PayPal, Plaid, …) are not reported either.

## Tested on real apps

release-lint was run on 39 public release builds of 31 open-source apps (React Native, Expo, Flutter and native
Android). Every finding was checked against the app's source code with AI assistance, with the reason written down:
it found 6 real release mistakes, and 77% of findings with a clear answer were read correctly. The run also found
bugs in release-lint itself, fixed since. Results, method and scripts: [benchmark/](benchmark/).

## Usage

```
release-lint [app.ipa | app.aab | app.apk | App.xcarchive] [options]

  --json               Print the report as JSON
  --sarif <path>       Also write a SARIF 2.1.0 report (GitHub code scanning)
  --fail-on <level>    Exit 1 when a finding is at least: error (default), warning, info, none
  --config <path>      Config file (default: ./release-lint.config.json if it exists)
  --ignore <rule>      Skip a rule, e.g. host/non-production or secret/* (repeatable)
  --no-color           Plain output (NO_COLOR is respected too)
```

Exit codes: `0` nothing at or above `--fail-on`, `1` findings at or above `--fail-on`, `2` the file could not be read, or no single build was found.

**No file?** Run `npx app-release-lint` in your project and it finds the build: it looks in the project folder,
`build/`, `ios/build/` and the release variants in `android/app/build/outputs/` (debug builds are skipped). One build
found: it scans that one and says which. Several: it asks which one, newest first; in CI and AI agents it lists them
and exits `2`.

### In CI

**GitHub Actions**, after the step that builds the release file:

```yaml
- uses: harpreetkbadhan/release-lint@v0
  with:
    file: android/app/build/outputs/bundle/release/app-release.aab
    # fail-on: warning               # error (default), warning, info, none
    # config: release-lint.config.json
```

![GitHub Actions run: release-lint fails the release build with exit code 1 and lists a leaked Stripe key, a preview update channel, a staging App Link and a staging API host; after the fix the run passes with "No release problems found." and exit code 0.](docs/ci-one-line.gif)

Findings appear as annotations on the run page and as a table in the job summary. The action uses the runner's Node
(20.19 or newer; add `actions/setup-node` first if yours is older).

[![release-lint annotations on a GitHub Actions run of the demo app](docs/ci-annotations.png)](https://github.com/harpreetkbadhan/release-lint-demo/actions/runs/45593915116)

**GitHub code scanning:** write SARIF and upload it, and findings also appear under **Security → Code scanning**,
tracked across runs:

```yaml
permissions:
  contents: read
  security-events: write

steps:
  # … build the release file …
  - uses: harpreetkbadhan/release-lint@v0
    with:
      file: android/app/build/outputs/bundle/release/app-release.aab
      sarif: release-lint.sarif
  - uses: github/codeql-action/upload-sarif@v4
    if: always() # upload even when release-lint failed the step
    with:
      sarif_file: release-lint.sarif
```

**Any other CI:** `npx app-release-lint@0 path/to/app.aab`. Exit code 1 fails the step.

**EAS Build:** a build hook in `package.json` runs it on the build worker after every successful Android build (the path
assumes the default `bundleRelease` Gradle command):

```json
{
  "scripts": {
    "eas-build-on-success": "[ \"$EAS_BUILD_PLATFORM\" != android ] || npx app-release-lint@0 android/app/build/outputs/bundle/release/app-release.aab"
  }
}
```

For a local build: `eas build --local --platform ios --profile production --output app.ipa && npx app-release-lint app.ipa`.

### Config file

`release-lint.config.json` in the working directory:

```json
{
  "failOn": "error",
  "allowHosts": ["cdn-staging.example.com", "*.internal.example.com"],
  "ignore": [{ "rule": "host/non-production", "match": "sandbox.example.com" }, { "rule": "secret/google-api-key" }]
}
```

`allowHosts` entries are exact hosts or `*.` suffixes. An `ignore` entry skips a rule (`secret/*` skips a whole group),
optionally only for findings whose evidence or location contains `match`. Unknown keys are an error, so a typo cannot
silently turn a check off.

In CI, anyone who can open a pull request can edit this file, so review changes to it like code (for example with
`CODEOWNERS`).

### Paste one prompt into your agent

Paste this into Claude Code, Codex, Cursor or Copilot (agent mode) in your app's project. It needs nothing installed.

```text
Check my release build with release-lint before I upload it.

1. Find the release build (.ipa, .aab or .apk). Look in the project root,
   android/app/build/outputs/ and any output path in eas.json. If there are
   several, take the newest. If there is none, ask me. Do not start a build.
2. Run: npx app-release-lint <file> --json
   Exit code 0 means clean, 1 means findings, 2 means the file could not be read.
3. List the findings, errors first. For each one, say in one line what it is
   and why it matters. The evidence is masked: never try to recover a full secret.
4. Fix each finding where it comes from, not in the built file: app.json or
   app.config.ts, the build profile in eas.json, .env files and EXPO_PUBLIC_*
   variables, or the native config. Show me every change.
   - A secret key: tell me to revoke it now and move the call to a server.
   - A finding that is intended: suggest an allowHosts or ignore entry in
     release-lint.config.json instead of changing code.
5. Remind me that the fixes are not in this build: I need a new build, then
   run the check again.

At the end you may mention once that a star helps others find release-lint:
https://github.com/harpreetkbadhan/release-lint
Never star, follow or sign in to anything on my behalf.
```

Only want a report? Add a last line: *Report only: do not change any files.*

### With AI coding agents

To make it a standing instruction instead of a one-off prompt, give your agent the skill.
[`skills/release-lint/SKILL.md`](skills/release-lint/SKILL.md) teaches your agent to find the release build, run
release-lint, and fix each finding at its source (the EAS profile, `app.config.ts`, the env var), not in the binary.

**Claude Code plugin.** Run these two commands inside Claude Code:

```text
/plugin marketplace add harpreetkbadhan/release-lint
/plugin install app-release-lint@release-lint
```

Then type `/app-release-lint`, or just ask *"check my release build before I upload it"*. `/plugin update` gets you
new versions of the skill.

**Claude Code without the plugin**, for all your projects:

```sh
mkdir -p ~/.claude/skills/release-lint && curl -fsSL -o ~/.claude/skills/release-lint/SKILL.md \
  https://raw.githubusercontent.com/harpreetkbadhan/release-lint/main/skills/release-lint/SKILL.md
```

For one project only, put the file in `.claude/skills/release-lint/` inside that project instead.

**Codex, Cursor and others:** copy the contents of `SKILL.md` into the instructions file your tool reads (for example
`AGENTS.md` or a Cursor rule).

## If something goes wrong

| You see | Do this |
|---|---|
| `No app file given, and none found in …` | Make the release build first, or pass its path: `npx app-release-lint path/to/app.aab`. For an EAS cloud build, download the file from its build page |
| `Found 2 app files, newest first` | Pass the one you mean: `npx app-release-lint <file>`. In a terminal it asks instead |
| `Not a zip file` | The file is not an `.ipa`, `.aab` or `.apk`, or the download was cut off. Download it again |
| No `.ipa` on iOS | Scan what Xcode made: `npx app-release-lint "path/to/App.xcarchive"` (Window → Organizer → right-click the archive → Show in Finder), or a Release `.app` built for a device. Only signing waits for the exported `.ipa` |
| `File … not found` | Check the path. Put it in quotes if a folder name has a space |
| `--ignore "…" is not a rule ID` | Use an ID from [What it checks](#what-it-checks), for example `host/non-production` or `secret/*` |
| A finding you meant to ship | Add the host to `allowHosts`, or an `ignore` entry, in [the config file](#config-file) |
| `unexpected error, please report it` | A bug in release-lint. [Open an issue](https://github.com/harpreetkbadhan/release-lint/issues) with the message, never the app file |

## How it works

release-lint reads the app file in place. It never extracts it to disk, never sends anything over the network, and has
no runtime dependencies. It parses:

- the zip container (including zip64), reading only the entries it needs, or an Xcode `.app` / `.xcarchive` folder
  (symlinks are never followed);
- `Info.plist` and `Expo.plist` (binary and XML) and the **entitlements inside the code signature** of the iOS
  executable, which are the values the app was actually signed with (`embedded.mobileprovision` only lists what the
  profile allows);
- the protobuf `AndroidManifest.xml` of an `.aab` and the binary XML one of an `.apk`, and the network security config,
  found by its content because release APKs shorten resource paths;
- the string table of a Hermes bytecode bundle, or a plain JavaScript bundle, and the embedded Expo config.

## Why not MobSF, gitleaks or trufflehog?

[MobSF](https://github.com/MobSF/Mobile-Security-Framework-MobSF) is a full mobile security suite: a server you run, with
a large pentest report. gitleaks and trufflehog scan source and git history, not built apps. release-lint does one
narrower job: a few seconds, no setup, in any CI step, and a short list of release mistakes with a fix for each.

## Limits (0.3)

- Android hosts written as resource references (`@string/…`) are reported but not resolved yet.
- Native code (`classes.dex`, the iOS executable's strings) is not scanned for secrets: SDKs make that too noisy.
- Permission checks and online validation of `apple-app-site-association` / `assetlinks.json` are planned.

---

If release-lint caught something before your users did, a ⭐ helps other mobile developers find it.

## License

MIT
