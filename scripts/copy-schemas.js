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
  'permission-error.json',
  'permission-policy.json',
]) {
  copyFileSync(join(src, file), join(dest, file));
}

mkdirSync('dist/templates', { recursive: true });
copyFileSync(
  join('src/templates', 'shared-preamble.md'),
  join('dist/templates', 'shared-preamble.md'),
);
copyFileSync(
  join('src/templates', 'retros-readme.md'),
  join('dist/templates', 'retros-readme.md'),
);
copyFileSync(
  join('src/templates', 'agents-registry.json'),
  join('dist/templates', 'agents-registry.json'),
);

// Bundle AGENTS_README.md so `minih agent-readme` can dump it on any project.
copyFileSync('AGENTS_README.md', 'dist/AGENTS_README.md');
