import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const src = 'src/schemas';
const dest = 'dist/schemas';

mkdirSync(dest, { recursive: true });

for (const file of [
  'system-output.json',
  'retrospective.json',
  'inbox-message.json',
  'outside-state.json',
  'inside-state.json',
  'state-history-entry.json',
]) {
  copyFileSync(join(src, file), join(dest, file));
}
