# با من ببین · Ba Man Bebin

یک پلتفرم **تماشای همزمان (Watch Party)** — فیلم و ویدیو را کاملاً همگام با دوستانت ببین، با چت زنده و واکنش‌های لحظه‌ای.

A sleek, bilingual (فارسی/English, RTL + LTR) watch-party platform. Create a room, share the link, and watch in perfect sync.

---

## ✨ امکانات / Features

| | |
|---|---|
| 🎯 **همگام‌سازی دقیق** | پخش/توقف/جابه‌جایی برای همه هم‌زمان؛ تازه‌واردها روی همان لحظه می‌افتند |
| 💬 **چت زنده** | گفتگو کنار پلیر، بدون خروج از فیلم |
| ✨ **واکنش‌های شناور** | ایموجی‌هایی که روی صفحه همه بالا می‌روند |
| 📺 **یوتیوب + فایل محلی** | لینک یوتیوب یا فایل خودت (فایل هرگز آپلود نمی‌شود) |
| 🎬 **کنترل میزبان** | میزبان پخش را کنترل می‌کند و می‌تواند نقش را واگذار کند |
| 🌐 **دو زبانه** | فارسی (RTL) و انگلیسی (LTR) با یک کلیک |
| 🔒 **بدون حساب کاربری** | اتاق‌ها بعد از خالی شدن پاک می‌شوند |

---

## 🚀 اجرای محلی / Run locally

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # با ری‌استارت خودکار
```

---

## 🐳 روش ۱ — Docker (پیشنهادی)

```bash
cp .env.example .env
# دامنه‌ات را در deploy/nginx.conf جایگزین example.com کن
docker compose up -d --build
```

سایت روی پورت ۸۰ بالا می‌آید. برای گرفتن گواهی SSL:

```bash
docker run --rm -it \
  -v ./deploy/certbot/conf:/etc/letsencrypt \
  -v ./deploy/certbot/www:/var/www/certbot \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d example.com -d www.example.com --email you@example.com --agree-tos

docker compose restart nginx
```

> نکته: بار اول که هنوز گواهی نداری، بلوک `listen 443` را در `deploy/nginx.conf` موقتاً کامنت کن تا nginx بالا بیاید.

---

## 🖥️ روش ۲ — نصب مستقیم روی سرور (Ubuntu/Debian)

یک دستور، همه‌چیز آماده — Node.js، systemd، Nginx و SSL:

```bash
git clone <repo-url> ba-man-bebin && cd ba-man-bebin
sudo bash deploy/deploy.sh example.com you@example.com
```

اسکریپت به‌ترتیب: Node 22 نصب می‌کند → اپ را در `/var/www/ba-man-bebin` می‌گذارد →
سرویس systemd می‌سازد → Nginx را با پشتیبانی WebSocket تنظیم می‌کند → گواهی Let's Encrypt می‌گیرد.

```bash
systemctl status ba-man-bebin      # وضعیت
journalctl -u ba-man-bebin -f      # لاگ زنده
systemctl restart ba-man-bebin     # ری‌استارت
```

### به‌روزرسانی بعدی

```bash
cd /path/to/repo && git pull
sudo bash deploy/deploy.sh example.com
```

---

## ⚙️ تنظیمات / Configuration

فایل `.env` (از روی `.env.example`):

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `PORT` | `3000` | پورت اپ |
| `NODE_ENV` | `production` | حالت اجرا |
| `CORS_ORIGIN` | `*` | دامنه‌های مجاز Socket.IO (با کاما جدا شود) |
| `MAX_ROOM_USERS` | `50` | حداکثر نفرات هر اتاق |
| `PUBLIC_ORIGIN` | — | آدرس عمومی سایت |

---

## 🧱 معماری / Architecture

```
server/
  index.js     Express + Socket.IO؛ مسیرها، امنیت (helmet/CSP)، رویدادهای بلادرنگ
  rooms.js     نگهدارنده حالت اتاق‌ها در حافظه + برون‌یابی زمان پخش
public/
  index.html   لندینگ‌پیج
  room.html    اتاق تماشا
  404.html
  assets/css/style.css     دیزاین‌سیستم (تیره، شیشه‌ای، RTL/LTR)
  assets/js/i18n.js        دیکشنری دو زبانه + تغییر جهت صفحه
  assets/js/home.js        منطق لندینگ
  assets/js/room.js        پلیر یکپارچه (YouTube/فایل)، چت، همگام‌سازی
deploy/
  nginx.conf               ریورس‌پروکسی + WebSocket + SSL
  ba-man-bebin.service     یونیت systemd
  deploy.sh                نصب خودکار روی VPS
```

**چطور همگام می‌ماند:** سرور «منبع حقیقت» را نگه می‌دارد (`playing`, `time`, `updatedAt`).
هر کلاینت که وارد می‌شود، زمان پخش با توجه به زمان سپری‌شده برون‌یابی می‌شود، پس دقیقاً
روی فریم درست می‌افتد. میزبان هر ۵ ثانیه یک ضربان (heartbeat) می‌فرستد و اگر اختلاف
کلاینتی بیش از ۰٫۶ ثانیه شود، خودش را اصلاح می‌کند.

### رویدادهای Socket.IO

| رویداد | جهت | کاربرد |
|---|---|---|
| `room:join` | client → server | ورود به اتاق، دریافت وضعیت کامل |
| `player:source` | دوطرفه | تغییر منبع ویدیو (فقط میزبان) |
| `player:control` | client → server | پخش/توقف/seek (فقط میزبان) |
| `player:sync` | server → clients | اعمال وضعیت جدید |
| `player:request-sync` | client → server | همگام‌سازی دستی |
| `chat:message` / `chat:reaction` | دوطرفه | چت و ایموجی |
| `room:transfer-host` | client → server | واگذاری نقش میزبان |

---

## 🔌 API

| متد | مسیر | توضیح |
|---|---|---|
| `POST` | `/api/rooms` | ساخت اتاق جدید |
| `GET` | `/api/rooms/:id` | اطلاعات اتاق |
| `GET` | `/api/stats` | آمار زنده |
| `GET` | `/healthz` | health check |

---

## 📝 نکات

- **فایل محلی آپلود نمی‌شود** — فقط خط زمانی همگام می‌شود، پس همه باید همان فایل را باز کنند.
- اتاق‌ها در حافظه‌اند؛ با ری‌استارت سرور پاک می‌شوند (برای این کاربرد کاملاً کافی است).
- اگر پشت Cloudflare هستی، WebSocket را در پنل فعال نگه دار.

MIT License.
