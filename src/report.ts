import { createHash } from 'node:crypto';
import { styleText } from 'node:util';
import type { AppModel, Finding, Severity } from './types.js';

type Style = Parameters<typeof styleText>[0];

const LABELS: Record<Severity, { text: string; style: Style }> = {
  error: { text: 'ERROR', style: ['bold', 'red'] },
  warning: { text: 'WARN ', style: ['bold', 'yellow'] },
  info: { text: 'INFO ', style: ['bold', 'cyan'] },
};
const INDENT = '        ';

/**
 * Strings from the app (hosts, entry names, bundle IDs) are untrusted: ANSI escapes could hide findings, a newline
 * could start a GitHub Actions `::command::` line, bidi overrides could disguise a host. Shown escaped, not stripped.
 */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
export const clean = (text: string) => text.replace(UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

const count = (findings: Finding[], severity: Severity) => findings.filter((f) => f.severity === severity).length;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function engine(app: AppModel): string {
  if (!app.bundle) return 'no JS bundle';
  return app.bundle.kind === 'hermes' ? `Hermes v${app.bundle.hermesVersion}` : 'JavaScript bundle (no Hermes)';
}

/** The human report: a header line, each finding with evidence, location and fix, and a summary. */
export function formatText(app: AppModel, findings: Finding[], { color, version }: { color: boolean; version: string }): string {
  // validateStream: false — whether to color is decided by the caller (TTY, NO_COLOR, --no-color).
  const paint = (style: Style, text: string) => (color ? styleText(style, text, { validateStream: false }) : text);
  const platform = app.platform === 'ios' ? 'iOS' : 'Android';
  const header = paint('bold', clean(`release-lint ${version} · ${app.file} · ${platform} · ${app.appId} ${app.version} (${app.build}) · ${engine(app)}`));

  if (findings.length === 0) {
    return `${header}\n\n${paint('green', 'No release problems found.')}\n`;
  }
  const body = findings.map((f) => {
    const label = LABELS[f.severity];
    return [
      ` ${paint(label.style, label.text)}  ${paint('bold', clean(f.ruleId))}  ${clean(f.message)}`,
      `${INDENT}${clean(f.evidence)}  ${paint('dim', `(${clean(f.location)})`)}`,
      `${INDENT}${paint('dim', `fix: ${clean(f.fix)}`)}`,
    ].join('\n');
  });
  const summary = `${plural(count(findings, 'error'), 'error')} · ${plural(count(findings, 'warning'), 'warning')} · ${count(findings, 'info')} info`;
  return `${header}\n\n${body.join('\n\n')}\n\n ${summary}\n`;
}

const GITHUB_LEVELS: Record<Severity, string> = { error: 'error', warning: 'warning', info: 'notice' };
const SUMMARY_ICONS: Record<Severity, string> = { error: '🔴', warning: '🟡', info: '🔵' };

/** GitHub workflow-command encoding. With clean() first, app text can never start a new `::command::` line. */
const commandData = (text: string) => clean(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const commandProperty = (text: string) => commandData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** One `::error` / `::warning` / `::notice` line per finding, shown on the GitHub Actions run page. */
export function formatAnnotations(findings: Finding[]): string {
  return findings
    .map((f) => {
      const title = commandProperty(`release-lint: ${f.ruleId}`);
      return `::${GITHUB_LEVELS[f.severity]} title=${title}::${commandData(`${f.message}: ${f.evidence} (${f.location}). Fix: ${f.fix}`)}\n`;
    })
    .join('');
}

/** A table cell: escaped like the text report, plus `|` (ends a cell) and backticks (end a code span). */
const cell = (text: string) => clean(text).replace(/\|/g, '\\|').replace(/`/g, "'");

/** Markdown for the GitHub Actions job summary ($GITHUB_STEP_SUMMARY). */
export function formatSummary(app: AppModel, findings: Finding[], version: string): string {
  const platform = app.platform === 'ios' ? 'iOS' : 'Android';
  const head = `## release-lint: ${cell(app.file)}\n\n${platform} · \`${cell(app.appId)}\` ${cell(app.version)} (${cell(app.build)}) · ${engine(app)} · release-lint ${version}\n\n`;
  if (findings.length === 0) {
    return `${head}✅ No release problems found.\n\n`;
  }
  const rows = findings.map(
    (f) => `| ${SUMMARY_ICONS[f.severity]} | \`${cell(f.ruleId)}\` | ${cell(f.message)}: \`${cell(f.evidence)}\` | \`${cell(f.location)}\` | ${cell(f.fix)} |`,
  );
  const summary = `${plural(count(findings, 'error'), 'error')} · ${plural(count(findings, 'warning'), 'warning')} · ${count(findings, 'info')} info`;
  return `${head}**${summary}**\n\n|   | Rule | Found | Where | Fix |\n|:-:|---|---|---|---|\n${rows.join('\n')}\n\n`;
}

const SARIF_LEVELS: Record<Severity, string> = { error: 'error', warning: 'warning', info: 'note' };
const REPO_URI = 'https://github.com/harpreetkbadhan/release-lint';

/**
 * SARIF 2.1.0, the format GitHub code scanning reads. `artifactUri` is the scanned app file (relative to the repository
 * when it is inside it); the entry inside the app goes in a logical location. Fingerprints keep alerts stable across runs.
 */
export function formatSarif(findings: Finding[], version: string, artifactUri: string): string {
  const rules = [...new Map(findings.map((f) => [f.ruleId, f])).values()].map((f) => ({
    id: f.ruleId,
    name: f.ruleId,
    shortDescription: { text: f.message },
    help: { text: f.fix },
    helpUri: `${REPO_URI}#what-it-checks`,
    defaultConfiguration: { level: SARIF_LEVELS[f.severity] },
  }));
  const results = findings.map((f) => ({
    ruleId: f.ruleId,
    level: SARIF_LEVELS[f.severity],
    message: { text: `${f.message}: ${f.evidence} (${f.location}). Fix: ${f.fix}` },
    locations: [
      {
        physicalLocation: { artifactLocation: { uri: artifactUri }, region: { startLine: 1 } },
        logicalLocations: [{ fullyQualifiedName: f.location }],
      },
    ],
    partialFingerprints: {
      'releaseLint/v1': createHash('sha256').update(`${f.ruleId}\0${f.location}\0${f.evidence}`).digest('hex').slice(0, 32),
    },
  }));
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'release-lint', version, informationUri: REPO_URI, rules } }, results }],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

/** The machine report for CI and agents. Evidence is masked exactly as in the text report. */
export function formatJson(app: AppModel, findings: Finding[], version: string): string {
  const { bundle } = app;
  const report = {
    tool: 'release-lint',
    version,
    app: {
      file: app.file,
      platform: app.platform,
      appId: app.appId,
      version: app.version,
      build: app.build,
      bundle: bundle ? { file: bundle.file, kind: bundle.kind, hermesVersion: bundle.hermesVersion ?? null, approximate: bundle.approximate } : null,
    },
    findings,
    summary: { errors: count(findings, 'error'), warnings: count(findings, 'warning'), info: count(findings, 'info') },
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}
