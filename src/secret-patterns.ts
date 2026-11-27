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
  /** What the report shows instead of the masked match, for a match that holds more than a key prefix (a whole PEM key). */
  evidence?: (match: string) => string;
  /** Extra check on a match, for keys that are only secret in some forms. */
  isSecret?: (match: string) => boolean;
}

/** A real key body is hundreds of base64 characters; parser strings ship the header with nothing (or a few characters) after it. */
const MIN_PEM_BODY = 64;
const PEM_HEADER = /^-----BEGIN [A-Z ]{1,32}-----/;

/** True when at least MIN_PEM_BODY base64 characters follow the header, not counting Proc-Type / DEK-Info lines. */
const hasPemBody = (match: string): boolean =>
  match
    .replace(PEM_HEADER, '')
    .replace(/(?:Proc-Type|DEK-Info): [^\r\n\\]*/g, '')
    .replace(/\\[rn]|\s/g, '').length >= MIN_PEM_BODY;

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
  {
    id: 'secret/private-key',
    severity: 'error',
    // Header, optional Proc-Type / DEK-Info lines, then the base64 body. Newlines may be real or escaped (`\n` in a
    // plain JS bundle). The bare header alone is what PEM parsers ship, so a body is required (checked by hasPemBody).
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----(?:(?:\\[rn]|\s){1,8}(?:Proc-Type|DEK-Info): [^\r\n\\]{1,128}){0,2}(?:[A-Za-z0-9+/=]|\\[rn]|\s){1,8192}/g,
    isSecret: hasPemBody,
    // Never the key itself: only the header line.
    evidence: (match) => match.match(PEM_HEADER)?.[0] ?? '-----BEGIN PRIVATE KEY-----',
    message: 'Private key',
    fix: 'Remove the key from the app and replace it: anyone with the app file has a copy.',
  },
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
  {
    id: 'secret/mapbox-secret-token',
    severity: 'error',
    pattern: /(?<![\w-])sk\.eyJ[A-Za-z0-9_-]{20,1024}\.[A-Za-z0-9_-]{20,256}(?![\w-])/g,
    message: 'Mapbox secret token',
    fix: `Only the public token (pk.) belongs in the app; ${MOVE_TO_SERVER}`,
  },
  { id: 'secret/shopify-token', severity: 'error', pattern: /(?<![\w-])shp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}(?![\w-])/g, message: 'Shopify Admin API token or shared secret', fix: `Shopify Admin API tokens belong on your server: ${MOVE_TO_SERVER}` },
  { id: 'secret/huggingface-token', severity: 'error', pattern: /(?<![\w-])(?:hf|api_org)_[A-Za-z]{34}(?![\w-])/g, message: 'Hugging Face token', fix: `Hugging Face tokens belong on your server: ${MOVE_TO_SERVER}` },
  // `+` and `/` (and trailing `=`) count as part of the surrounding text: EAAA is common inside base64 data (bytes
  // 10 00 00, as in embedded fonts), and Square tokens never contain those characters.
  { id: 'secret/square-access-token', severity: 'error', pattern: /(?<![\w+/-])(?:EAAA|sq0atp-)[\w-]{22,60}(?![\w+/=-])/g, message: 'Square access token', fix: `Square access tokens can charge cards and read payments: ${MOVE_TO_SERVER}` },
  { id: 'secret/sentry-auth-token', severity: 'error', pattern: /(?<![\w-])(?:sntryu_[a-f0-9]{64}|sntrys_eyJpYXQiO[A-Za-z0-9+/]{10,200}(?:LCJyZWdpb25fdXJs|InJlZ2lvbl91cmwi|cmVnaW9uX3VybCI6)[A-Za-z0-9+/]{10,200}={0,2}_[A-Za-z0-9+/]{43})(?![A-Za-z0-9+/_-])/g, message: 'Sentry auth token', fix: `Sentry auth tokens upload source maps and read your issues: ${MOVE_TO_SERVER}` },
  { id: 'secret/supabase-secret-key', severity: 'error', pattern: /(?<![\w-])sb_secret_[A-Za-z0-9_-]{16,256}(?![\w-])/g, message: 'Supabase secret key', fix: `A Supabase secret key bypasses every Row Level Security policy: ${MOVE_TO_SERVER}` },
  { id: 'secret/groq-api-key', severity: 'error', pattern: /(?<![\w-])gsk_[A-Za-z0-9]{52}(?![\w-])/g, message: 'Groq API key', fix: `Groq API keys let anyone run models on your bill: ${MOVE_TO_SERVER}` },
  { id: 'secret/perplexity-api-key', severity: 'error', pattern: /(?<![\w-])pplx-[A-Za-z0-9]{48}(?![\w-])/g, message: 'Perplexity API key', fix: `Perplexity API keys let anyone use your API credits: ${MOVE_TO_SERVER}` },
  { id: 'secret/posthog-api-key', severity: 'error', pattern: /(?<![\w-])ph[xs]_[A-Za-z0-9_]{30,100}(?![\w-])/g, message: 'PostHog personal or project secret API key', fix: `PostHog personal and project secret keys can read and delete your analytics data. The app only needs the project token (phc_): ${MOVE_TO_SERVER}` },
  { id: 'secret/discord-webhook', severity: 'error', pattern: /(?<![\w-])https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[0-9]{17,20}\/[\w-]{60,80}(?![\w-])/g, message: 'Discord webhook URL', fix: `Anyone can post to your Discord channel with it: ${MOVE_TO_SERVER}` },
  { id: 'secret/npm-token', severity: 'error', pattern: /(?<![\w-])npm_[A-Za-z0-9]{36}(?![\w-])/g, message: 'npm access token', fix: `An npm token lets anyone publish packages as you: ${MOVE_TO_SERVER}` },
  { id: 'secret/notion-token', severity: 'error', pattern: /(?<![\w-])ntn_[0-9]{11}[A-Za-z0-9]{35}(?![\w-])/g, message: 'Notion integration token', fix: `A Notion token lets anyone read and edit the pages shared with it: ${MOVE_TO_SERVER}` },
  { id: 'secret/twilio-api-key', severity: 'error', pattern: /(?<![\w+/-])SK[0-9a-fA-F]{32}(?![\w+/=-])/g, message: 'Twilio API key', fix: `Twilio API keys let anyone send SMS on your bill: ${MOVE_TO_SERVER}` },
  { id: 'secret/replicate-api-token', severity: 'error', pattern: /(?<![\w-])r8_[0-9A-Za-z_-]{37}(?![\w-])/g, message: 'Replicate API token', fix: `Replicate tokens let anyone run models on your account: ${MOVE_TO_SERVER}` },
  // ↑ Add new patterns here, above this line.
];
// Public by design, never reported: Stripe publishable keys (pk_), Supabase anon keys, Supabase publishable keys (sb_publishable_),
// Sentry DSNs, RevenueCat public SDK keys, Mapbox public tokens (pk.), Square application IDs (sq0idp-), PostHog project tokens (phc_).
