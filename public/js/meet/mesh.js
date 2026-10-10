/* A meeting's media between pages: WebRTC, a mesh — this page holds one connection to every other page in the room and
   sends its microphone, camera and shared screen to each (modules/meetings/rooms.js says why six at most). The hub
   relays only the pages' messages to each other (offers, answers, ICE candidates) on the live feed.

   Negotiation is WebRTC's "perfect negotiation": either side may offer whenever its tracks change (a share started,
   a camera turned on); when two offers cross, the polite side (the larger page id) gives way. So a newcomer and
   the pages already there need no turn-taking, and a share started mid-call simply renegotiates.

   Order is kept both ways, because perfect negotiation assumes it: each message to a peer is sent only once the one
   before it reached the hub (separate POSTs race, and on a busy machine a candidate overtook its offer and was
   dropped — the Windows CI failure of 2026-10-10), each message from a peer is handled only once the one before it is
   done, and a candidate that still arrives before its description waits for it rather than being thrown away. A
   connection that fails restarts ICE once it is stable again, rather than staying dead.

   Offers do not cross when a connection is made: the impolite side (the smaller page id) offers first, and the polite
   side adds its own tracks only once that offer arrives, so they go out in its answer. Two offers crossing at the start
   made the polite side roll its own back while it gathered — and Android's WebView then gathered no candidate ever again
   for that connection (seen 2026-10-10 on an emulator rejoining a call; a restart of ICE did not revive it). A
   connection still not connected after 20 s is made again from scratch, the impolite side saying {reset} first.

   The interface is what a selective forwarding unit would also offer — add(peer), remove(peer), signal(from, data),
   setTracks(), close() — so a larger room can swap this file for an SFU client without the room's code changing.

   meetMesh({me, iceServers, send(to, data) → promise, onTrack(peer, track, stream), onState(peer, state)}) */
function meetMesh({ me, iceServers = [], send, onTrack, onState }) {
  const conns = new Map();   // peer → { pc, polite, ready, makingOffer, ignoreOffer, senders, out, early, restarts, resets, timer }
  const inbox = new Map();   // peer → the chain its messages are handled on (it outlives a connection made again)
  const resets = new Map();  // peer → how many times its connection was made again
  let tracks = [];           // [{ track, stream }] this page sends now
  const STUCK_MS = 20000;

  function conn(peer) {
    if (conns.has(peer)) return conns.get(peer);
    const pc = new RTCPeerConnection({ iceServers });
    const polite = me > peer;
    const c = { pc, polite, ready: !polite, makingOffer: false, ignoreOffer: false, senders: new Map(),
      out: Promise.resolve(), early: [], restarts: 0, timer: null };
    conns.set(peer, c);
    // One message after another to this peer: the hub relays them in the order it received them.
    c.post = data => { c.out = c.out.then(() => send(peer, data)).catch(() => {}); return c.out; };
    pc.onnegotiationneeded = async () => {
      try {
        c.makingOffer = true;
        await pc.setLocalDescription();
        c.post({ description: pc.localDescription });
      } catch (e) { console.warn('[meet] offer', e); } finally { c.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) c.post({ candidate }); };
    pc.ontrack = e => onTrack(peer, e.track, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      onState(peer, pc.connectionState);
      if (pc.connectionState === 'connected') c.restarts = 0;
      // A failed path (a network that changed, candidates lost on a busy machine): look for another, a few times.
      if (pc.connectionState === 'failed' && c.restarts < 3) { c.restarts++; try { pc.restartIce(); } catch { /* closed */ } }
    };
    if (c.ready) sync(c);
    // Nothing of ours to send: say we are here to receive, so the other side's tracks come.
    if (!tracks.length && !polite) {
      pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.addTransceiver('video', { direction: 'recvonly' });
    }
    // Still not connected after a while: the impolite side makes it again, from scratch (a few times).
    c.timer = setTimeout(() => {
      if (conns.get(peer) !== c || polite || pc.connectionState === 'connected' || (resets.get(peer) || 0) >= 3) return;
      resets.set(peer, (resets.get(peer) || 0) + 1);
      drop(peer);
      conn(peer).post({ reset: true });
    }, STUCK_MS);
    return c;
  }

  function drop(peer) { const c = conns.get(peer); if (!c) return; clearTimeout(c.timer); try { c.pc.close(); } catch { /* closed */ } conns.delete(peer); }

  /** Make a connection's senders match the tracks this page sends now. */
  function sync(c) {
    const want = new Set(tracks.map(t => t.track.id));
    for (const [id, sender] of c.senders) if (!want.has(id)) { try { c.pc.removeTrack(sender); } catch { /* closed */ } c.senders.delete(id); }
    for (const { track, stream } of tracks) if (!c.senders.has(track.id)) { try { c.senders.set(track.id, c.pc.addTrack(track, stream)); } catch { /* closed */ } }
  }

  async function handle(peer, { description, candidate, reset } = {}) {
    if (reset) { drop(peer); conn(peer); return; }   // the other side made it again: so do we, and wait for its offer
    const c = conn(peer), pc = c.pc;
    try {
      if (description) {
        const collision = description.type === 'offer' && (c.makingOffer || pc.signalingState !== 'stable');
        c.ignoreOffer = !c.polite && collision;
        if (c.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (!c.ready) { c.ready = true; sync(c); }   // the polite side's tracks, into its answer
        // Candidates that came before this description belong to it.
        for (const cand of c.early.splice(0)) await pc.addIceCandidate(cand).catch(() => {});
        if (description.type === 'offer') { await pc.setLocalDescription(); c.post({ description: pc.localDescription }); }
      } else if (candidate) {
        if (!pc.remoteDescription) { c.early.push(candidate); return; }
        try { await pc.addIceCandidate(candidate); } catch (e) { if (!c.ignoreOffer) throw e; }
      }
    } catch (e) { console.warn('[meet] signal', e); }
  }

  /** A peer's message, handled after every message it sent before. */
  function signal(from, data) {
    const next = (inbox.get(from) || Promise.resolve()).then(() => handle(from, data));
    inbox.set(from, next);
    return next;
  }

  return {
    add: peer => { conn(peer); },
    remove(peer) { drop(peer); inbox.delete(peer); resets.delete(peer); },
    signal,
    /** The tracks this page sends to everyone: [{track, stream}] — microphone, camera, a shared screen. */
    setTracks(list) { tracks = list.filter(t => t.track && t.track.readyState !== 'ended'); for (const c of conns.values()) if (c.ready) sync(c); },
    peers: () => [...conns.keys()],
    state: peer => conns.get(peer)?.pc.connectionState || null,
    /** What a connection is doing, for a test or a quality line: its states and how many candidates waited. */
    describe: peer => { const c = conns.get(peer); return c && { connection: c.pc.connectionState, ice: c.pc.iceConnectionState, gathering: c.pc.iceGatheringState,
      signaling: c.pc.signalingState, early: c.early.length, restarts: c.restarts, resets: resets.get(peer) || 0 }; },
    stats: peer => conns.get(peer)?.pc.getStats() || Promise.resolve(null),   // bytes in and out, for a test or a quality line
    close() { for (const p of [...conns.keys()]) this.remove(p); },
  };
}
