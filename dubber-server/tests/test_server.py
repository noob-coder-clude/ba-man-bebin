#!/usr/bin/env python3
"""Unit tests for the Cloud Persian Dubber backend modules."""
from __future__ import annotations

import array
import base64
import gzip
import json
import math
import sys
import tempfile
import unittest
import wave
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from audio_assembler import (  # noqa: E402
    SAMPLE_RATE,
    assemble_dubbed_timeline,
    format_srt_timestamp,
    trim_silence_samples,
)
from cookies_helper import prepare_cookies_file  # noqa: E402
from gemini_dubber import (  # noqa: E402
    DubSegment,
    choose_voice_for_segment,
    coalesce_segments,
    write_pcm_or_wav,
)
from yt_downloader import normalize_youtube_url  # noqa: E402


class TestCookiesHelper(unittest.TestCase):
    def test_netscape_quirks_and_gzip_b64(self):
        # Browser extensions often emit domain without leading dot + TRUE, or #HttpOnly_ lines
        raw_netscape = (
            "youtube.com\tTRUE\t/\tTRUE\t1893456000.55\tSID\tabc123sid\n"
            "#HttpOnly_.youtube.com\tFALSE\t/\tTRUE\t1893456000\t__Secure-1PSID\txyz987psid\n"
            ".example-unrelated.com\tTRUE\t/\tFALSE\t1893456000\tFOO\tbar\n"
        )
        gz_b64 = base64.b64encode(gzip.compress(raw_netscape.encode("utf-8"))).decode("ascii")
        with tempfile.TemporaryDirectory() as tmp:
            rep = prepare_cookies_file(Path(tmp), gz_b64=gz_b64)
            self.assertEqual(rep.source_format, "netscape")
            self.assertEqual(rep.total_cookies, 2)
            self.assertTrue(rep.has_auth_cookies)
            self.assertIn("SID", rep.found_auth_names)
            self.assertIn("__Secure-1PSID", rep.found_auth_names)

    def test_json_cookie_editor_format(self):
        payload = json.dumps(
            [
                {
                    "domain": ".youtube.com",
                    "name": "LOGIN_INFO",
                    "value": "token_val",
                    "path": "/",
                    "secure": True,
                    "httpOnly": True,
                    "expirationDate": 1900000000.12,
                },
                {
                    "domain": "google.com",
                    "name": "SAPISID",
                    "value": "sapi_val",
                },
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            rep = prepare_cookies_file(Path(tmp), raw_text=payload)
            self.assertEqual(rep.source_format, "json")
            self.assertEqual(rep.total_cookies, 2)
            self.assertTrue(rep.has_auth_cookies)

    def test_raw_cookie_header_string(self):
        hdr = "Cookie: VISITOR_INFO1_LIVE=aaa; SID=sid_secret; __Secure-3PSID=psid3_secret"
        with tempfile.TemporaryDirectory() as tmp:
            rep = prepare_cookies_file(Path(tmp), raw_text=hdr)
            self.assertEqual(rep.source_format, "header")
            self.assertEqual(rep.total_cookies, 3)
            self.assertTrue(rep.has_auth_cookies)


class TestYoutubeUrlNormalizer(unittest.TestCase):
    def test_variants(self):
        self.assertEqual(
            normalize_youtube_url("https://youtu.be/dQw4w9WgXcQ?si=abcd"),
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        )
        self.assertEqual(
            normalize_youtube_url("تماشا کن! https://m.youtube.com/shorts/dQw4w9WgXcQ?feature=share"),
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        )
        self.assertEqual(
            normalize_youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL12345&index=3"),
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        )


class TestGeminiHelpersAndTimeline(unittest.TestCase):
    def test_coalesce_and_voice_assignment(self):
        segs = [
            DubSegment(0, 1000, 3500, "S1", "M", "سلام دوستان،"),
            DubSegment(1, 3800, 7200, "S1", "M", "به ویدیوی جدید خوش آمدید."),
            DubSegment(2, 7400, 11000, "S2", "F", "ممنون که دعوتم کردید!"),
        ]
        merged = coalesce_segments(segs, max_block_ms=15000)
        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[0].fa_text, "سلام دوستان، به ویدیوی جدید خوش آمدید.")
        self.assertEqual(merged[0].start_ms, 1000)
        self.assertEqual(merged[0].end_ms, 7200)

        vmap = {}
        v1 = choose_voice_for_segment(merged[0], "auto", vmap)
        v2 = choose_voice_for_segment(merged[1], "auto", vmap)
        self.assertNotEqual(v1, v2)
        self.assertEqual(v1, "Orus")
        self.assertEqual(v2, "Aoede")

    def test_pcm_to_wav_and_timeline_assembly(self):
        with tempfile.TemporaryDirectory() as tmp:
            tdir = Path(tmp)
            # Generate 500ms tone surrounded by 100ms silence at 24kHz
            samples = array.array("h", [0] * 2400)
            for i in range(12000):
                samples.append(int(8000 * math.sin(2 * math.pi * 440 * i / SAMPLE_RATE)))
            samples.extend([0] * 2400)

            trimmed = trim_silence_samples(samples)
            self.assertLess(len(trimmed), len(samples))
            self.assertGreater(len(trimmed), 11500)

            wav1 = tdir / "s1.wav"
            write_pcm_or_wav(wav1, samples.tobytes(), "audio/L16;codec=pcm;rate=24000")
            with wave.open(str(wav1), "rb") as wf:
                self.assertEqual(wf.getframerate(), 24000)
                self.assertEqual(wf.getnchannels(), 1)

            seg = DubSegment(0, 1000, 2500, "S1", "M", "این یک تست دوبله فارسی است.", wav_path=wav1)
            master_wav, srt_path = assemble_dubbed_timeline([seg], 4000, tdir)
            self.assertTrue(master_wav.exists())
            self.assertTrue(srt_path.exists())
            srt_txt = srt_path.read_text(encoding="utf-8")
            self.assertIn("00:00:01,000 -->", srt_txt)
            self.assertIn("این یک تست دوبله فارسی است.", srt_txt)

    def test_srt_timestamp_format(self):
        self.assertEqual(format_srt_timestamp(3_723_456), "01:02:03,456")


if __name__ == "__main__":
    unittest.main()
