#!/usr/bin/env python3
"""
Cloud Persian Dubber — Main Pipeline Entrypoint (runs on GitHub Actions).

Reads job parameters from environment variables or dubber-jobs/current-job.json,
downloads the YouTube video with the user's encrypted cookies, translates &
synthesizes Persian speech using Gemini, muxes a faststart MP4, and publishes
it to GitHub Releases for instant streaming & download in the Android app.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from audio_assembler import assemble_dubbed_timeline, mux_final_video
from cookies_helper import prepare_cookies_file
from gemini_dubber import synthesize_script_with_gemini_tts, translate_media_with_gemini
from yt_downloader import download_youtube_media, probe_duration_ms


def emit_gh_error(msg: str) -> None:
    single_line = " | ".join(ln.strip() for ln in msg.strip().splitlines() if ln.strip())
    print(f"::error title=DUBBER_ERROR::{single_line}", flush=True)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as sf:
            sf.write(f"\n### ❌ خطا در فرآیند دوبله\n\n{msg}\n")


def load_job_config(repo_root: Path) -> dict:
    cfg = {
        "job_id": os.environ.get("DUB_JOB_ID", "").strip(),
        "youtube_url": os.environ.get("DUB_YOUTUBE_URL", "").strip(),
        "voice_name": os.environ.get("DUB_VOICE_NAME", "").strip() or "auto",
        "video_quality": os.environ.get("DUB_VIDEO_QUALITY", "").strip() or "720",
        "style_mode": os.environ.get("DUB_STYLE_MODE", "").strip() or "conversational",
        "bg_volume": os.environ.get("DUB_BG_VOLUME", "").strip() or "0",
        "burn_subs": os.environ.get("DUB_BURN_SUBS", "").strip().lower() in ("true", "1", "yes"),
    }

    job_file = repo_root / "dubber-jobs" / "current-job.json"
    if not cfg["youtube_url"] and job_file.exists():
        data = json.loads(job_file.read_text(encoding="utf-8"))
        cfg["job_id"] = str(data.get("job_id") or cfg["job_id"]).strip()
        cfg["youtube_url"] = str(data.get("youtube_url") or "").strip()
        cfg["voice_name"] = str(data.get("voice_name") or cfg["voice_name"]).strip()
        cfg["video_quality"] = str(data.get("video_quality") or cfg["video_quality"]).strip()
        cfg["style_mode"] = str(data.get("style_mode") or cfg["style_mode"]).strip()
        cfg["bg_volume"] = str(data.get("bg_volume") if data.get("bg_volume") is not None else cfg["bg_volume"])
        cfg["burn_subs"] = bool(data.get("burn_subs", cfg["burn_subs"]))

    if not cfg["job_id"]:
        now_tag = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")
        cfg["job_id"] = now_tag

    # Sanitize job_id for safe git release tag
    cfg["job_id"] = re.sub(r"[^A-Za-z0-9._-]", "-", cfg["job_id"])[:48]
    return cfg


def publish_github_release(
    job_id: str,
    mp4_path: Path,
    srt_path: Path,
    meta: dict,
) -> str:
    tag = f"dub-{job_id}"
    title_fa = meta.get("title_fa") or meta.get("title_orig") or tag
    release_title = f"🎬 {title_fa[:75]}"

    meta_json_compact = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
    notes = (
        f"<!-- DUB_META:{meta_json_compact} -->\n"
        f"## 🎙️ {meta.get('title_fa', '')}\n\n"
        f"- **عنوان اصلی:** {meta.get('title_orig', '')}\n"
        f"- **لینک یوتیوب:** {meta.get('youtube_url', '')}\n"
        f"- **مدت زمان:** {meta.get('duration_sec', 0):.0f} ثانیه\n"
        f"- **گوینده Gemini:** `{meta.get('voice', 'auto')}` ({meta.get('tts_model', '')})\n"
        f"- **مدل ترجمه:** `{meta.get('trans_model', '')}`\n"
        f"- **حجم فایل:** {meta.get('file_size_mb', 0):.1f} مگابایت\n\n"
        f"> ساخته‌شده به‌صورت خودکار توسط سرور ابری **با من دوبله کن**.\n"
    )

    notes_file = mp4_path.parent / "release_notes.md"
    notes_file.write_text(notes, encoding="utf-8")

    # Delete existing release/tag if re-running same job_id
    subprocess.run(["gh", "release", "delete", tag, "--yes", "--cleanup-tag"], capture_output=True)

    cmd = [
        "gh",
        "release",
        "create",
        tag,
        str(mp4_path),
        str(srt_path),
        "--title",
        release_title,
        "--notes-file",
        str(notes_file),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"خطا در انتشار خروجی روی GitHub Releases:\n{proc.stderr}")

    release_url = (proc.stdout or "").strip().splitlines()[-1]
    return release_url


def write_stage_marker(stage_file: Path, stage_num: int, stage_title: str) -> None:
    banner = f"\n{'=' * 64}\n▶ مرحله {stage_num}/6: {stage_title}\n{'=' * 64}"
    print(banner, flush=True)
    stage_file.write_text(
        json.dumps({"stage": stage_num, "title": stage_title}, ensure_ascii=False),
        encoding="utf-8",
    )


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    cfg = load_job_config(repo_root)

    if not cfg["youtube_url"]:
        emit_gh_error("لینک یوتیوب ارسال نشده است. لطفاً از داخل برنامه اندروید لینک ویدیو را ارسال کنید.")
        return 1

    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not gemini_key:
        emit_gh_error(
            "کلید GEMINI_API_KEY روی Secrets گیت‌هاب تنظیم نشده است. "
            "لطفاً در تب تنظیمات برنامه کلید Gemini را وارد کرده و دکمه همگام‌سازی را بزنید."
        )
        return 1

    runner_tmp = Path(os.environ.get("RUNNER_TEMP") or tempfile.gettempdir())
    work_dir = runner_tmp / f"dub_work_{cfg['job_id']}"
    if work_dir.exists():
        shutil.rmtree(work_dir, ignore_errors=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    stage_file = work_dir / "stage.json"

    try:
        # Stage 1: Cookies
        write_stage_marker(stage_file, 1, "بررسی و آماده‌سازی کوکی یوتیوب")
        cookie_report = prepare_cookies_file(
            output_dir=work_dir / "sec",
            gz_b64=os.environ.get("YT_COOKIES_GZ_B64", ""),
            raw_text=os.environ.get("YT_COOKIES", ""),
        )
        print(
            f"  [Cookies] وضعیت کوکی: فرمت={cookie_report.source_format}, "
            f"تعداد={cookie_report.total_cookies}, کوکی لاگین={cookie_report.has_auth_cookies}"
        )

        # Stage 2: Download YouTube Video
        write_stage_marker(stage_file, 2, "دانلود ویدیو و استخراج صوت از یوتیوب")
        try:
            max_h = int(cfg["video_quality"])
        except ValueError:
            max_h = 720
        media = download_youtube_media(
            raw_url=cfg["youtube_url"],
            work_dir=work_dir,
            cookie_path=cookie_report.path,
            max_height=max_h,
        )
        print(
            f"  [YouTube] دانلود کامل شد: «{media.title}» "
            f"({media.duration_sec:.1f} ثانیه، {len(media.audio_chunks)} قطعه صوتی)"
        )

        # Stage 3: Gemini Multimodal Translation
        write_stage_marker(stage_file, 3, "تحلیل صوت، تشخیص گوینده و ترجمه دوبله فارسی با Gemini")
        script, tts_models = translate_media_with_gemini(
            api_key=gemini_key,
            title_orig=media.title,
            duration_sec=media.duration_sec,
            audio_chunks=media.audio_chunks,
            subtitle_hint_text=media.subtitle_hint_text,
            style_mode=cfg["style_mode"],
        )
        print(
            f"  [Script] عنوان فارسی: «{script.title_fa}» | "
            f"تعداد بلوک‌های گفتاری: {len(script.segments)} | مدل: {script.trans_model_used}"
        )

        # Stage 4: Gemini Native TTS Synthesis
        write_stage_marker(stage_file, 4, "تولید صدای گوینده فارسی با موتور صوتی Gemini")
        synthesize_script_with_gemini_tts(
            api_key=gemini_key,
            script=script,
            tts_models=tts_models,
            output_dir=work_dir / "tts_wavs",
            preferred_voice=cfg["voice_name"],
        )

        # Stage 5: Timeline Assembly & Video Muxing
        write_stage_marker(stage_file, 5, "هماهنگ‌سازی دقیق صدا و ساخت ویدیوی نهایی MP4")
        video_dur_ms = probe_duration_ms(media.video_path)
        master_wav, srt_raw = assemble_dubbed_timeline(
            segments=script.segments,
            video_duration_ms=video_dur_ms,
            work_dir=work_dir,
        )

        safe_vid = re.sub(r"[^A-Za-z0-9_-]", "", media.video_id) or "video"
        out_dir = work_dir / "release_out"
        out_dir.mkdir(parents=True, exist_ok=True)
        final_mp4 = out_dir / f"dubbed_{safe_vid}.mp4"
        final_srt = out_dir / f"subtitles_{safe_vid}.srt"
        shutil.copyfile(srt_raw, final_srt)

        try:
            bg_vol = int(cfg["bg_volume"])
        except ValueError:
            bg_vol = 0

        mux_final_video(
            source_video=media.video_path,
            dubbed_wav=master_wav,
            srt_path=final_srt,
            output_mp4=final_mp4,
            bg_volume_pct=bg_vol,
            burn_subtitles=bool(cfg["burn_subs"]),
        )
        size_mb = final_mp4.stat().st_size / (1024.0 * 1024.0)
        print(f"  [Mux] ویدیوی دوبله‌شده آماده شد ({size_mb:.2f} MB): {final_mp4.name}")

        # Stage 6: Publish to GitHub Releases
        write_stage_marker(stage_file, 6, "انتشار در GitHub Releases برای پخش آنلاین و دانلود")
        meta = {
            "job_id": cfg["job_id"],
            "video_id": media.video_id,
            "title_fa": script.title_fa,
            "title_orig": media.title,
            "summary_fa": script.summary_fa,
            "duration_sec": round(media.duration_sec, 1),
            "thumbnail_url": media.thumbnail_url,
            "youtube_url": media.canonical_url,
            "voice": cfg["voice_name"],
            "trans_model": script.trans_model_used,
            "tts_model": script.tts_model_used,
            "bg_volume": bg_vol,
            "burn_subs": bool(cfg["burn_subs"]),
            "mp4_name": final_mp4.name,
            "srt_name": final_srt.name,
            "file_size_mb": round(size_mb, 2),
            "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
        rel_url = publish_github_release(cfg["job_id"], final_mp4, final_srt, meta)
        print(f"\n✅ دوبله با موفقیت کامل شد! لینک انتشار:\n{rel_url}", flush=True)

        summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary_path:
            with open(summary_path, "a", encoding="utf-8") as sf:
                sf.write(
                    f"\n### ✅ دوبله فارسی با موفقیت آماده شد\n"
                    f"- **عنوان:** {script.title_fa}\n"
                    f"- **لینک Release:** {rel_url}\n"
                    f"- **حجم ویدیو:** {size_mb:.1f} MB\n"
                )
        return 0

    except Exception as exc:
        emit_gh_error(str(exc))
        return 1
    finally:
        # Always shred temporary cookies & work files
        shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
