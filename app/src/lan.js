import { createPlayServer } from "./lan-server.js";
// Direct, manually paired WebRTC session. No discovery service or public relay.
export const MAX_SAVE = 64 * 1024 * 1024;
export function createLanSession({ onStatus = () => {}, onTrack = () => {}, onControls = () => {}, onSave = () => {}, onConnected = () => {} } = {}) {
  let peer, channel, stream, receiving, host = false, sending = false;
  const connected = () => channel?.readyState === 'open';
  function close() {
    const old = peer; peer = null;
    channel?.close(); channel = null; old?.close();
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    receiving = null; sending = false; onControls([]); onConnected(false); onStatus('Disconnected.');
  }
  function wire(dc) {
    channel = dc; dc.binaryType = 'arraybuffer';
    dc.onopen = () => { if (channel !== dc) return; onConnected(true); onStatus('Connected directly.'); };
    dc.onclose = () => { if (channel !== dc) return; onControls([]); receiving = null; onConnected(false); onStatus('Disconnected.'); };
    dc.onmessage = event => {
      if (channel !== dc) return;
      try {
        if (typeof event.data === 'string') {
          const message = JSON.parse(event.data);
          if (message.type === 'controls' && host && Array.isArray(message.buttons) && message.buttons.length <= 32) onControls(message.buttons);
          if (message.type === 'save') {
            if (receiving || !Number.isSafeInteger(message.size) || message.size < 1 || message.size > MAX_SAVE || typeof message.name !== 'string' || !message.name.endsWith('.sav')) throw Error('Invalid save transfer');
            receiving = { name: message.name.split(/[\\/]/).pop().slice(0, 120), size: message.size, chunks: [], received: 0 };
          }
        } else {
          if (!receiving || !(event.data instanceof ArrayBuffer) || receiving.received + event.data.byteLength > receiving.size) throw Error('Invalid save data');
          receiving.chunks.push(event.data); receiving.received += event.data.byteLength;
          if (receiving.received === receiving.size) {
            const file = new File(receiving.chunks, receiving.name); receiving = null; onSave(file); onStatus('Save received. Download or load it explicitly.');
          }
        }
      } catch (error) { receiving = null; onStatus(error.message); }
    };
  }
  async function localDescription() {
    if (peer.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
      const current = peer;
      const timer = setTimeout(() => { current.removeEventListener('icegatheringstatechange', changed); reject(Error('Connection gathering timed out; retry.')); }, 15000);
      function changed() { if (current.iceGatheringState === 'complete') { clearTimeout(timer); current.removeEventListener('icegatheringstatechange', changed); resolve(); } }
      current.addEventListener('icegatheringstatechange', changed); changed();
    });
    return JSON.stringify(peer.localDescription);
  }
  function start(isHost) {
    close(); host = isHost;
    peer = new RTCPeerConnection({ iceServers: [] });
    peer.ondatachannel = event => wire(event.channel);
    peer.ontrack = event => onTrack(event.streams[0]);
    peer.onconnectionstatechange = () => { if (peer && ['failed', 'disconnected'].includes(peer.connectionState)) close(); };
  }
  return {
    get connected() { return connected(); }, close,
    async offer(canvas) {
      start(true);
      try {
        stream = canvas.captureStream(30);
        stream.getTracks().forEach(track => peer.addTrack(track, stream));
        wire(peer.createDataChannel('dolphin-lan'));
        await peer.setLocalDescription(await peer.createOffer()); return await localDescription();
      } catch (error) { close(); throw error; }
    },
    async answer(code) {
      start(false);
      try {
        const description = JSON.parse(code); if (description.type !== 'offer') throw Error('Paste a host offer.');
        await peer.setRemoteDescription(description); await peer.setLocalDescription(await peer.createAnswer()); return await localDescription();
      } catch (error) { close(); throw error; }
    },
    async accept(code) {
      if (!peer || !host) throw Error('Create a host offer first.');
      const description = JSON.parse(code); if (description.type !== 'answer') throw Error('Paste a guest answer.');
      await peer.setRemoteDescription(description);
    },
    controls(buttons) { if (connected() && !host) channel.send(JSON.stringify({ type: 'controls', buttons })); },
    async sendSave(file) {
      if (!connected() || sending) throw Error('Connect first and wait for any transfer to finish.');
      if (!file.name.endsWith('.sav') || !file.size || file.size > MAX_SAVE) throw Error('Choose a .sav file up to 64 MB.');
      sending = true;
      const dc = channel;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        dc.send(JSON.stringify({ type: 'save', name: file.name, size: bytes.length }));
        for (let offset = 0; offset < bytes.length; offset += 16384) {
          while (dc.bufferedAmount > 262144) { if (dc.readyState !== 'open') throw Error('Transfer disconnected.'); await new Promise(resolve => setTimeout(resolve, 20)); }
          dc.send(bytes.subarray(offset, offset + 16384));
        }
        onStatus('Save sent.');
      } finally { sending = false; }
    }
  };
}

