import { mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const src = "src/schemas";
const dest = "dist/schemas";

mkdirSync(dest, { recursive: true });

for (const file of ["system-output.json", "retrospective.json"]) {
  copyFileSync(join(src, file), join(dest, file));
}
