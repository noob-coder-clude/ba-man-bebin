#!/usr/bin/env python3
"""
YouTube Cookie Normalizer & Validator for yt-dlp.

Supports:
  1. Gzip + Base64 encoded payload (YT_COOKIES_GZ_B64 from the Android app)
  2. Standard Netscape cookies.txt (including #HttpOnly_ lines and browser-extension quirks)
  3. JSON array exported by Cookie-Editor / EditThisCookie
  4. Raw HTTP Cookie header string ("SID=...; HSID=...; __Secure-1PSID=...")

Outputs a strict 7-column Netscape HTTP Cookie File verified with Python's
MozillaCookieJar (the exact parser yt-dlp uses internally).
"""
from __future__ import annotations

import base64
import gzip
import http.cookiejar
import json
import os
import stat
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

AUTH_COOKIE_NAMES = {
    "SID",
    "HSID",
    "SSID",
    "APISID",
    "SAPISID",
    "__Secure-1PSID",
    "__Secure-3PSID",
    "__Secure-1PSIDTS",
    "__Secure-3PSIDTS",
    "LOGIN_INFO",
}

ALLOWED_DOMAIN_SUFFIXES = (
    "youtube.com",
    "youtu.be",
    "google.com",
    "googlevideo.com",
    "googleapis.com",
    "ytimg.com",
)


@dataclass
class CookieReport:
    path: Optional[Path]
    total_cookies: int
    has_auth_cookies: bool
    found_auth_names: List[str]
    source_format: str


def decode_cookie_env(
    gz_b64: Optional[str] = None,
    raw_text: Optional[str] = None,
) -> str:
    """Decode cookies from YT_COOKIES_GZ_B64 or plain YT_COOKIES."""
    if gz_b64 and gz_b64.strip():
        cleaned = "".join(gz_b64.split())
        raw_bytes = base64.b64decode(cleaned)
        if raw_bytes[:2] == b"\x1f\x8b":
            return gzip.decompress(raw_bytes).decode("utf-8", errors="replace")
        return raw_bytes.decode("utf-8", errors="replace")
    if raw_text and raw_text.strip():
        return raw_text
    return ""


def _is_relevant_domain(domain: str) -> bool:
    d = domain.lstrip(".").lower().strip()
    if not d:
        return False
    return any(d == suf or d.endswith("." + suf) for suf in ALLOWED_DOMAIN_SUFFIXES)


def _format_netscape_row(
    domain: str,
    path: str,
    secure: bool,
    expiry: int,
    name: str,
    value: str,
    http_only: bool = False,
) -> Optional[str]:
    domain = domain.strip()
    name = name.strip()
    value = value.strip().replace("\t", "").replace("\r", "").replace("\n", "")
    if not domain or not name:
        return None
    if not _is_relevant_domain(domain):
        return None

    # MozillaCookieJar strictly requires:
    # domain.startswith('.') == (include_subdomains == 'TRUE')
    if not domain.startswith(".") and domain.count(".") >= 1:
        domain = "." + domain
    include_subdomains = "TRUE" if domain.startswith(".") else "FALSE"

    clean_path = path.strip() if path and path.strip().startswith("/") else "/"
    secure_str = "TRUE" if secure or name.startswith("__Secure-") or name.startswith("__Host-") else "FALSE"

    now_plus_year = int(time.time()) + 365 * 86400
    if expiry <= 0:
        expiry = now_plus_year

    prefix = "#HttpOnly_" if http_only else ""
    return f"{prefix}{domain}\t{include_subdomains}\t{clean_path}\t{secure_str}\t{expiry}\t{name}\t{value}"


def _parse_json_cookies(text: str) -> List[str]:
    data = json.loads(text)
    if isinstance(data, dict) and "cookies" in data:
        data = data["cookies"]
    if not isinstance(data, list):
        return []

    rows: List[str] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        domain = str(item.get("domain") or ".youtube.com")
        path = str(item.get("path") or "/")
        secure = bool(item.get("secure", True))
        http_only = bool(item.get("httpOnly", False))
        exp_raw = item.get("expirationDate") or item.get("expiry") or item.get("expires") or 0
        try:
            expiry = int(float(exp_raw))
        except (ValueError, TypeError):
            expiry = 0
        name = str(item.get("name") or "")
        value = str(item.get("value") or "")
        row = _format_netscape_row(domain, path, secure, expiry, name, value, http_only)
        if row:
            rows.append(row)
    return rows


