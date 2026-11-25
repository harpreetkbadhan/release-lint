import { basename } from 'node:path';
import { ReleaseLintError, type AppModel } from '../types.js';
import { AAB_MANIFEST, APK_MANIFEST, readAab, readApk } from './android.js';
import { readIpa } from './ios.js';
import { openZip } from './zip.js';

/** Opens a built app (.ipa or .aab), detects the platform from its contents and reads the app model. */
export async function readApp(path: string): Promise<AppModel> {
  const zip = await openZip(path);
  try {
    const file = basename(path);
    if ([...zip.entries.keys()].some((name) => name.startsWith('Payload/'))) {
      return await readIpa(zip, file);
    }
    if (zip.entries.has(AAB_MANIFEST)) {
      return await readAab(zip, file);
    }
    if (zip.entries.has(APK_MANIFEST)) {
      return await readApk(zip, file);
    }
    throw new ReleaseLintError('Not an .ipa, .aab or .apk file');
  } finally {
    await zip.close();
  }
}
