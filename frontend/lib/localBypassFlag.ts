import fs from 'fs';
import path from 'path';

export const LOCAL_STAND_IN_EMAIL = 'joshmatix@yahoo.com';

/** True only while `npm run local-login-bypass:enable` has written the flag file. */
export function localLoginBypassEnabled() {
  try {
    const flagPath = path.join(process.cwd(), '.local-login-bypass');
    if (!fs.existsSync(flagPath)) return false;
    return fs.readFileSync(flagPath, 'utf8').trim() === LOCAL_STAND_IN_EMAIL;
  } catch {
    return false;
  }
}
