#!/usr/bin/env python3
"""
Precision Timeline Audio Assembler, SRT Subtitle Generator & Faststart MP4 Muxer.

Uses Python's built-in `array('h')` + `wave` + `ffmpeg` (zero `audioop` dependency,
100% compatible with Python 3.10 through 3.14+).
"""
from __future__ import annotations

import array
import math
import subprocess
import sys
import wave
from pathlib import Path
from typing import List, Tuple

from gemini_dubber import DubSegment

SAMPLE_RATE = 24000
SAMPLES_PER_MS = SAMPLE_RATE // 1000  # 24 samples per millisecond


def _ensure_mono_24k_wav(src_wav: Path, dst_wav: Path) -> None:
    cmd = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        str(src_wav),
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-c:a",
        "pcm_s16le",
        str(dst_wav),
    ]
    subprocess.run(cmd, check=True)


def _read_pcm16_samples(wav_path: Path) -> array.array:
    with wave.open(str(wav_path), "rb") as wf:
        n_ch = wf.getnchannels()
        sw = wf.getsampwidth()
        sr = wf.getframerate()
        raw = wf.readframes(wf.getnframes())

    if n_ch != 1 or sw != 2 or sr != SAMPLE_RATE:
        norm_path = wav_path.with_name(wav_path.stem + "_norm24k.wav")
        _ensure_mono_24k_wav(wav_path, norm_path)
        with wave.open(str(norm_path), "rb") as wf2:
            raw = wf2.readframes(wf2.getnframes())

    samples = array.array("h")
    samples.frombytes(raw[: len(raw) - (len(raw) % 2)])
    if sys.byteorder != "little":
        samples.byteswap()
    return samples


