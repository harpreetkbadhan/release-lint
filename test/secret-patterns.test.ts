import { describe, expect, it } from 'vitest';
import { runRules } from '../src/rules.js';
import { SECRET_PATTERNS } from '../src/secret-patterns.js';
import type { AppModel } from '../src/types.js';

// Fake keys are assembled from pieces at runtime, so no file contains a complete key pattern.
const jwt = (payload: object) =>
  ['{"alg":"HS256","typ":"JWT"}', JSON.stringify(payload)].map((part) => Buffer.from(part).toString('base64url')).join('.') + '.' + 'x'.repeat(43);

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
  { rule: 'secret/private-key', finds: '-----BEGIN ' + 'PRIVATE KEY-----', ignores: '-----BEGIN ' + 'PUBLIC KEY-----' },
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

it('has a line in CASES for every secret pattern', () => {
  expect(CASES.map((c) => c.rule).sort()).toEqual(SECRET_PATTERNS.map((p) => p.id).sort());
});
