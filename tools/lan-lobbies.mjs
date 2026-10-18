import { randomBytes } from 'node:crypto';
const id = () => randomBytes(18).toString('base64url');

// In-memory two-device remote-play lobbies. Tokens and private invitations are
// independent capabilities; private rooms are never returned by discovery.
export function createLobbyHandler({ now = Date.now, ttl = 15000 } = {}) {
  const clients = new Map(), rooms = new Map();
  function leave(client) {
    const room = rooms.get(client.room);
    client.room = null;
    if (!room) return;
    if (room.host === client.token) {
      rooms.delete(room.id);
      const guest = clients.get(room.guest);
      if (guest) { guest.room = null; guest.events.push({ type: 'closed' }); }
    } else { room.guest = null; clients.get(room.host)?.events.push({ type: 'peer-left' }); }
  }
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/lan-api/')) return false;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return true; }
    const reply = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      for (const client of clients.values()) if (now() - client.seen > ttl) { leave(client); clients.delete(client.token); }
      let body = {};
      if (req.method === 'POST') {
        let data = '';
        for await (const chunk of req) { data += chunk; if (data.length > 65536) throw Error('Request too large'); }
        body = JSON.parse(data || '{}');
      }
      const action = url.pathname.slice('/lan-api/'.length);
      if (action === 'connect' && req.method === 'POST') {
        if (clients.size >= 256) throw Error('Server full');
        const token = id(); clients.set(token, { token, seen: now(), room: null, events: [] });
        reply(200, { token }); return true;
      }
      const client = clients.get((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (!client) { reply(401, { error: 'Play-server session expired. Connect again.' }); return true; }
      client.seen = now();
      if (action === 'poll' && req.method === 'GET') {
        reply(200, { room: client.room, events: client.events.splice(0), lobbies: [...rooms.values()].filter(room => room.public).map(room => ({ id: room.id, name: room.name, full: Boolean(room.guest) })) });
      } else if (action === 'create' && req.method === 'POST') {
        leave(client);
        const room = { id: id(), invite: id(), host: client.token, guest: null, public: body.public === true, name: String(body.name || 'LAN game').slice(0, 60) };
        rooms.set(room.id, room); client.room = room.id;
        reply(200, { room: room.id, invite: room.invite });
      } else if (action === 'join' && req.method === 'POST') {
        const room = [...rooms.values()].find(room => room.public && room.id === body.code || room.invite === body.code);
        if (!room || room.guest || room.host === client.token) throw Error('Lobby unavailable or full');
        leave(client); room.guest = client.token; client.room = room.id;
        clients.get(room.host)?.events.push({ type: 'peer-joined' }); reply(200, { room: room.id });
      } else if (action === 'signal' && req.method === 'POST') {
        const room = rooms.get(client.room);
        const description = body.description;
        if (!room || !description || typeof description.sdp !== 'string' || description.sdp.length > 60000 || !['offer', 'answer'].includes(description.type)) throw Error('Invalid lobby signal');
        const isHost = room.host === client.token;
        if ((description.type === 'offer') !== isHost) throw Error('Invalid signaling role');
        const other = clients.get(isHost ? room.guest : room.host);
        if (!other || other.events.length >= 32) throw Error('Peer unavailable');
        other.events.push({ type: 'signal', description }); reply(200, { ok: true });
      } else if (action === 'leave' && req.method === 'POST') { leave(client); reply(200, { ok: true });
      } else if (action === 'disconnect' && req.method === 'POST') { leave(client); clients.delete(client.token); reply(200, { ok: true });
      } else reply(404, { error: 'Unknown play-server operation' });
    } catch (error) { reply(400, { error: error.message }); }
    return true;
  };
}
