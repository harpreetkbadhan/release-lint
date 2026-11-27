import { describe, expect, it } from 'vitest';
import { runRules } from '../src/rules.js';
import { SECRET_PATTERNS } from '../src/secret-patterns.js';
import type { AppModel } from '../src/types.js';

// Fake keys are assembled from pieces at runtime, so no file contains a complete key pattern.
const jwt = (payload: object) =>
  ['{"alg":"HS256","typ":"JWT"}', JSON.stringify(payload)].map((part) => Buffer.from(part).toString('base64url')).join('.') + '.' + 'x'.repeat(43);

/** A fake PEM private key with a 4-line base64 body (64-character lines, as openssl writes them). */
const PEM_BODY_LINE = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC' + 'x'.repeat(13);
const pem = (kind: string, newline = '\n', extraHeaders = '') =>
  ['-----BEGIN ' + `${kind}-----`, ...(extraHeaders ? [extraHeaders] : []), ...Array(4).fill(PEM_BODY_LINE), '-----END ' + `${kind}-----`].join(newline);

interface Case {
  rule: string;
  /** A string the rule must report. */
  finds: string;
  /** A similar string the rule must not report. */
  ignores: string;
}

/** One line per secret pattern in src/secret-patterns.ts. Add new lines at the end. */
const CASES: Case[] = [
  { rule: 'secret/stripe-secret-key', finds: 'sk_' + 'live_' + 'a'.repeat(24), ignores: 'pk_' + 'live_' + 'a'.repeat(24) },
  { rule: 'secret/stripe-test-secret-key', finds: 'sk_' + 'test_' + 'a'.repeat(24), ignores: 'pk_' + 'test_' + 'a'.repeat(24) },
  { rule: 'secret/aws-access-key', finds: 'AK' + 'IA' + 'IOSFODNN7EXAMPLE', ignores: 'AK' + 'IA' + 'short' },
  { rule: 'secret/private-key', finds: pem('PRIVATE KEY'), ignores: '-----BEGIN ' + 'PRIVATE KEY-----' },
  { rule: 'secret/openai-api-key', finds: 'sk-' + 'proj-' + 'a'.repeat(30), ignores: 'sk-' + 'proj-' + 'short' },
  { rule: 'secret/anthropic-api-key', finds: 'sk-' + 'ant-' + 'a'.repeat(30), ignores: 'sk-' + 'ant-' + 'short' },
  { rule: 'secret/github-token', finds: 'gh' + 'p_' + 'a'.repeat(36), ignores: 'gh' + 'x_' + 'a'.repeat(36) },
  { rule: 'secret/slack-token', finds: 'xo' + 'xb-' + '1234567890-abc', ignores: 'xo' + 'xz-' + '1234567890-abc' },
  { rule: 'secret/slack-webhook', finds: 'https://hooks.slack.com/' + 'services/T000/B000/xyz', ignores: 'https://hooks.slack.com/' + 'workflows/abc' },
  { rule: 'secret/sendgrid-api-key', finds: 'SG' + '.' + 'a'.repeat(22) + '.' + 'b'.repeat(43), ignores: 'SG' + '.' + 'a'.repeat(10) },
  { rule: 'secret/supabase-service-role', finds: jwt({ role: 'service_role' }), ignores: jwt({ role: 'anon' }) },
  { rule: 'secret/google-api-key', finds: 'AI' + 'za' + 'a'.repeat(35), ignores: 'AI' + 'za' + 'a'.repeat(10) },
  { rule: 'secret/google-oauth-client-secret', finds: 'GOC' + 'SPX-' + 'a'.repeat(28), ignores: '1234-abc.apps.googleusercontent.com' },

  { rule: 'secret/mapbox-secret-token', finds: 'sk' + '.eyJ' + 'a'.repeat(60) + '.' + 'b'.repeat(22), ignores: 'pk' + '.eyJ' + 'a'.repeat(60) + '.' + 'b'.repeat(22) },
  { rule: 'secret/shopify-token', finds: 'shp' + 'at_' + 'a'.repeat(32), ignores: 'shp' + 'xx_' + 'a'.repeat(32) },
  { rule: 'secret/huggingface-token', finds: 'hf' + '_' + 'a'.repeat(34), ignores: 'hf' + '_' + 'a'.repeat(10) },
  { rule: 'secret/square-access-token', finds: 'sq0' + 'atp-' + 'a'.repeat(22), ignores: 'sq0' + 'idp-' + 'a'.repeat(22) },
  { rule: 'secret/sentry-auth-token', finds: 'sntry' + 'u_' + 'a'.repeat(64), ignores: 'https://' + 'a'.repeat(32) + '@o123.ingest.sentry.io/456' },
  { rule: 'secret/supabase-secret-key', finds: 'sb_' + 'secret_' + 'a'.repeat(32), ignores: 'sb_' + 'publishable_' + 'a'.repeat(32) },
  { rule: 'secret/groq-api-key', finds: 'gsk' + '_' + 'a'.repeat(52), ignores: 'gsk' + '_' + 'a'.repeat(20) },
  { rule: 'secret/perplexity-api-key', finds: 'pplx' + '-' + 'a'.repeat(48), ignores: 'pplx' + '-' + 'a'.repeat(20) },
  { rule: 'secret/posthog-api-key', finds: 'ph' + 'x_' + 'a'.repeat(43), ignores: 'ph' + 'c_' + 'a'.repeat(43) },
  { rule: 'secret/discord-webhook', finds: 'https://discord.com/api/' + 'webhooks/' + '1'.repeat(18) + '/' + 'a'.repeat(68), ignores: 'https://discord.com/api/' + 'oauth2/authorize' },
  { rule: 'secret/npm-token', finds: 'npm' + '_' + 'a'.repeat(36), ignores: 'npm' + '_' + 'a'.repeat(20) },
  { rule: 'secret/notion-token', finds: 'ntn' + '_' + '1'.repeat(11) + 'a'.repeat(35), ignores: 'ntn' + '_' + '1'.repeat(11) },
  { rule: 'secret/twilio-api-key', finds: 'S' + 'K' + 'a'.repeat(32), ignores: 'A' + 'C' + 'a'.repeat(32) },
  { rule: 'secret/replicate-api-token', finds: 'r8' + '_' + 'a'.repeat(37), ignores: 'r8' + '_' + 'a'.repeat(20) },
  { rule: 'secret/resend-api-key', finds: 're' + '_' + 'a'.repeat(8) + '_' + 'b'.repeat(24), ignores: 're' + '_' + 'a'.repeat(8) },
  { rule: 'secret/brevo-api-key', finds: 'xkeysib' + '-' + 'a'.repeat(64) + '-' + 'b'.repeat(16), ignores: 'xkeysib' + '-' + 'a'.repeat(20) },
];

