import assert from 'node:assert/strict';
import test from 'node:test';
import {waitForBackendRuntime} from '../tools/backend-runtime-readiness.mjs';

const run = (head, status = 'completed', conclusion = 'success') => ({id:42,head_sha:head,status,conclusion,event:'push'});
function fixture({head = () => 'current', runs, timeoutMs = 100}) {
  let elapsed = 0;
  let polls = 0;
  return {
    readHead: head,
    readRuns: () => runs(polls++),
    now: () => elapsed,
    sleep: async ms => { elapsed += ms; },
    pollMs: 10, timeoutMs, discoveryMs: 30
  };
}

test('Pages waits for queued and running backend builds instead of deploying stale artifacts', async () => {
  const result = await waitForBackendRuntime(fixture({runs: poll => [
    run('old'), run('current', poll === 0 ? 'queued' : poll === 1 ? 'in_progress' : 'completed')
  ]}));
  assert.equal(result.head, 'current');
  assert.equal(result.run.head_sha, 'current');
  assert.equal(result.run.status, 'completed');
});

test('Pages tolerates delayed workflow discovery and excludes pull-request artifacts', async () => {
  const result = await waitForBackendRuntime(fixture({runs: poll => poll < 2 ? [
    {...run('current'),event:'pull_request'}
  ] : [run('current')]}));
  assert.equal(result.run.event, 'push');
});

test('a newer backend main must finish its own build before Pages proceeds', async () => {
  let polls = 0;
  let reads = 0;
  const result = await waitForBackendRuntime(fixture({
    head: () => reads++ ? 'new' : 'current',
    runs: () => { polls++; return [run(polls < 2 ? 'current' : 'new')]; }
  }));
  assert.equal(result.head, 'new');
  assert.equal(result.run.head_sha, 'new');
});

test('failed backend builds, missing workflows and wait timeouts retain the deployed site', async () => {
  await assert.rejects(waitForBackendRuntime(fixture({runs: () => [run('current','completed','failure')]})), /Fix or rerun backend CI/);
  await assert.rejects(waitForBackendRuntime(fixture({runs: () => []})), /has no runtime build/);
  await assert.rejects(waitForBackendRuntime(fixture({runs: () => [run('current','in_progress',null)],timeoutMs:20})), /Timed out waiting/);
});
