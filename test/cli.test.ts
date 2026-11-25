import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { aab, androidManifest, hbc, ipa, writeTemp } from './helpers/fixtures.js';

const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
const STRIPE_LIVE = 'sk_' + 'live_' + '4eC39HqLyjWDarjtT1zdp7dc';
const text = (value: string) => Buffer.from(value);
const DOMAINS = 'com.apple.developer.associated-domains';

async function run(argv: string[], { cwd, color = false, env = {} }: { cwd?: string; color?: boolean; env?: Record<string, string> } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, {
    stdout: { write: (s: string) => out.push(s) },
    stderr: { write: (s: string) => err.push(s) },
    cwd: cwd ?? (await mkdtemp(join(tmpdir(), 'release-lint-cwd-'))),
    color,
    env,
  });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

const badIpa = () =>
  writeTemp(
    'demo.ipa',
    ipa({
      entitlements: { [DOMAINS]: ['applinks:example.com', 'applinks:staging.example.com'] },
      bundle: hbc({ strings: [STRIPE_LIVE, 'http://192.168.1.20:3000/api'], identifiers: ['key'] }),
    }),
  );

describe('release-lint CLI', () => {
  it('exits 0 and says so for a clean app', async () => {
    const path = await writeTemp('clean.ipa', ipa({ bundle: hbc({ strings: ['https://api.example.com'], identifiers: ['x'] }) }));
    const { code, stdout } = await run([path]);
    expect(code).toBe(0);
    expect(stdout).toContain(`release-lint ${VERSION} · clean.ipa · iOS · com.example.demo 1.4.0 (42) · Hermes v98`);
    expect(stdout).toContain('No release problems found');
  });

  it('prints each finding with its fix and exits 1 when there are errors', async () => {
    const { code, stdout } = await run([await badIpa()]);
    expect(code).toBe(1);
    expect(stdout).toContain('ERROR  deeplink/non-production-host');
    expect(stdout).toContain('applinks:staging.example.com  (Payload/Demo.app/Demo)');
    expect(stdout).toContain('ERROR  secret/stripe-secret-key');
    expect(stdout).toContain('WARN   host/private-network');
    expect(stdout).toMatch(/fix: /);
    expect(stdout).toContain('2 errors · 1 warning · 0 info');
    expect(stdout).not.toContain(STRIPE_LIVE);
  });

  it('prints JSON with --json, secrets still masked', async () => {
    const { code, stdout } = await run([await badIpa(), '--json']);
    expect(code).toBe(1);
    const report = JSON.parse(stdout) as { tool: string; app: { platform: string; bundle: unknown }; findings: Array<{ ruleId: string }>; summary: unknown };
    expect(report.tool).toBe('release-lint');
    expect(report.app).toMatchObject({ platform: 'ios', appId: 'com.example.demo', bundle: { kind: 'hermes', hermesVersion: 98, approximate: false } });
    expect(report.findings.map((f) => f.ruleId)).toEqual(['secret/stripe-secret-key', 'deeplink/non-production-host', 'host/private-network']);
    expect(report.summary).toEqual({ errors: 2, warnings: 1, info: 0 });
    expect(stdout).not.toContain(STRIPE_LIVE);
  });

  it('only fails on warnings with --fail-on warning, and never with --fail-on none', async () => {
    const manifest = androidManifest([{ name: 'usesCleartextTraffic', android: true, value: 'true' }]);
    const path = await writeTemp('demo.aab', aab({ manifest }));
    expect((await run([path])).code).toBe(0);
    expect((await run([path, '--fail-on', 'warning'])).code).toBe(1);
    expect((await run([await badIpa(), '--fail-on', 'none'])).code).toBe(0);
  });

  it('reads release-lint.config.json from the working directory', async () => {
    const path = await badIpa();
    const cwd = dirname(path);
    await writeFile(
      join(cwd, 'release-lint.config.json'),
      JSON.stringify({ failOn: 'warning', allowHosts: ['staging.example.com'], ignore: [{ rule: 'secret/*' }, { rule: 'host/private-network', match: '192.168.1.20' }] }),
    );
    const { code, stdout } = await run([path], { cwd });
    expect(code).toBe(0);
    expect(stdout).toContain('No release problems found');
  });

  it('ignores rules given with --ignore', async () => {
    const { stdout } = await run([await badIpa(), '--ignore', 'deeplink/non-production-host', '--ignore', 'host/private-network', '--json']);
    expect((JSON.parse(stdout) as { findings: Array<{ ruleId: string }> }).findings.map((f) => f.ruleId)).toEqual(['secret/stripe-secret-key']);
  });

  it('colors the output only when asked', async () => {
    expect((await run([await badIpa()], { color: true })).stdout).toContain('\u001b[');
    expect((await run([await badIpa()])).stdout).not.toContain('\u001b[');
  });

  it('exits 2 with a clear message for unusable input', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'release-lint-cwd-'));
    expect(await run(['missing.ipa'], { cwd })).toMatchObject({ code: 2, stderr: expect.stringContaining('File missing.ipa not found') });
    expect(await run([cwd], { cwd })).toMatchObject({ code: 2, stderr: expect.stringContaining('is a directory') });
    expect(await run(['a.ipa', '--config='], { cwd })).toMatchObject({ code: 2, stderr: expect.stringContaining('--config needs a file path') });
    expect(await run(['a.ipa', '--ignore', 'oops'], { cwd })).toMatchObject({ code: 2, stderr: expect.stringContaining('not a rule ID') });
    expect(await run([await writeTemp('x.ipa', Buffer.from('nope'))])).toMatchObject({ code: 2, stderr: expect.stringContaining('Not a zip file') });
    expect(await run([])).toMatchObject({ code: 2, stderr: expect.stringContaining('Usage: release-lint') });
    expect(await run(['a.ipa', 'b.ipa'])).toMatchObject({ code: 2, stderr: expect.stringContaining('one app file') });
    expect(await run(['--bogus'])).toMatchObject({ code: 2, stderr: expect.stringContaining('--bogus') });
    expect(await run(['a.ipa', '--fail-on', 'loud'])).toMatchObject({ code: 2, stderr: expect.stringContaining('--fail-on') });
  });

  it('exits 2 for an invalid config file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'release-lint-cwd-'));
    await writeFile(join(cwd, 'bad.json'), JSON.stringify({ allowHost: ['x'] }));
    const { code, stderr } = await run([await badIpa(), '--config', 'bad.json'], { cwd });
    expect(code).toBe(2);
    expect(stderr).toContain('unknown key "allowHost"');
    expect((await run([await badIpa(), '--config', 'nope.json'], { cwd })).stderr).toContain('Config file not found');
  });

  it('escapes control characters from the app so they cannot forge output', async () => {
    const path = await writeTemp(
      'demo.ipa',
      ipa({ bundle: hbc({ strings: ['http://localhost/\u001b[2J'], identifiers: ['x'] }), extra: { 'Payload/Demo.app/x\n::error::forged.map': text('{}') } }),
    );
    const { stdout } = await run([path]);
    expect(stdout).not.toContain('\u001b');
    expect(stdout).not.toMatch(/^::error::/m);
    expect(stdout).toContain('x\\u000a::error::forged.map');
  });

  describe('--sarif', () => {
    interface Sarif {
      version: string;
      runs: Array<{
        tool: { driver: { name: string; version: string; rules: Array<{ id: string; defaultConfiguration: { level: string } }> } };
        results: Array<{
          ruleId: string;
          level: string;
          message: { text: string };
          locations: Array<{ physicalLocation: { artifactLocation: { uri: string } }; logicalLocations: Array<{ fullyQualifiedName: string }> }>;
          partialFingerprints: Record<string, string>;
        }>;
      }>;
    }

    it('writes a SARIF 2.1.0 report next to the normal output, secrets masked', async () => {
      const cwd = dirname(await badIpa());
      const { code, stdout } = await run(['demo.ipa', '--sarif', 'release-lint.sarif'], { cwd });
      expect(code).toBe(1);
      expect(stdout).toContain('ERROR  secret/stripe-secret-key');
      const text = await readFile(join(cwd, 'release-lint.sarif'), 'utf8');
      expect(text).not.toContain(STRIPE_LIVE);
      const sarif = JSON.parse(text) as Sarif;
      expect(sarif.version).toBe('2.1.0');
      const [runOut] = sarif.runs;
      expect(runOut?.tool.driver).toMatchObject({ name: 'release-lint', version: VERSION });
      const expected = [
        ['secret/stripe-secret-key', 'error'],
        ['deeplink/non-production-host', 'error'],
        ['host/private-network', 'warning'],
      ];
      expect(runOut?.tool.driver.rules.map((r) => [r.id, r.defaultConfiguration.level])).toEqual(expected);
      expect(runOut?.results.map((r) => [r.ruleId, r.level])).toEqual(expected);
      const first = runOut?.results[0];
      expect(first?.message.text).toContain('sk_live_••••p7dc');
      expect(first?.locations[0]?.physicalLocation.artifactLocation.uri).toBe('demo.ipa');
      expect(first?.locations[0]?.logicalLocations[0]?.fullyQualifiedName).toBe('Payload/Demo.app/main.jsbundle');
      expect(first?.partialFingerprints['releaseLint/v1']).toMatch(/^[0-9a-f]{32}$/);
    });

    it('gives a finding the same fingerprint on every run', async () => {
      const cwd = dirname(await badIpa());
      await run(['demo.ipa', '--sarif', 'a.sarif'], { cwd });
      await run(['demo.ipa', '--sarif', 'b.sarif', '--json'], { cwd });
      const prints = async (name: string) =>
        ((JSON.parse(await readFile(join(cwd, name), 'utf8')) as Sarif).runs[0]?.results ?? []).map((r) => r.partialFingerprints['releaseLint/v1']);
      expect(await prints('a.sarif')).toEqual(await prints('b.sarif'));
    });

    it('maps info findings to SARIF "note"', async () => {
      const GOOGLE = 'AI' + 'za' + 'a'.repeat(35);
      const cwd = dirname(await writeTemp('g.ipa', ipa({ bundle: hbc({ strings: [GOOGLE], identifiers: ['x'] }) })));
      await run(['g.ipa', '--sarif', 'g.sarif'], { cwd });
      const sarif = JSON.parse(await readFile(join(cwd, 'g.sarif'), 'utf8')) as Sarif;
      expect(sarif.runs[0]?.results.map((r) => r.level)).toEqual(['note']);
    });

    it('exits 2 when the SARIF file cannot be written', async () => {
      const cwd = dirname(await badIpa());
      const { code, stderr } = await run(['demo.ipa', '--sarif', 'missing-dir/report.sarif'], { cwd });
      expect(code).toBe(2);
      expect(stderr).toContain('could not write the SARIF file');
    });
  });

  describe('in GitHub Actions', () => {
    const actionsEnv = async () => {
      const summary = join(await mkdtemp(join(tmpdir(), 'release-lint-gh-')), 'summary.md');
      await writeFile(summary, '');
      return { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary };
    };

    it('adds an annotation per finding and a findings table to the job summary', async () => {
      const env = await actionsEnv();
      const { code, stdout } = await run([await badIpa()], { env });
      expect(code).toBe(1);
      const annotations = stdout.split('\n').filter((line) => line.startsWith('::'));
      expect(annotations).toHaveLength(3);
      expect(annotations[0]).toMatch(/^::error title=release-lint%3A secret\/stripe-secret-key::Stripe live secret key: sk_live_••••p7dc/);
      expect(annotations[2]).toMatch(/^::warning title=release-lint%3A host\/private-network::/);
      expect(stdout).not.toContain(STRIPE_LIVE);

      const summary = await readFile(env.GITHUB_STEP_SUMMARY, 'utf8');
      expect(summary).toContain('## release-lint: demo.ipa');
      expect(summary).toContain('**2 errors · 1 warning · 0 info**');
      expect(summary).toContain('| 🔴 | `secret/stripe-secret-key` | Stripe live secret key: `sk_live_••••p7dc` |');
      expect(summary).not.toContain(STRIPE_LIVE);
    });

    it('reports a clean app in the summary and adds no annotations', async () => {
      const env = await actionsEnv();
      const path = await writeTemp('clean.ipa', ipa({ bundle: hbc({ strings: ['https://api.example.com'], identifiers: ['x'] }) }));
      const { stdout } = await run([path], { env });
      expect(stdout).not.toMatch(/^::/m);
      expect(await readFile(env.GITHUB_STEP_SUMMARY, 'utf8')).toContain('No release problems found');
    });

    it('keeps --json output clean', async () => {
      const env = await actionsEnv();
      const { stdout } = await run([await badIpa(), '--json'], { env });
      expect(() => JSON.parse(stdout)).not.toThrow();
      expect(await readFile(env.GITHUB_STEP_SUMMARY, 'utf8')).toBe('');
    });

    it('cannot be used to inject workflow commands', async () => {
      const env = await actionsEnv();
      const path = await writeTemp('demo.ipa', ipa({ extra: { 'Payload/Demo.app/x\n::add-mask::y|z`.map': text('{}') } }));
      const { stdout } = await run([path], { env });
      const commands = stdout.split('\n').filter((line) => line.startsWith('::'));
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatch(/^::warning /);
      const summary = await readFile(env.GITHUB_STEP_SUMMARY, 'utf8');
      expect(summary).toContain('x\\u000a::add-mask::y\\|z\'.map');
    });
  });

  it('prints help and version', async () => {
    expect(await run(['--help'])).toMatchObject({ code: 0, stdout: expect.stringContaining('Usage: release-lint <app.ipa|app.aab|app.apk>') });
    expect(await run(['--version'])).toMatchObject({ code: 0, stdout: `${VERSION}\n` });
  });
});