const app = (strings: string[]): AppModel => ({
  platform: 'android',
  file: 'demo.aab',
  appId: 'com.example.demo',
  version: '1.0.0',
  build: '1',
  flags: {},
  deepLinks: [],
  sourceMaps: [],
  problems: [],
  bundle: { file: 'base/assets/index.android.bundle', kind: 'hermes', hermesVersion: 99, approximate: false, strings },
});
const ruleIds = (value: string) => runRules(app([`const key = "${value}";`]), { allowHosts: [] }).map((f) => f.ruleId);

describe.each(CASES)('$rule', ({ rule, finds, ignores }) => {
  it('reports a matching key', () => {
    expect(ruleIds(finds)).toContain(rule);
  });

  it('does not report a similar string', () => {
    expect(ruleIds(ignores)).not.toContain(rule);
  });
});

describe('secret/square-access-token', () => {
  const squareIds = (value: string) => runRules(app([value]), { allowHosts: [] }).filter((f) => f.ruleId === 'secret/square-access-token');
  const EAAA_TOKEN = 'EA' + 'AA' + 'l'.repeat(60);

  it('reports an EAAA token in code, JSON or a header', () => {
    for (const value of [`token = "${EAAA_TOKEN}"`, `{"accessToken":"${EAAA_TOKEN}"}`, `Bearer ${EAAA_TOKEN}`, `SQUARE_TOKEN=${EAAA_TOKEN}`]) {
      expect(squareIds(value)).toHaveLength(1);
    }
  });

  it('ignores EAAA inside base64 data, as in an embedded font (bytes 10 00 00 encode as EAAA)', () => {
    // Shape found in base64 fonts of 17 benchmark apps: a "/" or "+" from the base64 alphabet, EAAA, then more base64.
    const font = 'data:font/ttf;base64,AAEAAAASAQAABAAgR0RFRrRCsIIAAjWsAAACYk/' + 'EA' + 'AAAAAAAQAAAAbUFhcmpdAD8Rx+AAAAEAAAAAAAAAAAAA==';
    expect(squareIds(font)).toEqual([]);
    expect(squareIds('xyz+' + 'EA' + 'AA' + 'b'.repeat(30) + '/abc')).toEqual([]);
  });
});

describe('secret/private-key', () => {
  const findings = (value: string) => runRules(app([value]), { allowHosts: [] }).filter((f) => f.ruleId === 'secret/private-key');

  it('reports a key whose newlines are escaped, as in a plain JavaScript bundle', () => {
    expect(findings(`var k = "${pem('RSA PRIVATE KEY', '\\n')}";`)).toHaveLength(1);
  });

  it('reports a traditional encrypted key with Proc-Type and DEK-Info lines', () => {
    const key = pem('RSA PRIVATE KEY', '\n', 'Proc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,0123456789ABCDEF0123456789ABCDEF\n');
    expect(findings(key)).toHaveLength(1);
  });

  it('shows only the header as evidence, never the key itself', () => {
    const [finding] = findings(pem('EC PRIVATE KEY'));
    expect(finding?.evidence).toBe('-----BEGIN ' + 'EC PRIVATE KEY-----');
    expect(finding?.evidence).not.toContain('MIIE');
  });

  it('ignores the header strings that PEM parsers ship, with no key after them', () => {
    const header = '-----BEGIN ' + 'PRIVATE KEY-----';
    const parserStrings = [
      header,
      `${header}\n-----END ` + 'PRIVATE KEY-----',
      `${header}\n${'\n'.repeat(80)}`,
      `${header}\nMIIEvQIBADANBgkq\n-----END ` + 'PRIVATE KEY-----',
      `Expected "${header}" but got something else`,
    ];
    for (const value of parserStrings) expect(findings(value)).toEqual([]);
  });

  it('stays fast on hostile input', () => {
    const header = '-----BEGIN ' + 'PRIVATE KEY-----';
    const started = performance.now();
    findings(`${header}\n${'A'.repeat(63)}!`.repeat(20_000));
    findings(`${header}\n${'A'.repeat(1_000_000)}`);
    findings(`${header}${' \\n'.repeat(200_000)}`);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

it('has a line in CASES for every secret pattern', () => {
  expect(CASES.map((c) => c.rule).sort()).toEqual(SECRET_PATTERNS.map((p) => p.id).sort());
});
