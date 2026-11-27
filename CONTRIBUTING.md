# Contributing

Thanks for helping. The most useful contributions are:

- **False alarms.** If release-lint flags something in your app that is fine, open a "False alarm" issue. Paste the
  finding (secrets are already masked), never the app file.
- **New rules.** A key format or a release mistake it should catch. Small rule additions are good first pull requests.

To take a [`good first issue`](https://github.com/harpreetkbadhan/release-lint/labels/good%20first%20issue), comment on it.
Please work on one or two at a time, so new contributors can find one too.

## Development

```sh
npm install
npm test          # Vitest
npm run typecheck
npm run build
node dist/bin.js path/to/app.aab
```

Node 20.19 or newer. No runtime dependencies: please keep it that way.

## Adding a secret rule

Two files, both edits at the **end** of a list, so it works fine in GitHub's web editor:

1. **`src/secret-patterns.ts`**: add an entry just above the `// ↑ Add new patterns here` line, copying the shape of
   the entry before it:

   ```ts
   {
     id: 'secret/example-token',
     severity: 'error',
     pattern: /(?<![\w-])exm_[A-Za-z0-9]{32}(?![\w-])/g,
     message: 'Example API token',
     fix: MOVE_TO_SERVER,
   },
   ```

   Anchor the start with `(?<![\w-])`, bound every repeat (`{20,256}`, never `+` or `*`), and use a provider-specific
   prefix, never "looks random".
2. **`test/secret-patterns.test.ts`**: add one line at the end of `CASES`: a string the rule must report and a similar
   one it must not. Build fake keys from pieces (`'exm' + '_' + 'a'.repeat(32)`) so no file contains a complete key:

   ```ts
   { rule: 'secret/example-token', finds: 'exm' + '_' + 'a'.repeat(32), ignores: 'exm' + '_' + 'short' },
   ```

A test fails if a pattern has no line in `CASES`, so you can't forget step 2. Then add the key to the `secret/*` row of
the README table.

## Test files

Tests only use tiny synthetic files generated in the tests (`test/helpers/fixtures.ts`). Never add a real app, a
third-party app, or a file someone sent you.

## Pull requests

Conventional commit messages (`feat:`, `fix:`, `docs:`, …), one change per pull request, and `npm test` passing.
Please write titles, descriptions and comments in English, so every contributor and reviewer can follow along.

Before marking a pull request ready, run `npm test` and `npm run typecheck` yourself. For a change to a parser in
`src/formats/`, also run `node dist/bin.js` on a real app build (your own, or one from `node benchmark/download.mjs`)
and say in the pull request what you checked. Synthetic test files can share the parser's mistakes; a real build
can't.
