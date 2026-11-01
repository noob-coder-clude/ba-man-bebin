#!/usr/bin/env python3
"""
YouTube Video, Metadata, Caption-Hint & Audio-Chunk Downloader.

Uses yt-dlp with Node.js EJS runtime (--js-runtimes node) and normalized
YouTube cookies on GitHub Actions Ubuntu runners.
"""
from __future__ import annotations

import json
import math
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional
from urllib.parse import parse_qs, urlparse


@dataclass
class AudioChunk:
    index: int
    path: Path
    start_ms: int
    end_ms: int


@dataclass
class DownloadedMedia:
    video_id: str
    canonical_url: str
    title: str
    duration_sec: float
    thumbnail_url: str
    uploader: str
    video_path: Path
    subtitle_hint_text: str = ""
    audio_chunks: List[AudioChunk] = field(default_factory=list)


def normalize_youtube_url(raw_url: str) -> str:
    """Normalize any YouTube watch / shorts / youtu.be / mobile link to a clean single-video URL."""
    url = (raw_url or "").strip()
    if not url:
        raise ValueError("لینک یوتیوب خالی است.")

    # Extract first URL if share text contains title + URL (e.g. from YouTube Share sheet)
    m_url = re.search(r"https?://[^\s<>\"']+", url)
    if m_url:
        url = m_url.group(0)
    elif re.fullmatch(r"[A-Za-z0-9_-]{11}", url):
        return f"https://www.youtube.com/watch?v={url}"

    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if host.startswith("www.") or host.startswith("m.") or host.startswith("music."):
        host = host.split(".", 1)[1]

    video_id: Optional[str] = None
    if host == "youtu.be":
        seg = parsed.path.strip("/").split("/")[0]
        if seg:
            video_id = seg
    elif host in ("youtube.com", "youtube-nocookie.com"):
        qs = parse_qs(parsed.query)
        if "v" in qs and qs["v"]:
            video_id = qs["v"][0]
        else:
            parts = [p for p in parsed.path.strip("/").split("/") if p]
            if len(parts) >= 2 and parts[0] in ("shorts", "live", "embed", "v"):
                video_id = parts[1]

    if video_id:
        clean_id = re.sub(r"[^A-Za-z0-9_-]", "", video_id)[:11]
        if len(clean_id) == 11:
            return f"https://www.youtube.com/watch?v={clean_id}"

    if "youtube.com" in host or "youtu.be" in host:
        return url
    raise ValueError(f"لینک واردشده یک لینک معتبر یوتیوب نیست: {raw_url}")


def probe_duration_ms(media_path: Path) -> int:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(media_path),
    ]
    out = subprocess.check_output(cmd, text=True).strip()
    return max(1000, int(round(float(out) * 1000.0)))


def _parse_srt_to_compact_hints(srt_path: Path, max_chars: int = 28000) -> str:
    """Convert raw SRT/VTT subtitles into compact timestamped lines to assist Gemini timing."""
    if not srt_path.exists():
        return ""
    raw = srt_path.read_text(encoding="utf-8", errors="replace")
    blocks = re.split(r"\r?\n\r?\n+", raw.strip())
    lines: List[str] = []
    seen_last = ""
    for block in blocks:
        b_lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if len(b_lines) < 2:
            continue
        ts_idx = 0 if "-->" in b_lines[0] else (1 if len(b_lines) > 1 and "-->" in b_lines[1] else -1)
        if ts_idx < 0:
            continue
        ts_line = b_lines[ts_idx]
        text = " ".join(b_lines[ts_idx + 1 :])
        text = re.sub(r"<[^>]+>", "", text).strip()
        if not text or text == seen_last:
            continue
        seen_last = text
        m = re.search(r"(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})", ts_line)
        if m:
            start_s = m.group(1).replace(",", ".")[:10]
            end_s = m.group(2).replace(",", ".")[:10]
            lines.append(f"[{start_s}-{end_s}] {text}")
    joined = "\n".join(lines)
    return joined[:max_chars]


def _classify_ytdlp_error(stderr: str, had_cookies: bool) -> str:
    low = stderr.lower()
    if "sign in to confirm you" in low or "not a bot" in low:
        if had_cookies:
            return (
                "یوتیوب کوکی فعلی را نپذیرفت (احتمالاً کوکی منقضی شده یا بدون لاگین بوده است). "
                "لطفاً در تب تنظیماتِ برنامه، یک‌بار دیگر وارد اکانت یوتیوب شوید یا کوکی جدید وارد کنید."
            )
        return (
            "یوتیوب روی سرور ابری نیاز به کوکی اکانت دارد. "
            "لطفاً در تب «تنظیمات و کوکی» برنامه اندروید، کوکی یوتیوب خود را وارد و همگام‌سازی کنید."
        )
    if "private video" in low:
        return "این ویدیو خصوصی (Private) است و با اکانت فعلی قابل دسترسی نیست."
    if "members-only" in low or "join this channel" in low:
        return "این ویدیو مخصوص اعضای ویژه کانال (Members-only) است."
    if "video unavailable" in low:
        return "این ویدیو در یوتیوب در دسترس نیست یا حذف شده است."
    tail = "\n".join(stderr.strip().splitlines()[-8:])
    return f"خطا در دانلود ویدیو از یوتیوب:\n{tail}"


