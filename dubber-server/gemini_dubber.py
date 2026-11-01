#!/usr/bin/env python3
"""
Gemini Multimodal Persian Translator + Gemini Native TTS Synthesizer.

100% powered by the user's Gemini API key:
  - Discovers available multimodal & TTS models dynamically via client.models.list()
  - Translates video audio + timing hints into natural, timed Persian dubbing blocks
  - Synthesizes speech using Gemini TTS models with automatic multi-model failover
"""
from __future__ import annotations

import json
import re
import time
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from yt_downloader import AudioChunk

PREFERRED_TRANS_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-flash-latest",
    "gemini-2.5-pro",
    "gemini-pro-latest",
]

PREFERRED_TTS_MODELS = [
    "gemini-3.8-flash-tts",
    "gemini-3.8-flash-lite-tts",
    "gemini-3.1-flash-tts-preview",
    "gemini-2.5-flash-preview-tts",
    "gemini-2.5-pro-preview-tts",
]

MALE_VOICES = ["Orus", "Puck", "Charon", "Fenrir"]
FEMALE_VOICES = ["Aoede", "Kore", "Leda", "Zephyr"]
ALL_VALID_VOICES = set(MALE_VOICES + FEMALE_VOICES)


@dataclass
class DubSegment:
    index: int
    start_ms: int
    end_ms: int
    speaker: str
    gender: str
    fa_text: str
    wav_path: Optional[Path] = None


@dataclass
class DubScript:
    title_fa: str
    summary_fa: str
    segments: List[DubSegment]
    trans_model_used: str = ""
    tts_model_used: str = ""


