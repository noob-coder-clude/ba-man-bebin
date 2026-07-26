/**
 * Mirror (multi-domain) support — client side.
 *
 * All domains point at the same server, so switching mirrors never changes
 * the room you are in. The browser races every mirror's /ping endpoint and
 * remembers which ones answered, because only the visitor's own network can
 * tell us what is actually reachable from where they are.
 */

const STORAGE_KEY = 'bmb.mirror';
const CACHE_KEY = 'bmb.mirrorCheck';
const CACHE_TTL_MS = 1000 * 60 * 30;
const PING_TIMEOUT_MS = 4000;

let config = null;

export async function loadConfig() {
  if (config) return config;
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    config = await res.json();
  } catch {
    config = { current: location.hostname, domains: [location.hostname], multiDomain: false };
  }
  return config;
}

/** Does this domain answer for *this* visitor? */
export async function ping(domain) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch(`https://${domain}/ping`, {
      signal: controller.signal,
      cache: 'no-store',
      mode: 'cors',
      credentials: 'omit',
    });
    if (!res.ok) return { domain, ok: false };
    await res.json();
    return { domain, ok: true, ms: Math.round(performance.now() - started) };
  } catch {
    // Blocked, filtered, DNS-poisoned, TLS-intercepted or simply down —
    // from the browser's point of view these are indistinguishable, and
    // for our purposes they all mean the same thing: unusable.
    return { domain, ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Ping every mirror in parallel and sort the winners by latency. */
export async function checkAll(domains) {
  const results = await Promise.all(domains.map(ping));
  const reachable = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms);
  return { results, reachable, fastest: reachable[0] || null };
}

function readCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;
  } catch { /* ignore */ }
  return null;
}

function writeCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, at: Date.now() }));
  } catch { /* private mode */ }
}

export function preferredMirror() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function rememberMirror(domain) {
  try {
    localStorage.setItem(STORAGE_KEY, domain);
  } catch { /* ignore */ }
}

/**
 * Rewrite a URL onto another mirror, preserving path + query so an invite
 * link keeps pointing at the same room.
 */
export function urlOnMirror(domain, url = location.href) {
  const target = new URL(url);
  target.hostname = domain;
  target.port = '';
  target.protocol = 'https:';
  return target.toString();
}

/**
 * Give the visitor the best invite link we can:
 * the mirror they are already using if it works, otherwise the fastest one.
 */
export async function bestInviteLink() {
  const cfg = await loadConfig();
  if (!cfg.multiDomain) return location.href;

  const cached = readCache();
  const fastest = cached?.fastest || (await checkAll(cfg.domains)).fastest;
  if (!cached && fastest) writeCache({ fastest });

  if (!fastest || fastest.domain === cfg.current) return location.href;
  return urlOnMirror(fastest.domain);
}

/**
 * Verify the current mirror is healthy and find alternatives if it is not.
 * Runs quietly in the background; the UI only reacts when something is wrong.
 */
export async function evaluateMirrors({ onResult } = {}) {
  const cfg = await loadConfig();
  if (!cfg.multiDomain) return null;

  const cached = readCache();
  if (cached?.results) {
    onResult?.(cached);
    return cached;
  }

  const outcome = await checkAll(cfg.domains);
  const data = {
    ...outcome,
    current: cfg.current,
    currentOk: outcome.results.find((r) => r.domain === cfg.current)?.ok ?? true,
  };
  writeCache(data);
  onResult?.(data);
  return data;
}