def download_youtube_media(
    raw_url: str,
    work_dir: Path,
    cookie_path: Optional[Path] = None,
    max_height: int = 720,
    chunk_minutes: int = 10,
) -> DownloadedMedia:
    canonical_url = normalize_youtube_url(raw_url)
    dl_dir = work_dir / "yt_dl"
    dl_dir.mkdir(parents=True, exist_ok=True)

    height = max(240, min(1080, int(max_height)))
    fmt_primary = (
        f"bestvideo[height<={height}][vcodec^=avc1]+bestaudio[acodec^=mp4a]/"
        f"bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/"
        f"bestvideo[height<={height}]+bestaudio/"
        f"best[height<={height}]/best"
    )

    attempts = []
    if cookie_path and cookie_path.exists():
        attempts.append(("cookies+h264", cookie_path, fmt_primary))
        attempts.append(("cookies+best", cookie_path, f"best[height<={height}]/best"))
    # Public fallback without cookies if cookies were missing or rejected on a public video
    attempts.append(("public+h264", None, fmt_primary))

    last_err = ""
    info_json_path: Optional[Path] = None
    video_path: Optional[Path] = None

    for label, c_path, fmt in attempts:
        # Clean partial files from earlier attempt
        for old in dl_dir.glob("source*"):
            old.unlink(missing_ok=True)

        cmd = [
            "yt-dlp",
            "--no-playlist",
            "--no-warnings",
            "--newline",
            "--js-runtimes",
            "node",
            "-f",
            fmt,
            "--merge-output-format",
            "mp4",
            "--write-info-json",
            "--write-subs",
            "--write-auto-subs",
            "--sub-langs",
            "en.*,en,orig",
            "--convert-subs",
            "srt",
            "--ignore-errors",
            "-o",
            str(dl_dir / "source.%(ext)s"),
        ]
        if c_path is not None:
            cmd.extend(["--cookies", str(c_path)])
        cmd.append(canonical_url)

        print(f"  [yt-dlp] تلاش دانلود ({label}) ...")
        proc = subprocess.run(cmd, capture_output=True, text=True)
        candidates = [
            p
            for p in dl_dir.glob("source.*")
            if p.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov")
        ]
        if candidates:
            video_path = sorted(candidates, key=lambda p: p.stat().st_size, reverse=True)[0]
            ij = dl_dir / "source.info.json"
            if ij.exists():
                info_json_path = ij
            break
        last_err = (proc.stderr or "") + "\n" + (proc.stdout or "")
        print(f"  [yt-dlp] تلاش {label} ناموفق بود.")

    if video_path is None or not video_path.exists():
        raise RuntimeError(_classify_ytdlp_error(last_err, cookie_path is not None))

    info = {}
    if info_json_path and info_json_path.exists():
        try:
            info = json.loads(info_json_path.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            info = {}

    duration_ms = probe_duration_ms(video_path)
    duration_sec = duration_ms / 1000.0
    video_id = str(info.get("id") or canonical_url.split("v=")[-1][:11] or "video")
    title = str(info.get("title") or f"YouTube {video_id}")
    uploader = str(info.get("uploader") or info.get("channel") or "")
    thumbnail_url = str(info.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")

    # Collect optional SRT subtitle hint if yt-dlp retrieved any
    srt_files = sorted(dl_dir.glob("source*.srt"), key=lambda p: p.stat().st_size, reverse=True)
    subtitle_hint = _parse_srt_to_compact_hints(srt_files[0]) if srt_files else ""

    # Slice speech audio into lightweight 16kHz mono OGG Opus chunks for Gemini Files API
    chunks_dir = work_dir / "audio_chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    chunk_ms = max(60_000, chunk_minutes * 60 * 1000)
    num_chunks = max(1, math.ceil(duration_ms / chunk_ms))
    audio_chunks: List[AudioChunk] = []

    for idx in range(num_chunks):
        start_ms = idx * chunk_ms
        end_ms = min(duration_ms, (idx + 1) * chunk_ms)
        if end_ms - start_ms < 500:
            continue
        c_file = chunks_dir / f"chunk_{idx:03d}.ogg"
        ss_sec = f"{start_ms / 1000.0:.3f}"
        dur_sec = f"{(end_ms - start_ms) / 1000.0:.3f}"
        ff_cmd = [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-ss",
            ss_sec,
            "-t",
            dur_sec,
            "-i",
            str(video_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "libopus",
            "-b:a",
            "32k",
            str(c_file),
        ]
        subprocess.run(ff_cmd, check=True)
        audio_chunks.append(AudioChunk(index=idx, path=c_file, start_ms=start_ms, end_ms=end_ms))

    return DownloadedMedia(
        video_id=video_id,
        canonical_url=canonical_url,
        title=title,
        duration_sec=duration_sec,
        thumbnail_url=thumbnail_url,
        uploader=uploader,
        video_path=video_path,
        subtitle_hint_text=subtitle_hint,
        audio_chunks=audio_chunks,
    )
