// Seeds the .dev/ folders used by `npm run dev` from tests/fixtures. Filled in by M1.2.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", ".dev");
for (const dir of ["home", "data", "workspace"]) mkdirSync(resolve(root, dir), { recursive: true });
