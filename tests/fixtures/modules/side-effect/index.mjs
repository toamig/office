import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Runs the moment the file is imported: proves that nothing is imported before a module is enabled.
writeFileSync(join(import.meta.dirname, "imported.marker"), "imported");

export default {
  kind: "channel",
  create() {
    return { id: "side-effect", send() {} };
  },
};
