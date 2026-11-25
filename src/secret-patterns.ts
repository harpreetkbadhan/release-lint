/**
 * Secret key formats release-lint reports. To add one, append an entry at the END of SECRET_PATTERNS and one line
 * at the end of the table in test/secret-patterns.test.ts. See CONTRIBUTING.md.
 *
 * Rules for a pattern:
 * - a provider-specific prefix, never "looks random"
 * - start anchored with (?<![\w-]) and every repeat bounded ({20,256}, never + or *), so hostile input stays fast
 * - (?![\w-]) instead of \b at the end where a key may end in "-"
 */
import type { Severity } from './types.js';

export interface SecretPattern {
  id: string;
  severity: Severity;
  pattern: RegExp;
  message: string;
  fix: string;
  /** False for matches that contain no secret themselves, such as a PEM header. */
  mask?: boolean;
  /** Extra check on a match, for keys that are only secret in some forms. */
  isSecret?: (match: string) => boolean;
}

const isServiceRoleJwt = (token: string): boolean => {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { role?: unknown };
    return payload.role === 'service_role';
  } catch {
    return false;
  }
};

const MOVE_TO_SERVER = 'anyone with the app file can read it. Call this API from your server instead, and revoke the key now.';

/**
 * Provider-specific, prefix-anchored patterns only: no generic "high entropy" rule, which is where false alarms come from.
 * Every repeat is bounded and every start is anchored with a lookbehind, so a hostile multi-MB bundle string
 * (`sk-proj-sk-proj-…`, `-eyJ-eyJ…`) cannot make matching quadratic. `(?![\w-])` instead of `\b` where keys may end in `-`.
 */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { id: 'secret/stripe-secret-key', severity: 'error', pattern: /(?<![\w-])[rs]k_live_[0-9A-Za-z]{20,256}/g, message: 'Stripe live secret key', fix: `Secret keys belong on your server: ${MOVE_TO_SERVER}` },
  { id: 'secret/stripe-test-secret-key', severity: 'warning', pattern: /(?<![\w-])[rs]k_test_[0-9A-Za-z]{20,256}/g, message: 'Stripe test secret key', fix: 'Move calls that need a secret key to your server; only the publishable key (pk_) belongs in the app.' },
  { id: 'secret/aws-access-key', severity: 'error', pattern: /(?<![\w-])(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Za-z])/g, message: 'AWS access key ID (its secret key is usually right next to it)', fix: `Use Cognito or a backend that signs requests; ${MOVE_TO_SERVER}` },
  { id: 'secret/private-key', severity: 'error', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g, mask: false, message: 'Private key', fix: 'Remove the key from the app and replace it: anyone with the app file has a copy.' },
  { id: 'secret/openai-api-key', severity: 'error', pattern: /(?<![\w-])sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,256}/g, message: 'OpenAI API key', fix: `An LLM key in an app gets abused within days: ${MOVE_TO_SERVER}` },
  { id: 'secret/anthropic-api-key', severity: 'error', pattern: /(?<![\w-])sk-ant-[A-Za-z0-9_-]{20,256}/g, message: 'Anthropic API key', fix: `An LLM key in an app gets abused within days: ${MOVE_TO_SERVER}` },
  { id: 'secret/github-token', severity: 'error', pattern: /(?<![\w-])(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{40,255})/g, message: 'GitHub token', fix: MOVE_TO_SERVER },
  { id: 'secret/slack-token', severity: 'error', pattern: /(?<![\w-])xox[abposr]-[A-Za-z0-9-]{10,256}/g, message: 'Slack token', fix: MOVE_TO_SERVER },
  { id: 'secret/slack-webhook', severity: 'error', pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{1,256}/g, message: 'Slack webhook URL', fix: `Anyone can post to your Slack with it: ${MOVE_TO_SERVER}` },
  { id: 'secret/sendgrid-api-key', severity: 'error', pattern: /(?<![\w-])SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![\w-])/g, message: 'SendGrid API key', fix: MOVE_TO_SERVER },
  {
    id: 'secret/supabase-service-role',
    severity: 'error',
    pattern: /(?<![\w-])eyJ[A-Za-z0-9_-]{8,2048}\.eyJ[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{20,1024}/g,
    isSecret: isServiceRoleJwt,
    message: 'Supabase service_role key (bypasses Row Level Security)',
    fix: 'Only the anon key belongs in the app. Rotate the JWT secret / service key in Supabase now.',
  },
  {
    id: 'secret/google-api-key',
    severity: 'info',
    pattern: /(?<![\w-])AIza[0-9A-Za-z_-]{35}(?![\w-])/g,
    message: 'Google API key (public by design, e.g. Firebase)',
    fix: "Fine to ship, but restrict it to your app's bundle ID / package name and to the APIs it needs in Google Cloud Console.",
  },
  {
    id: 'secret/google-oauth-client-secret',
    severity: 'error',
    pattern: /(?<![\w-])GOCSPX-[A-Za-z0-9_-]{28}(?![\w-])/g,
    message: 'Google OAuth client secret',
    fix: `OAuth client secrets belong on your server: ${MOVE_TO_SERVER}`,
  },
  // ↑ Add new patterns here, above this line.
];
// Public by design, never reported: Stripe publishable keys (pk_), Supabase anon keys, Sentry DSNs, RevenueCat public SDK keys.