export function wireLanWidgets({ host, getCanvas, controls, allowedControls, loadSave }) {
  const root = document.querySelector('#lanPlay');
  const status = document.querySelector('#lanStatus');
  const video = document.querySelector('#lanVideo');
  const lobbyActions = document.querySelector('#lanLobbyActions');
  const saveActions = document.querySelector('#lanSaveActions');
  let room = null; let hosting = false;
  const serverUrl = document.querySelector('#lanServerUrl');
  serverUrl.value = location.origin;
  let received;
  const report = message => { status.textContent = message; };
  const allowed = () => server.connected && Boolean(room);
  const resetPeer = () => { session.close(); video.srcObject = null; video.hidden = true; received = null; saveActions.disabled = true; document.querySelector('#lanReceived').textContent = 'No save received.'; document.querySelector('#lanDownload').disabled = true; document.querySelector('#lanLoad').disabled = true; };
  const run = operation => Promise.resolve().then(operation).catch(error => report(error.message));
  const session = createLanSession({ onStatus: report, onControls: buttons => controls(allowed() ? buttons.filter(button => allowedControls.includes(button)) : []),
    onTrack: stream => { if (!allowed()) return; video.srcObject = stream; video.hidden = false; video.play().catch(() => report('Press play on the remote video.')); },
    onSave: file => { if (!allowed()) return; received = file; document.querySelector('#lanReceived').textContent = `${file.name} (${file.size} bytes)`; document.querySelector('#lanDownload').disabled = false; document.querySelector('#lanLoad').disabled = false; },
    onConnected: value => { if (!value) { received = null; document.querySelector('#lanReceived').textContent = 'No save received.'; document.querySelector('#lanDownload').disabled = true; document.querySelector('#lanLoad').disabled = true; video.srcObject = null; video.hidden = true; } saveActions.disabled = !value || !allowed(); root.querySelectorAll('[data-lan-control]').forEach(button => { button.disabled = !value || !allowed(); }); }
  });
  const server = createPlayServer({
    onDisconnect: message => { room = null; hosting = false; resetPeer(); lobbyActions.disabled = true; document.querySelector('#lanRoom').textContent = 'No lobby joined.'; document.querySelector('#lanLobbies').replaceChildren(); report(message || 'Play server disconnected.'); },
    onUpdate: async update => {
      lobbyActions.disabled = false;
      if (room && update.room !== room) { room = null; resetPeer(); document.querySelector('#lanRoom').textContent = 'Lobby closed.'; }
      const list = document.querySelector('#lanLobbies'); list.replaceChildren();
      for (const lobby of update.lobbies) {
        const row = document.createElement('li'); const join = document.createElement('button'); join.type = 'button'; join.textContent = `${lobby.name}${lobby.full ? ' (full)' : ''}`; join.disabled = lobby.full || lobby.id === room;
        join.onclick = () => run(() => joinLobby(lobby.id)); row.append(join); list.append(row);
      }
      for (const event of update.events) {
        if (event.type === 'closed') { room = null; resetPeer(); }
        if (event.type === 'peer-left') resetPeer();
        if (event.type === 'peer-joined' && hosting && allowed()) {
          const offer = await session.offer(getCanvas());
          await server.request('signal', { description: JSON.parse(offer) });
        }
        if (event.type === 'signal' && allowed()) {
          if (event.description.type === 'offer' && !hosting) {
            const answer = await session.answer(JSON.stringify(event.description));
            await server.request('signal', { description: JSON.parse(answer) });
          } else if (event.description.type === 'answer' && hosting) await session.accept(JSON.stringify(event.description));
        }
      }
    }
  });
  async function joinLobby(code) {
    resetPeer();
    const result = await server.request('join', { code }); room = result.room; hosting = false;
    document.querySelector('#lanRoom').textContent = `Joined lobby ${room}`;
    report('Waiting for the host connection.');
  }
  document.querySelector('#lanConnect').onclick = () => run(async () => { await server.connect(serverUrl.value); if (server.connected) report('Connected to play server. Host or join a lobby.'); });
  document.querySelector('#lanHost').onclick = () => run(async () => {
    if (!server.connected) throw Error('Connect to a play server first.');
    if (!host.game?.mounted) throw Error('Open a game before hosting.');
    resetPeer();
    const result = await server.request('create', { name: document.querySelector('#lanLobbyName').value, public: document.querySelector('#lanPublic').checked });
    room = result.room; hosting = true;
    document.querySelector('#lanRoom').textContent = `Lobby ${room}. Private invitation: ${result.invite}`;
    report('Lobby open. Waiting for a guest.');
  });
  document.querySelector('#lanJoin').onclick = () => run(() => joinLobby(document.querySelector('#lanInvite').value.trim()));
  document.querySelector('#lanLeave').onclick = () => run(async () => { await server.request('leave', {}); room = null; hosting = false; resetPeer(); document.querySelector('#lanRoom').textContent = 'No lobby joined.'; });
  document.querySelector('#lanDisconnect').onclick = () => server.disconnect();
  const pressed = new Set();
  for (const label of allowedControls) {
    const button = document.createElement('button'); button.textContent = label; button.type = 'button'; button.disabled = true; button.dataset.lanControl = label;
    button.onpointerdown = event => { button.setPointerCapture(event.pointerId); pressed.add(label); if (allowed()) session.controls([...pressed]); };
    const release = () => { pressed.delete(label); if (allowed()) session.controls([...pressed]); };
    button.onpointerup = release; button.onpointercancel = release; button.onlostpointercapture = release;
    document.querySelector('#lanControls').append(button);
  }
  window.addEventListener('blur', () => { pressed.clear(); session.controls([]); });
  window.addEventListener('pagehide', () => server.disconnect());
  document.addEventListener('dolphin-canvas-replaced', () => session.close());
  document.querySelector('#lanSend').onchange = event => { const file = event.target.files[0]; if (file && allowed()) run(() => session.sendSave(file)); event.target.value = ''; };
  document.querySelector('#lanDownload').onclick = () => {
    if (!received || !allowed() || !session.connected) return;
    const url = URL.createObjectURL(received); const link = document.createElement('a'); link.href = url; link.download = received.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  document.querySelector('#lanLoad').onclick = () => run(async () => {
    if (!allowed() || !session.connected) throw Error('Join a connected play-server lobby first.');
    if (!host.game?.mounted) throw Error('Open the matching game first.');
    const result = await loadSave(received); if (!result?.loaded) throw Error(result?.error || 'Incompatible save.'); report('Received save loaded. Save to a slot to keep it.');
  });
  return session;
}