def _write_pcm16_samples(wav_path: Path, samples: array.array) -> None:
    out = samples
    if sys.byteorder != "little":
        out = array.array("h", samples)
        out.byteswap()
    wav_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(wav_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(out.tobytes())


def trim_silence_samples(
    samples: array.array,
    threshold: int = 320,
    window: int = 240,  # 10ms at 24kHz
    pad_samples: int = 720,  # 30ms natural breath pad
) -> array.array:
    n = len(samples)
    if n <= window * 2:
        return samples

    first_voice = 0
    for i in range(0, n - window, window):
        peak = max(abs(samples[j]) for j in range(i, i + window))
        if peak >= threshold:
            first_voice = max(0, i - pad_samples)
            break

    last_voice = n
    for i in range(n - window, first_voice, -window):
        peak = max(abs(samples[j]) for j in range(i, i + window))
        if peak >= threshold:
            last_voice = min(n, i + window + pad_samples)
            break

    if last_voice <= first_voice:
        return samples
    return samples[first_voice:last_voice]


def _apply_micro_fade(samples: array.array, fade_ms: int = 12) -> None:
    fade_len = min(len(samples) // 4, fade_ms * SAMPLES_PER_MS)
    for i in range(fade_len):
        gain = i / float(fade_len)
        samples[i] = int(samples[i] * gain)
        samples[-1 - i] = int(samples[-1 - i] * gain)


def _time_stretch_wav(src_wav: Path, dst_wav: Path, speed_ratio: float) -> None:
    """Apply smooth FFmpeg atempo filter (supports chained ratios > 2.0 safely)."""
    ratio = max(0.5, min(2.5, speed_ratio))
    filters = []
    rem = ratio
    while rem > 2.0:
        filters.append("atempo=2.0")
        rem /= 2.0
    filters.append(f"atempo={rem:.4f}")
    af = ",".join(filters)

    cmd = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        str(src_wav),
        "-af",
        af,
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-c:a",
        "pcm_s16le",
        str(dst_wav),
    ]
    subprocess.run(cmd, check=True)


def format_srt_timestamp(ms: int) -> str:
    ms = max(0, int(ms))
    hours = ms // 3_600_000
    rem = ms % 3_600_000
    minutes = rem // 60_000
    rem %= 60_000
    seconds = rem // 1000
    millis = rem % 1000
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def write_persian_srt(
    placed_cues: List[Tuple[int, int, str]],
    srt_path: Path,
) -> Path:
    """Write UTF-8 Persian .srt subtitle file synced to the exact placed speech windows."""
    srt_path.parent.mkdir(parents=True, exist_ok=True)
    blocks: List[str] = []
    RLM = "\u200f"  # Right-to-Left Mark for proper punctuation rendering in players
    for idx, (s_ms, e_ms, text) in enumerate(placed_cues, start=1):
        clean_txt = text.strip()
        if not clean_txt:
            continue
        blocks.append(
            f"{idx}\n{format_srt_timestamp(s_ms)} --> {format_srt_timestamp(e_ms)}\n{RLM}{clean_txt}\n"
        )
    srt_path.write_text("\n".join(blocks) + "\n", encoding="utf-8")
    return srt_path


def assemble_dubbed_timeline(
    segments: List[DubSegment],
    video_duration_ms: int,
    work_dir: Path,
    max_speedup: float = 1.42,
) -> Tuple[Path, Path]:
    """
    Assemble all Gemini-synthesized segment WAVs onto a single sample-accurate
    master WAV track and generate a synced Persian .srt file.
    """
    fit_dir = work_dir / "fitted_segs"
    fit_dir.mkdir(parents=True, exist_ok=True)

    total_samples = max(SAMPLE_RATE, video_duration_ms * SAMPLES_PER_MS)
    master = array.array("h", [0]) * total_samples
    placed_cues: List[Tuple[int, int, str]] = []

    cursor_ms = 0
    n_segs = len(segments)

    for idx, seg in enumerate(segments):
        if seg.wav_path is None or not seg.wav_path.exists():
            continue

        raw_samples = trim_silence_samples(_read_pcm16_samples(seg.wav_path))
        if len(raw_samples) == 0:
            continue

        raw_ms = len(raw_samples) / float(SAMPLES_PER_MS)
        desired_start_ms = max(cursor_ms, seg.start_ms)

        if idx + 1 < n_segs:
            next_start_ms = max(desired_start_ms + 600, segments[idx + 1].start_ms)
            hard_ceiling_ms = next_start_ms - 50
        else:
            hard_ceiling_ms = max(desired_start_ms + 800, video_duration_ms)

        natural_slot_ms = max(900.0, (seg.end_ms - desired_start_ms) + 2200.0)
        slot_ms = max(700.0, min(float(hard_ceiling_ms - desired_start_ms), natural_slot_ms))

        final_samples = raw_samples
        if raw_ms > slot_ms * 1.03:
            needed_ratio = raw_ms / slot_ms
            applied_ratio = min(max_speedup, needed_ratio)
            trimmed_wav = fit_dir / f"trim_{seg.index:04d}.wav"
            stretched_wav = fit_dir / f"stretch_{seg.index:04d}.wav"
            _write_pcm16_samples(trimmed_wav, raw_samples)
            _time_stretch_wav(trimmed_wav, stretched_wav, applied_ratio)
            final_samples = _read_pcm16_samples(stretched_wav)

        _apply_micro_fade(final_samples)

        start_sample = desired_start_ms * SAMPLES_PER_MS
        end_sample = start_sample + len(final_samples)
        if end_sample > len(master):
            # Extend timeline slightly if the final sentence runs 1-2s past video tail
            extra = end_sample - len(master)
            master.extend([0] * extra)

        for j, val in enumerate(final_samples):
            pos = start_sample + j
            mixed = master[pos] + val
            if mixed > 32767:
                mixed = 32767
            elif mixed < -32768:
                mixed = -32768
            master[pos] = mixed

        actual_end_ms = int(math.ceil(end_sample / float(SAMPLES_PER_MS)))
        cursor_ms = actual_end_ms + 40
        placed_cues.append((desired_start_ms, actual_end_ms, seg.fa_text))

    master_wav = work_dir / "dubbed_persian_master.wav"
    _write_pcm16_samples(master_wav, master)

    srt_path = work_dir / "subtitles_fa.srt"
    write_persian_srt(placed_cues, srt_path)
    return master_wav, srt_path


def _probe_video_codec(video_path: Path) -> str:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(video_path),
    ]
    try:
        return subprocess.check_output(cmd, text=True).strip().lower()
    except Exception:
        return ""