def write_pcm_or_wav(output_wav: Path, audio_bytes: bytes, mime_type: str = "") -> None:
    """Save Gemini inline_data bytes (either RIFF WAV or raw 16-bit PCM) as a valid WAV file."""
    output_wav.parent.mkdir(parents=True, exist_ok=True)
    if audio_bytes[:4] == b"RIFF":
        output_wav.write_bytes(audio_bytes)
        return

    rate = 24000
    m = re.search(r"rate=(\d+)", mime_type or "", re.IGNORECASE)
    if m:
        rate = max(8000, min(96000, int(m.group(1))))

    # Ensure even byte count for 16-bit samples
    if len(audio_bytes) % 2 == 1:
        audio_bytes = audio_bytes[:-1]

    with wave.open(str(output_wav), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(audio_bytes)


def _strip_model_prefix(name: str) -> str:
    return name[len("models/") :] if name.startswith("models/") else name


def discover_gemini_models(client) -> Tuple[List[str], List[str]]:
    """Query client.models.list() and build ordered fallback chains for translation and TTS."""
    available: List[str] = []
    try:
        for m in client.models.list():
            m_name = _strip_model_prefix(str(getattr(m, "name", "") or ""))
            if m_name.startswith("gemini-"):
                available.append(m_name)
    except Exception as exc:
        err = str(exc)
        if "API_KEY_INVALID" in err or "API key not valid" in err or "401" in err:
            raise RuntimeError(
                "کلید Gemini API معتبر نیست. لطفاً در تب تنظیمات برنامه، کلید صحیح دریافتی از Google AI Studio را وارد کنید."
            ) from exc
        # Fallback to static preference lists if listing had transient network error
        return list(PREFERRED_TRANS_MODELS), list(PREFERRED_TTS_MODELS)

    avail_set = set(available)

    # Build TTS chain
    tts_chain: List[str] = [m for m in PREFERRED_TTS_MODELS if m in avail_set]
    for m in available:
        low = m.lower()
        if "tts" in low and m not in tts_chain:
            tts_chain.append(m)
    if not tts_chain:
        tts_chain = list(PREFERRED_TTS_MODELS)

    # Build Multimodal Translation chain
    trans_chain: List[str] = [m for m in PREFERRED_TRANS_MODELS if m in avail_set]
    excluded_tokens = ("tts", "image", "embedding", "robotics", "computer-use", "live", "veo", "imagen")
    for m in available:
        low = m.lower()
        if any(tok in low for tok in excluded_tokens):
            continue
        if "flash" in low and m not in trans_chain:
            trans_chain.append(m)
    if not trans_chain:
        trans_chain = list(PREFERRED_TRANS_MODELS)

    return trans_chain, tts_chain


def _parse_json_lenient(raw_text: str) -> dict:
    txt = (raw_text or "").strip()
    if txt.startswith("```"):
        txt = re.sub(r"^```(?:json)?\s*", "", txt, flags=re.IGNORECASE)
        txt = re.sub(r"\s*```$", "", txt)
    start = txt.find("{")
    end = txt.rfind("}")
    if start != -1 and end != -1 and end > start:
        txt = txt[start : end + 1]
    return json.loads(txt)


def _parse_time_to_ms(val, chunk_duration_ms: int) -> int:
    """Handle integer ms, float seconds, or 'MM:SS.mmm' strings safely."""
    if isinstance(val, (int, float)):
        num = float(val)
        # Heuristic: if Gemini returned small floats like 4.5 for a 60s+ chunk, treat?
        # No: our prompt strictly requests integer milliseconds (start_ms, end_ms).
        return max(0, min(chunk_duration_ms, int(round(num))))
    s = str(val or "").strip()
    if ":" in s:
        parts = s.replace(",", ".").split(":")
        try:
            if len(parts) == 2:
                sec = int(parts[0]) * 60 + float(parts[1])
            elif len(parts) == 3:
                sec = int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
            else:
                sec = 0.0
            return max(0, min(chunk_duration_ms, int(round(sec * 1000.0))))
        except ValueError:
            return 0
    try:
        return max(0, min(chunk_duration_ms, int(round(float(s)))))
    except ValueError:
        return 0


def coalesce_segments(
    segments: List[DubSegment],
    max_block_ms: int = 15000,
    max_gap_ms: int = 850,
) -> List[DubSegment]:
    """
    Merge tiny adjacent subtitle-like fragments of the same speaker into natural
    8–18 second Persian sentences. Produces fluent Persian prosody AND minimizes
    TTS request count.
    """
    if not segments:
        return []

    ordered = sorted(segments, key=lambda s: (s.start_ms, s.end_ms))
    # Fix any accidental timestamp overlaps from raw LLM output
    cleaned: List[DubSegment] = []
    for seg in ordered:
        text = re.sub(r"\s+", " ", (seg.fa_text or "")).strip()
        if not text:
            continue
        start = seg.start_ms
        if cleaned and start < cleaned[-1].end_ms:
            # Clamp small overlap
            mid = (cleaned[-1].end_ms + start) // 2
            if mid > cleaned[-1].start_ms + 400:
                cleaned[-1].end_ms = mid
                start = mid
            else:
                start = cleaned[-1].end_ms
        end = max(start + 800, seg.end_ms)
        cleaned.append(
            DubSegment(
                index=len(cleaned),
                start_ms=start,
                end_ms=end,
                speaker=seg.speaker or "S1",
                gender="F" if str(seg.gender).upper().startswith("F") else "M",
                fa_text=text,
            )
        )

    merged: List[DubSegment] = []
    for seg in cleaned:
        if not merged:
            merged.append(seg)
            continue
        prev = merged[-1]
        gap = seg.start_ms - prev.end_ms
        combined_dur = seg.end_ms - prev.start_ms
        same_speaker = prev.speaker == seg.speaker and prev.gender == seg.gender
        if same_speaker and gap <= max_gap_ms and combined_dur <= max_block_ms:
            prev.end_ms = seg.end_ms
            prev.fa_text = f"{prev.fa_text} {seg.fa_text}".strip()
        else:
            seg.index = len(merged)
            merged.append(seg)

    for idx, s in enumerate(merged):
        s.index = idx
    return merged


def _extract_retry_seconds(err_str: str) -> Optional[float]:
    m = re.search(r"retry(?:Delay| in)\s*[:=]?\s*['\"]?(\d+(?:\.\d+)?)s", err_str, re.IGNORECASE)
    if m:
        return min(90.0, max(5.0, float(m.group(1)) + 2.0))
    return None


def _is_daily_quota_exhausted(err_str: str) -> bool:
    low = err_str.lower()
    return (
        "perday" in low
        or "per_day" in low
        or "requests per day" in low
        or "limit: 0" in low
    )


def _filter_hints_for_chunk(hint_text: str, start_ms: int, end_ms: int) -> str:
    if not hint_text:
        return ""
    out: List[str] = []
    for line in hint_text.splitlines():
        m = re.match(r"\[(\d+):(\d+):(\d+(?:\.\d+)?)-", line)
        if not m:
            continue
        sec = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
        ms = int(sec * 1000)
        if start_ms - 2000 <= ms <= end_ms + 2000:
            rel_sec = max(0.0, (ms - start_ms) / 1000.0)
            rest = line.split("]", 1)[-1].strip()
            out.append(f"[{rel_sec:.1f}s] {rest}")
    return "\n".join(out)[:14000]


def translate_media_with_gemini(
    api_key: str,
    title_orig: str,
    duration_sec: float,
    audio_chunks: List[AudioChunk],
    subtitle_hint_text: str = "",
    style_mode: str = "conversational",
) -> Tuple[DubScript, List[str]]:
    """
    Upload audio chunks to Gemini Files API and produce a complete, accurately timed
    Persian dubbing script. Also returns discovered TTS model list.
    """
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    trans_models, tts_models = discover_gemini_models(client)
    print(f"  [Gemini] مدل‌های ترجمه در دسترس: {trans_models[:4]}")
    print(f"  [Gemini] مدل‌های گوینده صوتی (TTS) در دسترس: {tts_models[:4]}")

    style_desc = {
        "conversational": "محاوره‌ای طبیعی، روان و صمیمی (مناسب یوتیوب و دوبله روزمره فارسی)",
        "formal": "معیار، مستند، دقیق و خوش‌بیان (مناسب ویدیوهای علمی، خبری و آموزشی)",
        "energetic": "پرانرژی، جذاب و هیجانی با لحن زنده یوتیوبی",
    }.get(style_mode, "محاوره‌ای طبیعی و روان دوبله فارسی")

    # Scale target block duration for longer videos so TTS call count stays quota-friendly
    target_window_sec = "10 تا 18 ثانیه" if duration_sec <= 660 else "15 تا 25 ثانیه"
    max_block_ms = 16000 if duration_sec <= 660 else 24000

    all_segments: List[DubSegment] = []
    title_fa = title_orig
    summary_fa = ""
    trans_model_used = trans_models[0]

    for chunk in audio_chunks:
        chunk_dur_ms = chunk.end_ms - chunk.start_ms
        chunk_dur_sec = chunk_dur_ms / 1000.0
        chunk_hints = _filter_hints_for_chunk(subtitle_hint_text, chunk.start_ms, chunk.end_ms)

        print(
            f"  [Gemini] آپلود قطعه صوتی {chunk.index + 1}/{len(audio_chunks)} "
            f"({chunk_dur_sec:.0f} ثانیه) برای تحلیل صوت و ترجمه..."
        )
        uploaded = client.files.upload(
            file=str(chunk.path),
            config={"mime_type": "audio/ogg"},
        )
        try:
            for _ in range(45):
                state = getattr(getattr(uploaded, "state", None), "name", "ACTIVE")
                if state in ("ACTIVE", "", None):
                    break
                if state == "FAILED":
                    raise RuntimeError("پردازش فایل صوتی در سرور Gemini ناموفق بود.")
                time.sleep(2)
                uploaded = client.files.get(name=uploaded.name)

            hint_section = (
                f"\nراهنمای تقریبی زمان‌بندی زیرنویس اصلی این بخش (نسبت به شروع همین قطعه صوتی از ثانیه 0):\n{chunk_hints}\n"
                if chunk_hints
                else ""
            )

            prompt = f"""تو یک مدیر دوبلاژ حرفه‌ای فارسی هستی. به این فایل صوتی ({chunk_dur_sec:.1f} ثانیه، از عنوان اصلی «{title_orig}») با دقت گوش بده و اسکریپت دوبله فارسی دقیق و همگام با زمان تولید کن.

قوانین حیاتی دوبله:
1. لحن ترجمه: {style_desc}.
2. جملات شکسته ۲ ثانیه‌ای نساز! صحبت‌های پیوسته هر گوینده را در بلوک‌های طبیعی و خوش‌ریتمِ حدود {target_window_sec} گروه‌بندی کن تا ساختار جمله فارسی (فعل در انتهای جمله) کاملاً طبیعی و سینمایی باشد. وقتی گوینده عوض می‌شود یا مکث بلند (بیش از ۱ ثانیه) وجود دارد، بلوک جدید بساز.
3. طول متن فارسی هر بلوک (`fa_text`) باید طوری تنظیم شود که خواندن طبیعی آن دقیقاً در بازه زمانی `[start_ms, end_ms]` جا بگیرد (حدود ۲.۵ تا ۳ کلمه در هر ثانیه).
4. `start_ms` و `end_ms` باید عدد صحیح بر حسب **میلی‌ثانیه** نسبت به ابتدای همین فایل صوتی (بین 0 تا {chunk_dur_ms}) باشند (مثلاً ثانیه 12.5 می‌شود 12500).
5. در `fa_text` فقط متن خالص گفتاری فارسی بنویس: بدون پرانتز توضیحی، بدون ایموجی، بدون مارک‌داون؛ کلمات انگلیسی یا اعداد مهم را طوری بنویس که گوینده فارسی‌زبان بدون تپق تلفظ کند.
6. جنسیت هر گوینده را با `"M"` (مرد) یا `"F"` (زن) و شناسه گوینده را با `"S1"`, `"S2"` مشخص کن.
7. اگر بخشی از ویدیو فقط موسیقی یا سکوت است، برای آن بازه سگمنتی نساز.
{hint_section}
خروجی را **فقط** به شکل JSON معتبر با این ساختار دقیق برگردان:
{{
  "title_fa": "ترجمه جذاب عنوان ویدیو به فارسی",
  "summary_fa": "خلاصه یک‌خطی ویدیو به فارسی",
  "segments": [
    {{
      "start_ms": 1200,
      "end_ms": 12800,
      "speaker": "S1",
      "gender": "M",
      "fa_text": "متن دوبله فارسی روان..."
    }}
  ]
}}"""

            parsed_json: Optional[dict] = None
            last_exc: Optional[Exception] = None

            for model_name in trans_models:
                for attempt in range(2):
                    try:
                        resp = client.models.generate_content(
                            model=model_name,
                            contents=[uploaded, prompt],
                            config=types.GenerateContentConfig(
                                temperature=0.25,
                                response_mime_type="application/json",
                            ),
                        )
                        parsed_json = _parse_json_lenient(resp.text or "")
                        trans_model_used = model_name
                        break
                    except Exception as exc:
                        last_exc = exc
                        err_s = str(exc)
                        if "429" in err_s or "RESOURCE_EXHAUSTED" in err_s:
                            if _is_daily_quota_exhausted(err_s):
                                print(f"  [Gemini] سهمیه روزانه {model_name} پر است؛ تغییر به مدل بعدی...")
                                break
                            wait_s = _extract_retry_seconds(err_s) or (18.0 * (attempt + 1))
                            print(f"  [Gemini] محدودیت سرعت روی {model_name}، صبر به مدت {wait_s:.0f} ثانیه...")
                            time.sleep(wait_s)
                        elif "404" in err_s or "NOT_FOUND" in err_s:
                            break
                        else:
                            time.sleep(4)
                if parsed_json is not None:
                    break

            if parsed_json is None:
                raise RuntimeError(f"خطا در ترجمه صوت با Gemini: {last_exc}")

            if chunk.index == 0:
                title_fa = str(parsed_json.get("title_fa") or title_orig).strip()
                summary_fa = str(parsed_json.get("summary_fa") or "").strip()

            raw_segs = parsed_json.get("segments") or []
            for item in raw_segs:
                if not isinstance(item, dict):
                    continue
                fa_text = str(item.get("fa_text") or "").strip()
                if not fa_text:
                    continue
                s_ms = _parse_time_to_ms(item.get("start_ms", 0), chunk_dur_ms)
                e_ms = _parse_time_to_ms(item.get("end_ms", s_ms + 3000), chunk_dur_ms)
                if e_ms <= s_ms:
                    e_ms = min(chunk_dur_ms, s_ms + 3500)
                all_segments.append(
                    DubSegment(
                        index=len(all_segments),
                        start_ms=chunk.start_ms + s_ms,
                        end_ms=chunk.start_ms + e_ms,
                        speaker=str(item.get("speaker") or "S1"),
                        gender=str(item.get("gender") or "M"),
                        fa_text=fa_text,
                    )
                )
        finally:
            try:
                client.files.delete(name=uploaded.name)
            except Exception:
                pass

    coalesced = coalesce_segments(all_segments, max_block_ms=max_block_ms)
    if not coalesced:
        raise RuntimeError(
            "گفتار قابل ترجمه‌ای در این ویدیو شناسایی نشد (ممکن است ویدیو بدون کلام باشد)."
        )

    return (
        DubScript(
            title_fa=title_fa,
            summary_fa=summary_fa,
            segments=coalesced,
            trans_model_used=trans_model_used,
        ),
        tts_models,
    )


def choose_voice_for_segment(
    seg: DubSegment,
    preferred_voice: str,
    speaker_voice_map: Dict[str, str],
) -> str:
    if preferred_voice and preferred_voice != "auto" and preferred_voice in ALL_VALID_VOICES:
        return preferred_voice

    key = f"{seg.speaker}_{seg.gender}"
    if key in speaker_voice_map:
        return speaker_voice_map[key]

    pool = FEMALE_VOICES if seg.gender.upper().startswith("F") else MALE_VOICES
    used_in_gender = sum(1 for k in speaker_voice_map if k.endswith(f"_{seg.gender}"))
    chosen = pool[used_in_gender % len(pool)]
    speaker_voice_map[key] = chosen
    return chosen


def synthesize_script_with_gemini_tts(
    api_key: str,
    script: DubScript,
    tts_models: List[str],
    output_dir: Path,
    preferred_voice: str = "auto",
    progress_cb: Optional[Callable[[int, int], None]] = None,
) -> str:
    """
    Synthesize every Persian segment into a clean WAV file using Gemini Native TTS.
    Automatically handles rate limits and fails over across Gemini TTS models if needed.
    """
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    output_dir.mkdir(parents=True, exist_ok=True)

    active_models = list(tts_models) if tts_models else list(PREFERRED_TTS_MODELS)
    model_idx = 0
    speaker_voice_map: Dict[str, str] = {}
    tts_model_used = active_models[0]

    total = len(script.segments)
    for i, seg in enumerate(script.segments):
        voice_name = choose_voice_for_segment(seg, preferred_voice, speaker_voice_map)
        out_wav = output_dir / f"seg_{seg.index:04d}.wav"

        synthesized = False
        last_err: Optional[Exception] = None

        while model_idx < len(active_models) and not synthesized:
            cur_model = active_models[model_idx]
            for attempt in range(3):
                try:
                    resp = client.models.generate_content(
                        model=cur_model,
                        contents=seg.fa_text,
                        config=types.GenerateContentConfig(
                            response_modalities=["AUDIO"],
                            speech_config=types.SpeechConfig(
                                voice_config=types.VoiceConfig(
                                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                        voice_name=voice_name
                                    )
                                )
                            ),
                        ),
                    )
                    audio_bytes: Optional[bytes] = None
                    mime_type = ""
                    for part in getattr(resp, "parts", []) or []:
                        inline = getattr(part, "inline_data", None)
                        if inline and getattr(inline, "data", None):
                            raw_data = inline.data
                            audio_bytes = (
                                raw_data
                                if isinstance(raw_data, (bytes, bytearray))
                                else bytes(raw_data)
                            )
                            mime_type = str(getattr(inline, "mime_type", "") or "")
                            break

                    if not audio_bytes or len(audio_bytes) < 200:
                        raise RuntimeError(f"پاسخ صوتی خالی از مدل {cur_model}")

                    write_pcm_or_wav(out_wav, bytes(audio_bytes), mime_type)
                    seg.wav_path = out_wav
                    tts_model_used = cur_model
                    synthesized = True
                    break

                except Exception as exc:
                    last_err = exc
                    err_s = str(exc)
                    if "404" in err_s or "NOT_FOUND" in err_s or "not supported" in err_s.lower():
                        print(f"  [TTS] مدل {cur_model} در دسترس نیست؛ سوییچ به مدل بعدی...")
                        model_idx += 1
                        break
                    if "429" in err_s or "RESOURCE_EXHAUSTED" in err_s:
                        if _is_daily_quota_exhausted(err_s) and model_idx + 1 < len(active_models):
                            print(
                                f"  [TTS] سهمیه روزانه {cur_model} تکمیل شد؛ سوییچ خودکار به "
                                f"{active_models[model_idx + 1]}..."
                            )
                            model_idx += 1
                            break
                        wait_s = _extract_retry_seconds(err_s) or (20.0 * (attempt + 1))
                        print(
                            f"  [TTS] رعایت محدودیت نرخ درخواست Gemini ({cur_model}) — "
                            f"توقف کوتاه {wait_s:.0f} ثانیه‌ای..."
                        )
                        time.sleep(wait_s)
                        if attempt == 2 and model_idx + 1 < len(active_models):
                            model_idx += 1
                            break
                    else:
                        time.sleep(3.0 * (attempt + 1))
            else:
                if not synthesized:
                    model_idx += 1

        if not synthesized:
            raise RuntimeError(
                f"تولید صدای فارسی در قطعه {i + 1}/{total} با کلید Gemini متوقف شد "
                f"(احتمالاً سهمیه روزانه کلید رایگان به پایان رسیده است): {last_err}"
            )

        print(f"  [TTS] قطعه {i + 1}/{total} با صدای {voice_name} ({tts_model_used}) ساخته شد.")
        if progress_cb:
            progress_cb(i + 1, total)

    script.tts_model_used = tts_model_used
    return tts_model_used
