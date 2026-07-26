# نصب و راه‌اندازی · Installation

راهنمای کامل راه‌اندازی **با من ببین** روی سرور شخصی. کل کار حدود ۵ دقیقه است.

---

## پیش‌نیازها

| مورد | توضیح |
|---|---|
| سرور | یک VPS با Ubuntu 22.04 یا جدیدتر (۱ گیگ رم کافی است) |
| دسترسی | کاربر `root` یا `sudo` |
| دامنه | مثلاً `app.boxd.sh` که رکورد `A` آن به IP سرور اشاره کند |
| پورت‌ها | ۸۰ و ۴۴۳ باز باشند |

> **قبل از هر کاری** رکورد DNS را تنظیم کن و چند دقیقه صبر کن. اگر دامنه به سرور
> اشاره نکند، مرحله گرفتن گواهی SSL شکست می‌خورد.

---

## گام ۱ — بررسی آمادگی سرور

قبل از نصب، مطمئن شو پورت‌ها باز است:

```bash
bash deploy/check-ports.sh app.boxd.sh
```

اگر هنوز مخزن را کلون نکرده‌ای، از روی سرور:

```bash
curl -fsSL https://raw.githubusercontent.com/noob-coder-clude/ba-man-bebin/main/deploy/check-ports.sh | bash -s -- app.boxd.sh
```

خروجی باید پورت ۸۰ و ۴۴۳ را **OPEN** نشان دهد. اگر بسته بود:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
```

> اگر سرورت پنل فایروال جداگانه دارد (Hetzner، OVH، DigitalOcean و…)،
> باید از آن پنل هم پورت‌ها را باز کنی — فقط `ufw` کافی نیست.

---

## گام ۲ — نصب

روی سرور، این سه خط:

```bash
git clone https://github.com/noob-coder-clude/ba-man-bebin.git
cd ba-man-bebin
sudo bash deploy/deploy.sh app.boxd.sh you@example.com
```

همین. اسکریپت خودش این کارها را می‌کند:

1. نصب Node.js 22 و Nginx
2. کپی برنامه در `/var/www/ba-man-bebin`
3. نصب وابستگی‌ها
4. ساخت سرویس systemd (با ری‌استارت خودکار)
5. تنظیم Nginx به‌عنوان reverse proxy با پشتیبانی WebSocket
6. گرفتن گواهی SSL از Let's Encrypt

> ایمیل را برای گرفتن SSL بده. اگر ندهی، سایت فقط روی HTTP بالا می‌آید.

---

## گام ۳ — بررسی نهایی

```bash
bash deploy/check-ports.sh app.boxd.sh
```

باید همه‌چیز ✓ باشد، از جمله **WebSocket upgrade accepted (101)** که برای
همگام‌سازی حیاتی است. حالا `https://app.boxd.sh` را باز کن.

اگر روی خود سرور تست می‌کنی:

```bash
bash deploy/check-ports.sh --local
```

---

## دستورهای روزمره

```bash
sudo systemctl status ba-man-bebin      # وضعیت سرویس
sudo systemctl restart ba-man-bebin     # ری‌استارت
sudo journalctl -u ba-man-bebin -f      # دیدن لاگ زنده
```

### به‌روزرسانی به نسخه جدید

```bash
cd ~/ba-man-bebin
git pull
sudo bash deploy/deploy.sh app.boxd.sh
```

### افزودن دامنه دوم

```bash
sudo bash deploy/add-domain.sh dovom.com you@example.com
```

هر دو دامنه به **یک سرور** وصل می‌شوند و اتاق‌ها مشترک‌اند.
جزئیات: [`deploy/MIRRORS.md`](deploy/MIRRORS.md)

---

## روش جایگزین: Docker

اگر Docker را ترجیح می‌دهی:

```bash
git clone https://github.com/noob-coder-clude/ba-man-bebin.git
cd ba-man-bebin
cp .env.example .env
sed -i 's/example.com/app.boxd.sh/g' deploy/nginx.conf
docker compose up -d --build
```

بار اول که هنوز گواهی SSL نداری، بلوک `listen 443` را در `deploy/nginx.conf`
موقتاً کامنت کن تا Nginx بالا بیاید، بعد گواهی بگیر:

```bash
docker run --rm -it \
  -v ./deploy/certbot/conf:/etc/letsencrypt \
  -v ./deploy/certbot/www:/var/www/certbot \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d app.boxd.sh --email you@example.com --agree-tos

docker compose restart nginx
```

---

## تنظیمات (اختیاری)

فایل `/var/www/ba-man-bebin/.env`:

```env
PORT=3000
MAX_ROOM_USERS=50

# چند دامنه روی همین سرور
PUBLIC_DOMAINS=app.boxd.sh,dovom.com

# پیشنهاد دامنه بر اساس کشور (اختیاری)
DOMAIN_HINTS=IR=dovom.com
```

بعد از تغییر: `sudo systemctl restart ba-man-bebin`

---

## رفع اشکال

| علامت | علت محتمل | راه‌حل |
|---|---|---|
| پورت ۸۰ بسته است | فایروال | `sudo ufw allow 80/tcp` + پنل فایروال سرویس‌دهنده |
| SSL گرفته نشد | DNS آماده نیست | چند دقیقه صبر کن، بعد `sudo certbot --nginx -d app.boxd.sh` |
| سایت باز می‌شود ولی همگام‌سازی کار نمی‌کند | WebSocket بسته است | اگر Cloudflare داری: Network → WebSockets = **On** |
| `502 Bad Gateway` | برنامه بالا نیست | `sudo journalctl -u ba-man-bebin -n 50` |
| ویدیو پخش نمی‌شود | لینک مشکل دارد | در اتاق دکمه **تست پخش** را بزن |
| لینک برای دوستت باز نمی‌شود | فیلترینگ | «پخش از طریق سرور» را روشن کن یا دامنه دوم اضافه کن |

### پورت ۸۰ باز است ولی سایت جواب نمی‌دهد؟

یعنی چیزی به پورت گوش می‌دهد ولی HTTP سالم برنمی‌گرداند:

```bash
sudo systemctl status nginx
sudo nginx -t                       # تست کانفیگ
sudo systemctl restart nginx
sudo ss -ltnp | grep -E ':80|:443'  # ببین چه چیزی گوش می‌دهد
```
