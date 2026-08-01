# بهینه — پروژه‌ی اندروید (APK)

اپ شخصی: WebView میزبان رابط وب + ماژول‌های نیتیو Kotlin.

## قابلیت‌های این نسخه (v0.1)
- **پل نیتیو** `BehineNative`: باتری/دما/رم واقعی، لیست برنامه‌های پرکاربرد روز (Usage Stats)
- **Fore-close واقعی**: سرویس Accessibility روی «توقف اجباری» در تنظیمات می‌زند (روش استاندارد کلینرها — با فعال‌سازی دستی کاربر)
- پاک‌سازی و آنتی‌ویروس: فعلاً نمایشی (مرحله‌ی بعد: هش SHA-256 + دیتابیس OTA)

## مجوزها (persona/ sideload — نه Play Store)
| مجوز | چرا |
|---|---|
| QUERY_ALL_PACKAGES | لیست برنامه‌های نصب‌شده |
| PACKAGE_USAGE_STATS | پیدا کردن پرمصرف‌ترین‌ها (فعال‌سازی از تنظیمات) |
| Accessibility Service | زدن «توقف اجباری» واقعی |
| MANAGE_EXTERNAL_STORAGE | اسکن فایل‌های اضافه (مرحله‌ی بعد) |
| INTERNET | آپدیت دیتابیس تهدید |
| KILL_BACKGROUND_PROCESSES | تکمیل‌کننده‌ی بستن |

## بیلد APK
**روش خودکار (پیشنهادی):** فایل `ci/android-apk.yml` را از رابط گیت‌هاب کپی به مسیر `.github/workflows/android-apk.yml` کنید (Actions → New workflow → paste) — بعد از هر پوش، APK در بخش Artifacts آن ران آماده می‌شود.
(توکن بات Arena اجازه‌ی ساخت workflow ندارد؛ برای همین فایل این‌جاست.)

**روش دستی:**
```bash
cd android-app && gradle assembleDebug
# خروجی: app/build/outputs/apk/debug/app-debug.apk
```

## نصب
APK دیباگ با کلید دیباگ امضا می‌شود → هنگام نصب «نصب از منابع ناشناس» را بزنید. Play Protect ممکن است به MANAGE_EXTERNAL_STORAGE و Accessibility هشدار عمومی بدهد (طبیعی برای اپ سایدلود غیر-Play).