def _probe_has_audio(video_path: Path) -> bool:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=index",
        "-of",
        "csv=p=0",
        str(video_path),
    ]
    try:
        return bool(subprocess.check_output(cmd, text=True).strip())
    except Exception:
        return False


def mux_final_video(
    source_video: Path,
    dubbed_wav: Path,
    srt_path: Path,
    output_mp4: Path,
    bg_volume_pct: int = 0,
    burn_subtitles: bool = False,
) -> Path:
    """
    Create the final streamable H.264/MP4 (+faststart) dubbed video.

    By default (bg_volume_pct == 0), original audio is 100% replaced with the
    Persian dubbed voice and H.264 video frames are stream-copied without loss.
    """
    output_mp4.parent.mkdir(parents=True, exist_ok=True)
    vcodec = _probe_video_codec(source_video)
    can_copy_video = (vcodec in ("h264", "avc1")) and not burn_subtitles

    bg_vol = max(0, min(60, int(bg_volume_pct))) / 100.0
    use_bg_mix = bg_vol > 0.005 and _probe_has_audio(source_video)

    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(source_video), "-i", str(dubbed_wav)]
    has_soft_sub = srt_path.exists() and not burn_subtitles
    if has_soft_sub:
        cmd.extend(["-i", str(srt_path)])

    filter_parts = []
    if use_bg_mix:
        filter_parts.append(
            f"[0:a:0]volume={bg_vol:.3f}[bg];"
            f"[1:a:0]volume=1.05[fa];"
            f"[bg][fa]amix=inputs=2:duration=first:dropout_transition=0[aout]"
        )
        audio_map = "[aout]"
    else:
        # Complete replacement: ONLY Persian dubbed audio + gentle loudness normalization
        filter_parts.append("[1:a:0]dynaudnorm=f=150:g=15[aout]")
        audio_map = "[aout]"

    if burn_subtitles and srt_path.exists():
        # Escape path for ffmpeg subtitles filter
        esc_srt = (
            str(srt_path.resolve())
            .replace("\\", "\\\\")
            .replace(":", "\\:")
            .replace("'", "\\'")
        )
        style = (
            "FontName=Vazirmatn,FontSize=20,PrimaryColour=&H00FFFFFF,"
            "OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=24"
        )
        filter_parts.append(f"[0:v:0]subtitles='{esc_srt}':force_style='{style}'[vout]")
        video_map = "[vout]"
    else:
        video_map = "0:v:0"

    cmd.extend(["-filter_complex", ";".join(filter_parts)])
    cmd.extend(["-map", video_map, "-map", audio_map])
    if has_soft_sub:
        cmd.extend(["-map", "2:s:0"])

    if can_copy_video:
        cmd.extend(["-c:v", "copy"])
    else:
        cmd.extend(["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"])

    cmd.extend(["-c:a", "aac", "-b:a", "192k", "-ac", "2"])
    if has_soft_sub:
        cmd.extend(["-c:s", "mov_text", "-metadata:s:s:0", "language=fas", "-metadata:s:s:0", "title=Persian"])

    cmd.extend(
        [
            "-metadata:s:a:0",
            "language=fas",
            "-metadata:s:a:0",
            "title=Persian Dub (Gemini)",
            "-movflags",
            "+faststart",
            "-shortest",
            str(output_mp4),
        ]
    )
    subprocess.run(cmd, check=True)
    return output_mp4
