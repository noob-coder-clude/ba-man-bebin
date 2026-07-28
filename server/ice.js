/**
 * ICE configuration for the WebRTC calls (phase 2).
 *
 * Why this lives on the server:
 *   1. TURN credentials must NOT be hard-coded in the front-end bundle —
 *      anyone could lift them and burn your relay quota. The browser asks
 *      /api/ice at call time instead.
 *   2. The deployment can gain (or lose) TURN later with nothing but an
 *      .env edit and a restart — no code change, no rebuild.
 *
 * Reality check for the current box: it sits behind the boxd proxy, which
 * only forwards 80/443 (TCP). The UDP ports a TURN server needs
 * (3478, 5349, 49152-65535) are simply not reachable, so we cannot host
 * TURN here. Plain STUN covers roughly 85-90% of peers; the rest need an
 * external TURN relay, which is exactly what these env vars are for.
 */

/** Public STUN servers used when the operator does not override them. */
const DEFAULT_STUN = [
  'stun:stun.cloudflare.com:3478',
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
];

const VALID_SCHEME = /^(stun|stuns|turn|turns):/i;

/** "a, b ,, c" → ['a','b','c'] */
function splitList(raw) {
  return String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Pick the credential for url #i.
 * One username/password → shared by every URL (the common case).
 * A matching list → index-paired with the URLs (several providers at once).
 */
function pick(list, index) {
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  return list[index] ?? list[list.length - 1];
}

/**
 * Build the iceServers array from the environment.
 *
 *   TURN_URL=turns:relay.example.com:443?transport=tcp,turn:relay.example.com:3478
 *   TURN_USER=user1,user2      # a single value is reused for every URL
 *   TURN_PASS=pass1,pass2
 *   STUN_URL=stun:stun.example.com:3478   # optional, replaces the defaults
 */
export function buildIceServers() {
  const stunUrls = splitList(process.env.STUN_URL);
  const turnUrls = splitList(process.env.TURN_URL);
  const users = splitList(process.env.TURN_USER);
  const passes = splitList(process.env.TURN_PASS);

  const servers = [];

  const stun = (stunUrls.length ? stunUrls : DEFAULT_STUN).filter((u) => VALID_SCHEME.test(u));
  if (stun.length) servers.push({ urls: stun });

  turnUrls.forEach((url, index) => {
    if (!VALID_SCHEME.test(url)) return;
    const entry = { urls: url };
    const username = pick(users, index);
    const credential = pick(passes, index);
    if (username) entry.username = username;
    if (credential) entry.credential = credential;
    servers.push(entry);
  });

  return { servers, turn: turnUrls.length > 0 };
}

/** Mounts GET /api/ice — the browser's only source of ICE servers. */
export function handleIce(app) {
  app.get('/api/ice', (_req, res) => {
    const { servers, turn } = buildIceServers();
    // Credentials are often short-lived; never let a proxy cache them.
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      iceServers: servers,
      turn,
      // Without a relay some peers simply cannot connect; the client uses
      // this flag to explain *why* instead of failing silently.
      relayAvailable: turn,
      iceTransportPolicy: 'all',
    });
  });
}