def _parse_netscape_cookies(lines: Iterable[str]) -> List[str]:
    rows: List[str] = []
    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        http_only = False
        if line.startswith("#HttpOnly_"):
            http_only = True
            line = line[len("#HttpOnly_") :]
        elif line.startswith("#"):
            continue

        parts = line.split("\t")
        if len(parts) < 6:
            # Handle accidental multi-space converted tabs
            parts = line.split()
        if len(parts) == 6:
            # Empty cookie value case
            parts.append("")
        if len(parts) < 7:
            continue

        domain, _sub, path, sec_raw, exp_raw, name = parts[:6]
        value = "\t".join(parts[6:])
        secure = sec_raw.upper() == "TRUE"
        try:
            expiry = int(float(exp_raw))
        except (ValueError, TypeError):
            expiry = 0

        row = _format_netscape_row(domain, path, secure, expiry, name, value, http_only)
        if row:
            rows.append(row)
    return rows


def _parse_header_cookies(text: str) -> List[str]:
    cleaned = text.strip()
    if cleaned.lower().startswith("cookie:"):
        cleaned = cleaned[len("cookie:") :].strip()

    rows: List[str] = []
    # Duplicate onto both .youtube.com and .google.com for seamless SSO refresh
    pairs: List[Tuple[str, str]] = []
    for chunk in cleaned.replace("\n", ";").split(";"):
        chunk = chunk.strip()
        if "=" not in chunk:
            continue
        k, v = chunk.split("=", 1)
        k, v = k.strip(), v.strip()
        if k:
            pairs.append((k, v))

    for name, value in pairs:
        r1 = _format_netscape_row(".youtube.com", "/", True, 0, name, value, False)
        if r1:
            rows.append(r1)
    return rows


def prepare_cookies_file(
    output_dir: Path,
    gz_b64: Optional[str] = None,
    raw_text: Optional[str] = None,
) -> CookieReport:
    """
    Parse cookies from environment strings and write a verified Netscape cookies.txt
    file with 0600 permissions. Never logs secret cookie values.
    """
    decoded = decode_cookie_env(gz_b64=gz_b64, raw_text=raw_text).strip()
    if not decoded:
        return CookieReport(
            path=None,
            total_cookies=0,
            has_auth_cookies=False,
            found_auth_names=[],
            source_format="none",
        )

    rows: List[str] = []
    source_format = "unknown"

    if decoded.startswith("[") or decoded.startswith("{"):
        try:
            rows = _parse_json_cookies(decoded)
            source_format = "json"
        except Exception:
            rows = []

    if not rows and ("\t" in decoded or "# Netscape" in decoded or "#HttpOnly_" in decoded):
        rows = _parse_netscape_cookies(decoded.splitlines())
        source_format = "netscape"

    if not rows and "=" in decoded:
        # Try Netscape space-separated first, otherwise raw Cookie header
        maybe_netscape = _parse_netscape_cookies(decoded.splitlines())
        if maybe_netscape:
            rows = maybe_netscape
            source_format = "netscape"
        else:
            rows = _parse_header_cookies(decoded)
            source_format = "header"

    if not rows:
        return CookieReport(
            path=None,
            total_cookies=0,
            has_auth_cookies=False,
            found_auth_names=[],
            source_format="invalid",
        )

    # Deduplicate by (domain, path, name) keeping latest entry
    dedup = {}
    found_auth = set()
    for row in rows:
        plain = row[len("#HttpOnly_") :] if row.startswith("#HttpOnly_") else row
        cols = plain.split("\t")
        key = (cols[0], cols[2], cols[5])
        dedup[key] = row
        if cols[5] in AUTH_COOKIE_NAMES and cols[6]:
            found_auth.add(cols[5])

    final_rows = list(dedup.values())
    output_dir.mkdir(parents=True, exist_ok=True)
    cookie_path = output_dir / "yt_cookies.txt"

    content = "# Netscape HTTP Cookie File\n# Auto-normalized for yt-dlp\n" + "\n".join(final_rows) + "\n"
    cookie_path.write_text(content, encoding="utf-8")
    os.chmod(cookie_path, stat.S_IRUSR | stat.S_IWUSR)

    # Verify with MozillaCookieJar so yt-dlp will never choke on formatting
    jar = http.cookiejar.MozillaCookieJar(str(cookie_path))
    jar.load(ignore_discard=True, ignore_expires=True)

    return CookieReport(
        path=cookie_path,
        total_cookies=len(jar),
        has_auth_cookies=len(found_auth) > 0,
        found_auth_names=sorted(found_auth),
        source_format=source_format,
    )
