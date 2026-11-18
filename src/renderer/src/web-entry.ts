import { installWebBridge } from "./bridge/web-bridge";

// The web build: window.office comes from the test host, then the same app mounts as in the desktop build.
void installWebBridge().then(() => import("./main"));
