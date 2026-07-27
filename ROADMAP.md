# نقشه راه · Ba Man Bebin Roadmap

## ✅ فاز ۱ — رفع باگ و بهینه‌سازی موبایل

- [x] آیکون پلی برعکس → `border-left` به‌جای `border-inline-start` (مثلث پلی همیشه به راست اشاره می‌کند)
- [x] overlay دکمه پلی وسط صفحه (`play-gate`) با CSS triangle و حداقل ۴۸×۴۸px
- [x] `showPlayGate()` بعد از `applySource()` برای حالت autoplay blocked
- [x] بهینه‌سازی موبایل: کنترل‌ها جمع‌وجور، دکمه‌ها ≥۴۴px، چت ارتفاع مناسب
- [x] حرکات لمسی MX Player: روشنایی (نیمه چپ)، بلندی صدا (نیمه راست)، seek (افقی)، دو ضربه ±۱۰s
- [x] فوتر: ساخته شده با ❤️ · BA MAN BEBIN 2026
- [x] صفحه وضعیت گرافیکی `/status` با حلقه SVG، uptime، CPU/RAM، نسخه Node/ffmpeg/yt-dlp
- [x] endpoint `/api/system` با `os.cpus()`, `os.totalmem()`, `process.uptime()`

---

## 🔜 فاز ۲ — تماس تصویری/صوتی + کم شدن هوشمند صدا

**تماس تصویری/صوتی با WebRTC**
- ورودی/خروجی صدا و تصویر با `getUserMedia()` و `RTCPeerConnection`
- Signalling از طریق Socket.IO (رویدادهای جدید `call:offer`, `call:answer`, `call:ice-candidate`)
- نمایش thumbnails دیگر اعضای اتاق کنار چت
- میکروفون/دوربین فقط برای میزبان یا کسی که دکمه «تماس» را بزده
- مد说话+پخش: صدای فیلم و صدای تماس همزمان با `AudioContext` ترکیب می‌شوند

**کم شدن هوشمند صدای فیلم (Web Audio API — نه AI)**
- `AnalyserNode` روی صدای فیلم: وقتی شدت صدای فیلم بالا باشد `GainNode` را کم می‌کند
- وقتی صدای فیلم پایین/سکوت باشد `GainNode` را برمی‌گرداند
- `AnalyserNode.getByteFrequencyData()` → إذا `average > threshold` → `gain.gain.setTargetAtTime(low, ctx.currentTime, ramp)`
- کاملاً بومی و آنی، بدون هیچ پردازش AI
- کاربر می‌تواند حساسیت و شدت کم‌شدن را تنظیم کند

---

## 🔜 فاز ۳ — زیرنویس و دوبله

- بارگذاری فایل SRT/VTT/ASS و sync با playhead
- استخراج زیرنویس از YouTube API (`yt-dlp --write-sub`)
- نمایش زیرنویس روی `<video>` با WebVTT (`<track>` یا overlay)
- پشتیبانی از چند زبان زیرنویس همزمان
- دوبله/نظرات فرعی: پخش فایل صوتی جداگانه همگام با فیلم (مثل نریشن فارسی روی فیلم انگلیسی)
- endpoint `/api/subtitles` برای بارگذاری و تبدیل فرمت‌ها

---

## 🔜 فاز ۴ — پیش‌نمایش و اسکرین‌شات و تاریخچه

- پیش‌نمایش اتاق: thumbnail ویدیو + تعداد اعضا قبل از ورود
- اسکرین‌شات از پلیر → `canvas.drawImage(video)` → ذخیره و اشتراک‌گذاری
- تاریخچه اتاق‌ها: لاگ ورود/خروج، تغییر منبع، seek events (ephemeral)
- iframe embed: `<iframe src="/embed/:id">` برای وبلاگ‌ها و سایت‌ها
- Share API: `navigator.share()` برای موبایل

---

## 🔜 فاز ۵ — دکمه‌های Deploy، ربات تلگرام و گوگل درایو

- دکمه Deploy یک‌کلیکی: Railway / Render / Fly.io / Vercel
- ربات تلگرام: ساخت اتاق + دریافت لینک دعوت + وضعیت سرور + اعلان‌ها
- گوگل درایو: ویدیوهای Drive رو مستقیم در اتاق پخش کن (`/api/media/drive?url=`)
- QR code لینک دعوت در اتاق
- PWA manifest + Service Worker برای offline و installable
