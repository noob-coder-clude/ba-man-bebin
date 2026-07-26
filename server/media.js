/**
 * Media source detection, playability probing and proxy streaming.
 *
 * Three kinds of sources are supported:
 *   youtube  — embedded via the IFrame API
 *   direct   — mp4 / webm / m3u8 / mkv … played by <video>, optionally proxied
 *   torrent  — magnet or .torrent, streamed peer-to-peer in the browser
 */

import { safeFetch, assertSafeUrl } from './net-guard.js';

const VIDEO_EXTENSIONS = /\.(mp4|webm|ogv|ogg|m4v|mov|mkv|avi|flv|wmv|ts|m3u8|mpd)(\?|#|$)/i;

// Containers a browser <video> element can play natively.
const NATIVE_EXTENSIONS = /\.(mp4|webm|ogv|ogg|m4v|mov)(\?|#|$)/i;
const HLS_EXTENSIONS = /\.(m3u8)(\?|#|$)/i;

const PROBE_TIMEOUT_MS = 12000;
const PROXY_TIMEOUT_MS = 30000;

export function parseYouTubeId(input) {
  const value = String(input || '').trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  try {
    const u = new URL(value);
    if (!/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(u.hostname)) return null;
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.slice(1, 12);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    const v = u.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v.slice(0, 11))) return v.slice(0, 11);
    const m = u.pathname.match(/\/(embed|shorts|live|v)\/([\w-]{11})/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

/** Figure out what kind of source the user pasted. */
export function detectSource(input) {
  const value = String(input || '').trim();
  if (!value) return { kind: 'unknown' };

  if (/^magnet:\?/i.test(value)) {
    const name = decodeURIComponent(value.match(/[?&]dn=([^&]+)/)?.[1] || '').replace(/\+/g, ' ');
    const hash = value.match(/xt=urn:btih:([a-z0-9]+)/i)?.[1] || '';
    return { kind: 'torrent', value, title: name || 'Torrent', hash };
  }

  const youtubeId = parseYouTubeId(value);
  if (youtubeId) return { kind: 'youtube', value: youtubeId, title: '' };

  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { kind: 'unknown' };

    if (/\.torrent(\?|#|$)/i.test(u.pathname)) {
      return { kind: 'torrent', value, title: decodeURIComponent(u.pathname.split('/').pop() || 'Torrent') };
    }

    const isHls = HLS_EXTENSIONS.test(u.pathname);
    return {
      kind: 'direct',
      value,
      title: decodeURIComponent(u.pathname.split('/').pop() || u.hostname),
      hls: isHls,
      looksLikeVideo: VIDEO_EXTENSIONS.test(u.pathname),
      native: NATIVE_EXTENSIONS.test(u.pathname),
    };
  } catch {
    return { kind: 'unknown' };
  }
}

/**
 * Probe a direct link: is it reachable, does it look like video, and does it
 * support range requests (needed for seeking)?
 *
 * Returns a report the client uses to decide between direct playback and the
 * proxy — the whole point being that a link which is blocked or CORS-locked
 * for one viewer still plays for everyone through the server.
 */
export async function probeDirect(rawUrl) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  const headers = {
    // Some CDNs reject requests without a browser-ish UA.
    'user-agent': 'Mozilla/5.0 (compatible; BaManBebin/1.0; +https://github.com)',
    accept: '*/*',
  };

  try {
    let response;
    let finalUrl = rawUrl;

    try {
      ({ response, finalUrl } = await safeFetch(rawUrl, {
        method: 'HEAD',
        headers,
        signal: controller.signal,
      }));
    } catch (headError) {
      if (headError.code) throw headError;
      response = null;
    }

    // Many servers don't implement HEAD properly — fall back to a 1-byte GET.
    if (!response || response.status === 405 || response.status === 501 || !response.ok) {
      const ranged = await safeFetch(rawUrl, {
        method: 'GET',
        headers: { ...headers, range: 'bytes=0-1' },
        signal: controller.signal,
      });
      response?.body?.cancel?.().catch(() => {});
      response = ranged.response;
      finalUrl = ranged.finalUrl;
      response.body?.cancel?.().catch(() => {});
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const contentLength = Number(response.headers.get('content-length') || 0);
    const acceptRanges = (response.headers.get('accept-ranges') || '').toLowerCase();
    const allowOrigin = response.headers.get('access-control-allow-origin');

    const detected = detectSource(finalUrl);
    const isHls = detected.hls || contentType.includes('mpegurl') || contentType.includes('m3u8');
    const isVideoType = contentType.startsWith('video/') || contentType.includes('mp4') || isHls
      || contentType.includes('matroska') || contentType.includes('octet-stream');

    const ok = response.ok || response.status === 206;
    const seekable = acceptRanges.includes('bytes') || response.status === 206;
    const corsOpen = allowOrigin === '*' || Boolean(allowOrigin);

    // A container the browser can't decode natively (mkv/avi) still "works"
    // through the proxy for some codecs, but we warn instead of promising.
    const nativeContainer = detected.native || contentType.includes('mp4')
      || contentType.includes('webm') || isHls;

    return {
      ok,
      status: response.status,
      finalUrl,
      contentType: contentType || null,
      sizeBytes: contentLength || null,
      seekable,
      corsOpen,
      isHls,
      isVideoType,
      nativeContainer,
      // If CORS is closed the browser can't fetch it directly → use the proxy.
      recommendProxy: ok && !corsOpen,
      durationMs: Date.now() - started,
      warnings: [
        !isVideoType && ok ? 'not_video_content_type' : null,
        !nativeContainer && ok ? 'container_may_not_play' : null,
        !seekable && ok ? 'no_range_support' : null,
      ].filter(Boolean),
    };
  } catch (error) {
    return {
      ok: false,
      error: error.code || (error.name === 'AbortError' ? 'timeout' : 'unreachable'),
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stream a remote video through our server.
 *
 * This is what makes the site work "چه برای اونی که خارجه و چه ایران":
 * the viewer's browser only ever talks to our origin, so geo-blocks, CORS
 * policies and mixed-content rules on the source no longer matter. Range
 * headers are forwarded both ways so seeking keeps working.
 */
export async function proxyStream(rawUrl, req, res) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  // Abort the upstream request as soon as the viewer navigates away.
  const onClose = () => controller.abort();
  res.on('close', onClose);

  try {
    await assertSafeUrl(rawUrl);

    const headers = {
      'user-agent': 'Mozilla/5.0 (compatible; BaManBebin/1.0)',
      accept: '*/*',
    };
    if (req.headers.range) headers.range = req.headers.range;

    const { response } = await safeFetch(rawUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!response.ok && response.status !== 206) {
      res.status(response.status === 404 ? 404 : 502).json({ error: 'upstream_error', status: response.status });
      response.body?.cancel?.().catch(() => {});
      return;
    }

    res.status(response.status);
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
      const value = response.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    if (!response.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (!response.body) {
      res.end();
      return;
    }

    // Pipe the web stream to the Node response with backpressure handling.
    const reader = response.body.getReader();
    const pump = async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) {
          await new Promise((resolve) => res.once('drain', resolve));
        }
      }
    };

    await pump();
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      const code = error.code || (error.name === 'AbortError' ? 'timeout' : 'proxy_failed');
      const status = ['blocked_address', 'unsupported_protocol', 'invalid_url'].includes(code) ? 400 : 502;
      res.status(status).json({ error: code });
    } else {
      res.end();
    }
  } finally {
    clearTimeout(timer);
    res.off('close', onClose);
  }
}
