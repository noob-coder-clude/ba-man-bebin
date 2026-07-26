/**
 * Guards for the streaming proxy.
 *
 * The proxy accepts arbitrary user-supplied URLs, which makes it a classic
 * SSRF target: without checks somebody could ask our server to fetch
 * http://169.254.169.254/ (cloud metadata) or http://127.0.0.1:6379/ (redis)
 * and read the response. So every hostname is resolved to real IP addresses
 * and every address is checked against the reserved/private ranges before a
 * single byte is fetched — and again after each redirect hop.
 */

import dns from 'node:dns/promises';
import net from 'node:net';

const ipToLong = (ip) => ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);

const inV4Range = (ip, cidr) => {
  const [range, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
};

// Everything that must never be reachable through the proxy.
const BLOCKED_V4 = [
  '0.0.0.0/8', // "this" network
  '10.0.0.0/8', // private
  '100.64.0.0/10', // carrier-grade NAT
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local + cloud metadata
  '172.16.0.0/12', // private
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // TEST-NET-1
  '192.168.0.0/16', // private
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // TEST-NET-2
  '203.0.113.0/24', // TEST-NET-3
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved / broadcast
];

/**
 * Opt-in escape hatch for people who self-host their media on the same
 * machine or LAN (Jellyfin, a NAS, a local nginx). Off by default because
 * enabling it turns the proxy into an SSRF gateway to your internal network.
 */
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_MEDIA_HOSTS === '1';

export function isBlockedAddress(address) {
  if (!address) return true;
  if (ALLOW_PRIVATE) return false;

  let ip = address;
  // Normalise IPv4-mapped IPv6 (::ffff:127.0.0.1) down to plain IPv4.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) ip = mapped[1];

  const version = net.isIP(ip);
  if (version === 4) return BLOCKED_V4.some((cidr) => inV4Range(ip, cidr));

  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true; // unspecified / loopback
    const head = lower.split(':')[0];
    if (/^f[cd]/.test(head)) return true; // fc00::/7 unique-local
    if (/^fe[89ab]/.test(head)) return true; // fe80::/10 link-local
    if (/^ff/.test(head)) return true; // ff00::/8 multicast
    return false;
  }

  return true; // not a valid IP literal
}

/**
 * Validate a user-supplied URL and resolve it to safe IP addresses.
 * Throws an Error with a machine-readable `.code` when the URL must be refused.
 */
export async function assertSafeUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    const err = new Error('invalid_url');
    err.code = 'invalid_url';
    throw err;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    const err = new Error('unsupported_protocol');
    err.code = 'unsupported_protocol';
    throw err;
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  // Literal IP in the URL: check it directly, no DNS needed.
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      const err = new Error('blocked_address');
      err.code = 'blocked_address';
      throw err;
    }
    return { url, addresses: [hostname] };
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    const err = new Error('dns_failed');
    err.code = 'dns_failed';
    throw err;
  }

  if (!records.length) {
    const err = new Error('dns_failed');
    err.code = 'dns_failed';
    throw err;
  }

  // If *any* resolved address is internal we refuse: a hostname that returns
  // both a public and a private A record is a rebinding attempt.
  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      const err = new Error('blocked_address');
      err.code = 'blocked_address';
      throw err;
    }
  }

  return { url, addresses: records.map((r) => r.address) };
}

/** Follow redirects by hand so each hop can be re-validated. */
export async function safeFetch(rawUrl, options = {}, maxHops = 5) {
  let current = rawUrl;

  for (let hop = 0; hop <= maxHops; hop += 1) {
    const { url } = await assertSafeUrl(current);

    const response = await fetch(url, { ...options, redirect: 'manual' });

    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get('location');

    if (!isRedirect || !location) return { response, finalUrl: url.toString() };

    // Drain the redirect body so the socket can be reused.
    response.body?.cancel?.().catch(() => {});
    current = new URL(location, url).toString();
  }

  const err = new Error('too_many_redirects');
  err.code = 'too_many_redirects';
  throw err;
}
