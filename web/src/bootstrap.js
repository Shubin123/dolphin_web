import { restoreSettingsHref } from './settings.js';
import {
  readWebGpuSyntheticRequest,
  runWebGpuSyntheticPage
} from "./wgpu-synthetic-diagnostics.js";

const request = readWebGpuSyntheticRequest(globalThis.location?.search || "");

if (request) {
  globalThis.__wgpuSyntheticDiagnostics = {
    schema: "wasm-dolphin.wgpu-synthetic.v1",
    status: "running",
    request
  };
  const promise = runWebGpuSyntheticPage({ request });
  globalThis.__wgpuSyntheticDiagnosticsPromise = promise;
  await promise;
} else {
  const href = restoreSettingsHref(window.location.href);
  if (href !== window.location.href) history.replaceState(history.state, '', href);
  await import("./app.js");
}
