// A sample Office module: a notification channel that appends every urgent notification to a file
// in its own data folder. Copy this folder to <Office data>/modules/sample-channel and enable it in
// Setup. Modules run with full access to your files and accounts, so only enable code you trust.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export default {
  kind: "channel",
  create(ctx) {
    mkdirSync(ctx.dataDir, { recursive: true });
    ctx.log("sample channel ready");
    return {
      id: "sample-channel",
      send(notification) {
        appendFileSync(
          join(ctx.dataDir, "received.log"),
          `${notification.kind}\t${notification.title}\n`,
        );
      },
    };
  },
};
