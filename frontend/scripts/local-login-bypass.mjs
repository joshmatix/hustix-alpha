import fs from 'fs';
import path from 'path';

const flagPath = path.join(process.cwd(), '.local-login-bypass');
const standInEmail = 'joshmatix@yahoo.com';
const command = process.argv[2];

if (command === 'enable') {
  fs.writeFileSync(flagPath, `${standInEmail}\n`, { mode: 0o600 });
  console.log(`local-login-bypass:enable`);
  console.log(`Local login bypass is on for ${standInEmail}.`);
  console.log('Open http://127.0.0.1:3000/dashboard');
} else if (command === 'disable') {
  fs.rmSync(flagPath, { force: true });
  console.log('local-login-bypass:disable');
  console.log('Local login bypass is off. Sign-in is required again.');
} else {
  console.error('Use: npm run local-login-bypass:enable');
  console.error('Or:  npm run local-login-bypass:disable');
  process.exit(1);
}
