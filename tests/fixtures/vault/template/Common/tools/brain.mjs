// Fake brain validator for Office tests. Fails when a FAIL_VALIDATE file exists in the hub root.
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
if (process.argv[2] !== "validate") {
  console.log("fixture: only validate is implemented");
  process.exit(2);
}
if (existsSync(join(root, "FAIL_VALIDATE"))) {
  console.log("warn  tag 'x' is used once; consider merging it away");
  console.log("ERROR Alpha/OpenItems.md: broken link [[Alpha/Missing]]");
  console.log("\nhub: 6 files, 1 errors, 1 warnings, 0 external links");
  process.exit(1);
}
console.log("\nhub: 6 files, 0 errors, 0 warnings, 0 external links");
