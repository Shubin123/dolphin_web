import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createLobbyHandler } from '../tools/lan-lobbies.mjs';

test('play server gates sessions, lists only public rooms, enforces invitations, roles, capacity and expiry', async () => {
  let time = 0;
  const handle = createLobbyHandler({ now: () => time, ttl: 15000 });
  const server = createServer(handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/lan-api/`;
  async function request(action, token, body) {
    const response = await fetch(base + action, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  }
  try {
    assert.equal((await request('poll')).status, 401);
    const a = (await request('connect', '', {})).token;
    const b = (await request('connect', '', {})).token;
    const c = (await request('connect', '', {})).token;
    const privateRoom = await request('create', a, { name: 'Private', public: false });
    assert.deepEqual((await request('poll', b)).lobbies, []);
    assert.equal((await request('join', b, { code: privateRoom.room })).status, 400);
    assert.equal((await request('join', b, { code: privateRoom.invite })).status, 200);
    assert.equal((await request('join', c, { code: privateRoom.invite })).status, 400);
    assert.equal((await request('poll', a)).events[0].type, 'peer-joined');
    assert.equal((await request('signal', b, { description: { type: 'offer', sdp: 'bad role' } })).status, 400);
    await request('signal', a, { description: { type: 'offer', sdp: 'test' } });
    assert.equal((await request('poll', b)).events[0].description.sdp, 'test');
    await request('disconnect', a, {});
    assert.equal((await request('poll', b)).room, null);
    const publicRoom = await request('create', b, { name: 'Public', public: true });
    assert.equal((await request('poll', c)).lobbies[0].id, publicRoom.room);
    assert.equal((await request('join', c, { code: publicRoom.room })).status, 200);
    await request('leave', c, {});
    assert.equal((await request('poll', b)).events.some(event => event.type === 'peer-left'), true);
    time = 15001;
    assert.equal((await request('poll', b)).status, 401);
    const d = (await request('connect', '', {})).token;
    assert.deepEqual((await request('poll', d)).lobbies, []);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
