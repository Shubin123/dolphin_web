// Deploy only an artifact built successfully from the backend's current main.
// A frontend push can race that build, so wait while it is queued or running.
export async function waitForBackendRuntime({
  readHead,
  readRuns,
  onProgress = () => {},
  now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs = 45 * 60 * 1000,
  pollMs = 30000,
  discoveryMs = 120000
}) {
  const started = now();
  let trackedHead;
  let discoveredAt = started;
  while (true) {
    const head = await readHead();
    if (head !== trackedHead) { trackedHead = head; discoveredAt = now(); }
    const runs = (await readRuns()).filter(run => run.head_sha === head && run.event !== 'pull_request');
    const successful = runs.find(run => run.status === 'completed' && run.conclusion === 'success');
    if (successful) {
      // Main may advance while workflow metadata is being fetched.
      if (await readHead() === head) return { head, run: successful };
      continue;
    }
    const active = runs.find(run => run.status !== 'completed');
    if (!active && runs.length) {
      throw new Error(`Backend ${head} runtime build ${runs[0].conclusion || 'failed'}: ${runs[0].html_url || runs[0].id}. Fix or rerun backend CI before deploying.`);
    }
    if (!active && now() - discoveredAt >= discoveryMs) {
      throw new Error(`Backend ${head} has no runtime build. Start the Backend runtime workflow before deploying.`);
    }
    const remaining = timeoutMs - (now() - started);
    if (remaining <= 0) throw new Error(`Timed out waiting for backend ${head} runtime build. The deployed site has been retained.`);
    onProgress(`Waiting for backend ${head.slice(0, 12)} runtime build (${active?.status || 'not yet listed'})${active?.html_url ? `: ${active.html_url}` : ''}`);
    await sleep(Math.min(pollMs, remaining));
  }
}
