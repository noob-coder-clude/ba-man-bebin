# Cloudflare Tunnel · تونل کلادفلر

Cloudflare Tunnel (`cloudflared`) یک اتصال **خروجی** از سرور تو به شبکه‌ی کلادفلر برقرار می‌کند — برعکس رکورد A که سرور تو را **خام** روی اینترنت نشان می‌دهد.

## چرا تونل بهتر از رکورد A است؟

| مسئله | رکورد A | تونل |
|---|---|---|
| IP سرور لو می‌رود | ❌ بله، IP واقعی دیده می‌شود | ✅ کاملاً مخفی |
| فیلترینگ IP | ❌ اگر IP بلاک شود، کل سایت قطع می‌شود | ✅ ترافیک از طریق کلادفلر رد می‌شود؛ IP سرور نقشی ندارد |
| عوض کردن IP سرور | نیاز به تغییر DNS | بدون تغییر DNS — تونل خودکار وصل می‌شود |
| Let's Encrypt | لازم است | ❌ لازم نیست — کلادفلر خودش گواهی می‌دهد |
| پهنای باند | مستقیم | از کلادفلر رد می‌شود (حالت رایگان: نامحدود) |

> **خلاصه:** اگر IP سرورت فیلتر شده یا نگران فیلتر شدنش هستی، تونل بهترین راه است.

---

## روش ۱ — Quick Tunnel (بدون حساب)

سریع‌ترین راه — حتی حساب کلادفلر هم نمی‌خواهد:

```bash
cloudflared tunnel --url http://localhost:3000
```

یک آدرس موقتی مثل `https://random-words.trycloudflare.com` می‌دهد. مناسب برای تست سریع؛ **بعد از بستن ترمینال قطع می‌شود** و آدرس عوض می‌شود.

---

## روش ۲ — Named Tunnel (پایدار، با حساب)

### ۱. نصب `cloudflared`

```bash
# Debian / Ubuntu
curl -fsSL https://pkg.cloudflare.com/cloudflared-stable-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# یا مستقیم از باینری
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

### ۲. لاگین

```bash
cloudflared tunnel login
```

مرورگر باز می‌شود؛ دامنه‌ای که روی حساب کلادفلرت است را انتخاب کن. یک گواهی در `~/.cloudflared/cert.pem` ذخیره می‌شود.

### ۳. ساخت تونل

```bash
cloudflared tunnel create bmb
# → Tunnel credentials written to ~/.cloudflared/<TUNNEL_ID>.json
```

آیدی تونل را یادت بمان (یا در `.env` بگذار).

### ۴. تنظیم DNS

```bash
cloudflared tunnel route dns bmb watch.yourdomain.com
# → CNAME watch.yourdomain.com → <TUNNEL_ID>.cfargotunnel.com
```

### ۵. فایل تنظیمات

```bash
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: bmb
credentials-file: ~/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: watch.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
EOF
```

خط آخر (catch-all 404) **الزامی** است.

### ۶. تست و اجرا

```bash
cloudflared tunnel run bmb
```

اگر همه‌چیز درست باشد، `https://watch.yourdomain.com` سایتت را نشان می‌دهد.

---

## اجرا به‌عنوان سرویس systemd

```bash
cat > /etc/systemd/system/cloudflared-bmb.service << 'EOF'
[Unit]
Description=Cloudflare Tunnel for Ba Man Bebin
After=network.target

[Service]
Type=notify
ExecStart=/usr/local/bin/cloudflared tunnel run bmb
Restart=on-failure
RestartSec=5
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-bmb
sudo systemctl status cloudflared-bmb
```

---

## تنظیمات کلادفلر (داشبورد)

| بخش | مقدار | چرا |
|---|---|---|
| **SSL/TLS → mode** | Full (strict) | تونل خودش HTTPS دارد |
| **Network → WebSockets** | ✅ On | Socket.IO وگرنه کار نمی‌کند |
| **Speed → Brotli** | ✅ On | فشرده‌سازی بهتر |
| **Cache → config** | Skip `/api/*` و `/socket.io/*` | داده‌ی زنده نباید کش شود |

---

## چند دامنه روی یک تونل

```yaml
ingress:
  - hostname: watch.domain1.com
    service: http://localhost:3000
  - hostname: film.domain2.ir
    service: http://localhost:3000
  - service: http_status:404
```

هر دو دامنه باید با `cloudflared tunnel route dns` ثبت شده باشند.

---

## ترکیب با Docker

اگر بامنببین روی داکر اجرا می‌شود:

```bash
# تونل مستقیم به کانتینر وصل شود
cloudflared tunnel --url http://host.docker.internal:3000
```

یا اگر `cloudflared` خودش داخل داکر است:

```yaml
# docker-compose.yml
services:
  app:
    build: .
    ports: ["3000:3000"]

  tunnel:
    image: cloudflare/cloudflared:latest
    command: tunnel run bmb
    volumes:
      - ~/.cloudflared:/etc/cloudflared:ro
    depends_on: [app]
```

---

## عیب‌یابی

| مشکل | راه‌حل |
|---|---|
| `ERR_TLS` | SSL/TLS را روی **Full** بگذار (نه Flexible) |
| WebSocket وصل نمی‌شود | در داشبورد: Network → WebSockets = On |
| تونل قطع می‌شود | `Restart=on-failure` در systemd بررسی کن؛ لاگ: `journalctl -u cloudflared-bmb -f` |
| آدرس `trycloudflare.com` عوض شد | طبیعی است — Quick Tunnel موقتی است؛ از Named Tunnel استفاده کن |
| پینگ بالا | کلادفلر نزدیک‌ترین دیتاسنتر را انتخاب می‌کند؛ موقع `tunnel run` لاگ را چک کن |

---

## مقایسه: تونل vs رکورد A vs پروکسی کلادفلر

| | رکورد A (ابر خاکستری) | پروکسی کلادفلر (ابر نارنجی) | تونل |
|---|---|---|---|
| IP مخفی | ❌ | ✅ | ✅ |
| فیلترینگ IP | آسیب‌پذیر | محافظت نسبی | محافظت کامل |
| Let's Encrypt نیاز | بله | بله | نه |
| پورت ۴۴۳ باز | بله | بله | نه (فقط خروجی) |
| WebSocket | مستقیم | نیاز به On کردن | خودکار |
| مناسب برای | سرور با IP ثابت | سرور پشت کلادفلر | سرور پشت NAT / فیلتر |
