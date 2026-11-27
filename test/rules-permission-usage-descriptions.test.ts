import { describe, expect, it } from 'vitest';
import { readApp } from '../src/formats/app.js';
import { runRules } from '../src/rules.js';
import { ipa, writeTemp } from './helpers/fixtures.js';

// Scoped first step of issue #42 only: placeholder or empty usage
// descriptions in Info.plist. Whether a used capability is missing a
// description is deliberately not checked here.
async function readIpa(info: Record<string, string>) {
  return readApp(await writeTemp('demo.ipa', ipa({ info })));
}

function permissionFindings(app: Awaited<ReturnType<typeof readIpa>>) {
  return runRules(app, { allowHosts: [] }).filter((finding) => finding.ruleId.startsWith('permission/'));
}

describe('iOS permission usage descriptions', () => {
  it('flags an empty description and placeholder descriptions, and leaves a real one alone', async () => {
    const app = await readIpa({
      NSCameraUsageDescription: 'Allow $(PRODUCT_NAME) to access your camera',
      NSPhotoLibraryUsageDescription: '',
      NSMicrophoneUsageDescription: 'We need the microphone to record voice notes for your journal entries.',
      NSLocationWhenInUseUsageDescription: 'TODO: add a reason',
    });
    expect(app.permissionUsageDescriptions?.map((description) => description.key)).toEqual([
      'NSCameraUsageDescription',
      'NSPhotoLibraryUsageDescription',
      'NSMicrophoneUsageDescription',
      'NSLocationWhenInUseUsageDescription',
    ]);
    const findings = permissionFindings(app);
    expect(findings.filter((finding) => finding.ruleId === 'permission/empty-usage-description').map((finding) => finding.evidence)).toEqual([
      'NSPhotoLibraryUsageDescription',
    ]);
    expect(findings.filter((finding) => finding.ruleId === 'permission/placeholder-usage-description').map((finding) => finding.evidence)).toEqual([
      'Allow $(PRODUCT_NAME) to access your camera',
      'TODO: add a reason',
    ]);
  });

  it('flags a bare generic access sentence with no purpose', async () => {
    const app = await readIpa({ NSCameraUsageDescription: 'Allow Demo to access your camera.' });
    expect(permissionFindings(app).map((finding) => finding.ruleId)).toEqual(['permission/placeholder-usage-description']);
  });

  it('flags a lorem ipsum description', async () => {
    const app = await readIpa({ NSCameraUsageDescription: 'Lorem ipsum dolor sit amet.' });
    expect(permissionFindings(app).map((finding) => finding.ruleId)).toEqual(['permission/placeholder-usage-description']);
  });

  it('does not flag a specific description', async () => {
    const app = await readIpa({
      NSCameraUsageDescription: 'We use the camera to scan receipts so you can add expenses without typing them.',
    });
    expect(permissionFindings(app)).toEqual([]);
  });

  it('does not flag a missing description (that harder check is out of scope)', async () => {
    const app = await readIpa({});
    expect(app.permissionUsageDescriptions).toBeUndefined();
    expect(permissionFindings(app)).toEqual([]);
  });
});
