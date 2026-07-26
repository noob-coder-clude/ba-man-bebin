/**
 * Multi-domain support.
 *
 * One server, many domains. Every domain in PUBLIC_DOMAINS is served by this
 * same process, so a room created on one domain is the *same* room on all the
 * others — visitors simply use whichever domain is reachable for them.
 *
 * Why not redirect by IP?
 *   If a domain is filtered/blocked in someone's country, their request never
 *   reaches this server, so there is nothing left to redirect. A server-side
 *   GeoIP redirect can only ever help people who could already connect.
 *   The reliable test is done *in the visitor's browser*: it races the mirrors
 *   and keeps whichever actually answers. GeoIP is used only as a soft hint.
 */

const parseList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean);

const DOMAINS = parseList(process.env.PUBLIC_DOMAINS);

/**
 * Optional per-country preference, e.g.
 *   DOMAIN_HINTS="IR=film.ir,DE=watch.example.com"
 * Used only to *suggest* a mirror, never to force one.
 */
const HINTS = Object.fromEntries(
  String(process.env.DOMAIN_HINTS || '')
    .split(',')
    .map((pair) => pair.split('='))
    .filter((parts) => parts.length === 2)
    .map(([country, domain]) => [country.trim().toUpperCase(), domain.trim().toLowerCase()]),
);

/** The hostname the current request came in on (respects the reverse proxy). */
export function requestHost(req) {
  const forwarded = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  return (forwarded || req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
}

/**
 * Visitor country, taken from the CDN when available.
 * Cloudflare sets CF-IPCountry for free on every plan; other CDNs use their
 * own header. No GeoIP database to ship or keep up to date.
 */
export function requestCountry(req) {
  const raw =
    req.headers['cf-ipcountry'] ||
    req.headers['x-vercel-ip-country'] ||
    req.headers['x-country-code'] ||
    '';
  const code = String(raw).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function listDomains() {
  return [...DOMAINS];
}

/**
 * Build the client bootstrap config: every mirror, the one in use right now,
 * and (if the CDN told us the country) a soft suggestion.
 */
export function clientConfig(req) {
  const current = requestHost(req);
  const country = requestCountry(req);

  // Always include the host actually being used, even if it isn't configured —
  // otherwise a freshly added domain would look "unknown" to its own visitors.
  const domains = [...new Set([...DOMAINS, current].filter(Boolean))];

  const hinted = country ? HINTS[country] : null;
  const suggested = hinted && domains.includes(hinted) && hinted !== current ? hinted : null;

  return {
    current,
    domains,
    country,
    suggested,
    multiDomain: domains.length > 1,
  };
}
