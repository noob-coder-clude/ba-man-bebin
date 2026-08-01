/* ═══════════════════════════════════════════════════════════
   Behine — AI Phone Optimizer · Prototype v0.4
   Cleaner · Battery log · Antivirus · minimal XERO-style UI
═══════════════════════════════════════════════════════════ */
"use strict";

/* ───────────────────────── i18n ───────────────────────── */
const I18N = {
  fa: {
    "app.name": "بهینه", "app.badge": "پروتوتایپ",
    "splash.tag": "بهینه‌ساز هوشمند گوشی",
    "tab.dash": "داشبورد", "tab.clean": "پاک‌سازی", "tab.apps": "برنامه‌ها", "tab.batt": "باتری", "tab.sec": "امنیت",
    "dash.score": "امتیاز سلامت", "dash.boost": "بوست هوشمند", "dash.findings": "یافته‌های هوش مصنوعی",
    "stat.ram": "رم", "stat.battery": "باتری", "stat.storage": "حافظه", "stat.temp": "دمای دستگاه",
    "verdict.3.t": "وضعیت بحرانی", "verdict.3.s": "مصرف رم بالاست؛ با بوست هوشمند درستش کن",
    "verdict.2.t": "نیاز به بهینه‌سازی", "verdict.2.s": "چند برنامهٔ پر‌مصرف در پس‌زمینه فعال‌اند",
    "verdict.1.t": "خوب است", "verdict.1.s": "کمی بهینه‌سازی، عملکرد را بهتر می‌کند",
    "verdict.0.t": "عالی!", "verdict.0.s": "دستگاه در بهترین وضعیت است ✨",
    "u.gb": "گیگ", "u.mb": "مگ",
    "qa.clean": "پاک‌سازی", "qa.scan": "امنیت", "qa.log": "لاگ باتری",
    "qa.clean.sub": "قابل آزادسازی", "qa.clean.done": "تمیزه ✨",
    "qa.sec.subok": "محافظت فعال", "qa.sec.subthreat": "۱ تهدید فعال!",
    "qa.log.sub": (n) => `امروز • ${faN(n)} رویداد`,
    "m.sec": "<b>۱ مورد مشکوک امنیتی</b> پیدا شد — اسکن کن",
    "m.junk": (s) => `<b>${s}</b> فایل اضافه قابل پاک‌سازیه`,
    "m.ramwarn": (n) => `<b>${faN(n)} برنامهٔ پر‌مصرف</b> در پس‌زمینه فعال‌اند`,
    "m.battok": "سلامت باتری ۹۱٪ — روند فرسودگی طبیعی است",
    "m.boost": (gb) => `بوست هوشمند می‌تواند <b>${gb}</b> رم آزاد کند`,
    /* cleaner */
    "clean.title": "پاک‌سازی هوشمند",
    "clean.last": (d) => d ? `آخرین پاک‌سازی: ${faN(d)} روز پیش` : "آخرین پاک‌سازی: همین الان ✨",
    "clean.junkfound": "فایل اضافه پیدا شد",
    "clean.scanned": (n) => `${faN(n)} مسیر اسکن شد • کامل`,
    "clean.badge.safe": "امن", "clean.badge.review": "بازبینی", "clean.cleaned": "پاک شد",
    "clean.selbar": (n, s) => `${faN(n)} مورد امن انتخاب شد • ${s}`,
    "clean.cta": "پاک‌سازی",
    "clean.hint": "💡 موارد «امن» بدون ریسک حذف می‌شوند؛ «بازبینی»‌ها را خودتان تأیید کنید. مدل AI فایل‌های حیاتی را تشخیص و حفظ می‌کند.",
    "clean.scan": "اسکن هوشمند حافظه…",
    "clean.wiping": "پاک‌سازی ایمن در حال انجام…",
    "clean.done.big": (s) => `${s} پاک شد`,
    "clean.done.sub": "فضای ذخیره‌سازی آزاد شد • هیچ فایل شخصی حذف نشد",
    "clean.empty": "همه‌چیز تمیزه ✨",
    /* apps */
    "apps.title": "مدیریت برنامه‌ها",
    "apps.running": (n) => `${faN(n)} برنامه در حال اجرا`,
    "apps.ramuse": "مصرف رم", "apps.sys": "سیستم", "apps.apps": "برنامه‌ها", "apps.cache": "کش", "apps.free": "آزاد",
    "apps.smartclose": "بستن هوشمند",
    "apps.ob_none": "همه‌چیز بهینه است ✨",
    "apps.ob_some": (n, mb) => `${faN(n)} برنامهٔ اضافه پیدا شد • آزادسازی ${faN(mb)} مگ`,
    "apps.hint": "💡 پیشنهادهای بستن توسط مدل یادگیری ماشین بر اساس الگوی استفادهٔ شما تولید می‌شود.",
    "badge.keep": "حفظ شود", "badge.hibern": "خواب زمستانی", "badge.close": "بستن پیشنهادی",
    "badge.closed": "بسته شده", "badge.lock": "محافظت‌شده",
    "app.drain": (d) => `${faN(d)}٪/ساع`, "app.idle": (m) => `${faN(m)} دقیقه بیکار`, "app.mb": (m) => `${faN(m)} مگ`,
    /* battery */
    "batt.title": "سلامت باتری",
    "batt.charging": "در حال شارژ ⚡", "batt.discharging": (h, m) => `${faN(h)}ساعت و ${faN(m)}دقیقه تا تخلیه (ML)`,
    "batt.maxcap": "حداکثر ظرفیت",
    "batt.peak": "عملکرد اوجهٔ عادی پشتیبانی می‌شود",
    "batt.cycles": "چرخه‌های شارژ", "batt.design": "ظرفیت طراحی", "batt.real": "ظرفیت واقعی فعلی",
    "batt.forecast": "پیش‌بینی ML", "batt.forecast.v": (mo) => `رسیدن به ۸۰٪ ظرفیت ≈ ${faN(mo)} ماه دیگر`,
    "batt.level24": "۲۴ ساعت اخیر", "batt.trend": "سلامت + پیش‌بینی",
    "batt.log": "لاگ باتری", "batt.log.today": "امروز",
    "batt.log.now": (l) => `${faN(l)}٪ در حال تخلیه`,
    "batt.cap.level": "نوسان سطح شارژ طی ۲۴ ساعت گذشته",
    "batt.cap.health": "افت ظرفیت ۶ ماه اخیر + پیش‌بینی ML (خط‌چین)",
    "batt.tip": "بر اساس عادت خواب شما، شارژ بهینه فعال شد: شارژ تا ۸۰٪ در شب و تکمیل تا صبح (کاهش فرسودگی).",
    /* security */
    "sec.title": "امنیت",
    "sec.db": (v) => `پایگاه تهدید v${faN(v)} • بروز`,
    "sec.protected": "محافظت فعال", "sec.threatt": "۱ تهدید فعال",
    "sec.lastscan": (t) => `آخرین اسکن: ${t}`,
    "sec.quick": "اسکن سریع", "sec.full": "اسکن کامل",
    "sec.scan.quick": "اسکن سریع در حال اجرا…", "sec.scan.full": "اسکن عمیق با AI…",
    "sec.files": (n) => `${faN(n)} فایل`,
    "sec.found1": "۱ تهدید یافت شد", "sec.safe2": "دستگاه امن است ✓",
    "sec.safesub": (n) => `${faN(n)} فایل بررسی شد • بدون تهدید`,
    "sec.threat.t": "۱ برنامه مشکوک", "sec.threat.trojan": "Flash Ultra.apk — تروجان FlashGen",
    "sec.qua": "قرنطینه", "sec.qua.close": "قرنطینه و تمام",
    "sec.rt": "محافظت لحظه‌ای", "sec.web": "محافظت وب", "sec.weekly": "اسکن خودکار هفتگی",
    "sec.audit": "ممیزی دسترسی با AI",
    "sec.badge.risk": "مشکوک", "sec.badge.ok": "استاندارد",
    "sec.stats": (s, f) => `اسکن‌های امروز: ${faN(s)} • فایل بررسی‌شده: ${faN(f)}`,
    /* ai */
    "ai.title": "مرکز هوش مصنوعی", "ai.sub": "یادگیری روی‌دستگاه • On-device",
    "ai.model": "مدل بهینه‌سازی نسخهٔ ۰٫۴", "ai.ondevice": "روی دستگاه",
    "ai.meta": (d, acc) => `${faN(d)} روز داده • دقت ${faN(acc)}٪ • ${faN(3412)} جلسه`,
    "ai.learning": "پیشرفت یادگیری الگوی استفاده",
    "ai.learnsub": "برای کالیبراسیون کامل، ۳۰ روز داده لازم است — مدل هر روز دقیق‌تر می‌شود.",
    "ai.insights": "بینش‌ها و پیش‌بینی‌ها", "ai.automation": "خودکارسازی",
    "ai.auto": "بوست خودکار هنگام رم بالای ۸۵٪",
    "ai.night": "بهینه‌سازی شبانه (۲:۰۰ بامداد)",
    "ai.charge": "شارژ بهینهٔ هوشمند",
    "conf": (c) => `اطمینان ${faN(c)}٪`,
    "i.1.t": "اوج فشار رم حوالی ۱۵:۰۰", "i.1.p": "الگوی روزهای کاری شما نشان می‌دهد مصرف رم بعدازظهر بالا می‌رود؛ بوست خودکار پیشنهاد می‌شود.",
    "i.2.t": "۱۲ عکس تکراری پیدا شد", "i.2.p": "ادغام نسخه‌ها ۱٫۱ گیگ آزاد می‌کند؛ نسخهٔ اصلی حفظ می‌شود.",
    "i.3.t": "پیش‌بینی تخلیهٔ باتری: ۲۱:۴۰", "i.3.p": "با نرخ مصرف فعلی، شارژ به ۲۰٪ حوالی ۲۱:۴۰ می‌رسد؛ بستن بازی‌ها ۴۵ دقیقه اضافه می‌کند.",
    "i.4.t": "شارژ ۲۰–۸۰٪ فرسودگی را نصف می‌کند", "i.4.p": "مدل چرخه‌های شارژ شما را تحلیل کرد؛ محدود کردن بازهٔ شارژ عمر باتری را تا ۲ سال بیشتر می‌کند.",
    "i.5.t": "APK خارج از فروشگاه شناسایی شد", "i.5.p": "Flash Ultra از منبع ناشناس نصب شده و رفتار مشکوک دارد؛ قرنطینه پیشنهاد می‌شود.",
    /* flow */
    "boost.scan": "در حال اسکن هوشمند حافظه…",
    "boost.close": "بستن هوشمند برنامه‌ها…",
    "boost.freed": (mb) => `+${faN(mb)} مگ آزاد شد`,
    "boost.done": "عالیه، متوجه شدم!",
    "boost.result.s": (min, sc) => `≈ ${faN(min)} دقیقه عمر باتری بیشتر • امتیاز سلامت: ${faN(sc)}`,
    /* misc */
    "toast.boosted": "⚡ دستگاه بهینه شد!",
    "toast.clean": "🧹 فضا آزاد شد!",
    "toast.qua": "🛡️ تهدید قرنطینه شد",
    "toast.nothing": "✨ همه‌چیز از قبل بهینه است",
    "toast.autoon": "خودکارسازی روشن شد", "toast.autooff": "خودکارسازی خاموش شد",
    "ram.sub": (u, t) => `${u} از ${t} گیگ`, "store.sub": (u, t) => `${faN(u)} از ${faN(t)} گیگ`,
    "batt.sub": (l) => `${faN(l)}٪`, "temp.sub": (t) => `${faN(t)}°C عادی`,
    "storage.freed": (s) => `${s} آزاد شد`,
    "notes.title": "🚧 یادداشت‌های پروتوتایپ",
    "notes.1": "داده‌های سنسور (رم، باتری، دما) شبیه‌سازی می‌شوند؛ سطح باتری واقعی مرورگر در صورت پشتیبانی خوانده می‌شود.",
    "notes.2": "منطق «پیشنهاد بستن» نمونهٔ اولیهٔ تصمیم‌گیری ML است؛ در نسخهٔ نهایی مدل واقعی جایگزین می‌شود.",
    "notes.3": "مرحلهٔ بعد: طراحی لوگو، کیت رابط کاربری و اتصال به API واقعی.",
    "notes.stage": "مرحلهٔ ۱ از ۴ — پروتوتایپ",
  },
  en: {
    "app.name": "Behine", "app.badge": "PROTOTYPE",
    "splash.tag": "AI Phone Optimizer",
    "tab.dash": "Home", "tab.clean": "Cleaner", "tab.apps": "Apps", "tab.batt": "Battery", "tab.sec": "Guard",
    "dash.score": "Health Score", "dash.boost": "Smart Boost", "dash.findings": "AI Findings",
    "stat.ram": "RAM", "stat.battery": "Battery", "stat.storage": "Storage", "stat.temp": "Device Temp",
    "verdict.3.t": "Critical", "verdict.3.s": "RAM pressure is high — run Smart Boost",
    "verdict.2.t": "Needs optimization", "verdict.2.s": "Several heavy apps are running in background",
    "verdict.1.t": "Good", "verdict.1.s": "A quick boost would sharpen performance",
    "verdict.0.t": "Excellent!", "verdict.0.s": "Your device is at its best ✨",
    "u.gb": "GB", "u.mb": "MB",
    "qa.clean": "Cleaner", "qa.scan": "Security", "qa.log": "Battery Log",
    "qa.clean.sub": "recoverable", "qa.clean.done": "All clean ✨",
    "qa.sec.subok": "Protected", "qa.sec.subthreat": "1 active threat!",
    "qa.log.sub": (n) => `today • ${n} events`,
    "m.sec": "<b>1 suspicious security item</b> found — run a scan",
    "m.junk": (s) => `<b>${s}</b> of junk files ready to clean`,
    "m.ramwarn": (n) => `<b>${n} heavy apps</b> are running in background`,
    "m.battok": "Battery health is 91% — wear trend is normal",
    "m.boost": (gb) => `Smart Boost can free <b>${gb}</b> of RAM`,
    "clean.title": "Smart Cleaner",
    "clean.last": (d) => d ? `Last clean: ${d} days ago` : "Last clean: just now ✨",
    "clean.junkfound": "Junk files found",
    "clean.scanned": (n) => `${n} paths scanned • complete`,
    "clean.badge.safe": "Safe", "clean.badge.review": "Review", "clean.cleaned": "Cleaned",
    "clean.selbar": (n, s) => `${n} safe items selected • ${s}`,
    "clean.cta": "Clean",
    "clean.hint": "💡 “Safe” items are removed risk-free; confirm “Review” items yourself. The AI model detects and protects critical files.",
    "clean.scan": "Smart-scanning storage…",
    "clean.wiping": "Safe cleaning in progress…",
    "clean.done.big": (s) => `${s} cleaned`,
    "clean.done.sub": "Storage space freed • no personal files were touched",
    "clean.empty": "Everything is clean ✨",
    "apps.title": "App Manager",
    "apps.running": (n) => `${n} apps running`,
    "apps.ramuse": "RAM usage", "apps.sys": "System", "apps.apps": "Apps", "apps.cache": "Cache", "apps.free": "Free",
    "apps.smartclose": "Smart Close",
    "apps.ob_none": "Everything is optimized ✨",
    "apps.ob_some": (n, mb) => `${n} heavy apps found • free ${mb} MB`,
    "apps.hint": "💡 Close suggestions are generated by the ML model from your usage patterns.",
    "badge.keep": "Keep", "badge.hibern": "Hibernate", "badge.close": "Force Close",
    "badge.closed": "Closed", "badge.lock": "Protected",
    "app.drain": (d) => `${d}%/h`, "app.idle": (m) => `${m} min idle`, "app.mb": (m) => `${m} MB`,
    "batt.title": "Battery Health",
    "batt.charging": "Charging ⚡", "batt.discharging": (h, m) => `${h}h ${m}m until empty (ML)`,
    "batt.maxcap": "Maximum Capacity",
    "batt.peak": "Normal peak performance supported",
    "batt.cycles": "Charge cycles", "batt.design": "Design capacity", "batt.real": "Current real capacity",
    "batt.forecast": "ML forecast", "batt.forecast.v": (mo) => `80% capacity in ≈ ${mo} months`,
    "batt.level24": "Last 24 hours", "batt.trend": "Health + forecast",
    "batt.log": "Battery Log", "batt.log.today": "Today",
    "batt.log.now": (l) => `${l}% discharging`,
    "batt.cap.level": "Charge level swings over the past 24h",
    "batt.cap.health": "Capacity dip over 6 months + ML forecast (dashed)",
    "batt.tip": "Based on your sleep pattern, Optimized Charging is on: charges to 80% overnight, tops up by morning (less wear).",
    "sec.title": "Security",
    "sec.db": (v) => `Threat DB v${v} • up to date`,
    "sec.protected": "Protected", "sec.threatt": "1 active threat",
    "sec.lastscan": (t) => `Last scan: ${t}`,
    "sec.quick": "Quick Scan", "sec.full": "Full Scan",
    "sec.scan.quick": "Quick scan running…", "sec.scan.full": "Deep AI scan…",
    "sec.files": (n) => `${n} files`,
    "sec.found1": "1 threat found", "sec.safe2": "Device is secure ✓",
    "sec.safesub": (n) => `${n} files checked • no threats`,
    "sec.threat.t": "1 suspicious app", "sec.threat.trojan": "Flash Ultra.apk — FlashGen trojan",
    "sec.qua": "Quarantine", "sec.qua.close": "Quarantine & finish",
    "sec.rt": "Real-time protection", "sec.web": "Web shield", "sec.weekly": "Weekly auto-scan",
    "sec.audit": "AI permission audit",
    "sec.badge.risk": "Suspicious", "sec.badge.ok": "Standard",
    "sec.stats": (s, f) => `Scans today: ${s} • files checked: ${f}`,
    "ai.title": "AI Center", "ai.sub": "On-device learning",
    "ai.model": "Optimization model v0.4", "ai.ondevice": "ON-DEVICE",
    "ai.meta": (d, acc) => `${d} days of data • ${acc}% accuracy • 3,412 sessions`,
    "ai.learning": "Usage-pattern learning progress",
    "ai.learnsub": "Full calibration needs 30 days of data — the model gets sharper every day.",
    "ai.insights": "Insights & predictions", "ai.automation": "Automation",
    "ai.auto": "Auto-boost when RAM > 85%",
    "ai.night": "Nightly optimization (2:00 AM)",
    "ai.charge": "Smart optimized charging",
    "conf": (c) => `${c}% conf.`,
    "i.1.t": "RAM pressure peaks around 3:00 PM", "i.1.p": "Your weekday pattern shows memory spikes in the afternoon; auto-boost is recommended.",
    "i.2.t": "12 duplicate photos found", "i.2.p": "Merging copies frees 1.1 GB; originals are preserved.",
    "i.3.t": "Battery empty forecast: 9:40 PM", "i.3.p": "At the current drain rate, charge hits 20% around 21:40; closing games adds ~45 minutes.",
    "i.4.t": "20–80% charging halves wear", "i.4.p": "The model analyzed your charge cycles; capping the range can extend battery lifespan by up to 2 years.",
    "i.5.t": "Out-of-store APK detected", "i.5.p": "Flash Ultra was installed from an unknown source and behaves suspiciously; quarantine is advised.",
    "boost.scan": "Smart-scanning memory…",
    "boost.close": "Force-closing selected apps…",
    "boost.freed": (mb) => `+${mb} MB freed`,
    "boost.done": "Got it!",
    "boost.result.s": (min, sc) => `≈ ${min} min extra battery • health score: ${sc}`,
    "toast.boosted": "⚡ Device optimized!",
    "toast.clean": "🧹 Space freed!",
    "toast.qua": "🛡️ Threat quarantined",
    "toast.nothing": "✨ Already fully optimized",
    "toast.autoon": "Automation enabled", "toast.autooff": "Automation disabled",
    "ram.sub": (u, t) => `${u} of ${t} GB`, "store.sub": (u, t) => `${u} of ${t} GB`,
    "batt.sub": (l) => `${l}%`, "temp.sub": (t) => `${t}°C normal`,
    "storage.freed": (s) => `${s} freed`,
    "notes.title": "🚧 Prototype notes",
    "notes.1": "Sensor data (RAM, battery, temp) is simulated; the browser's real battery level is used when available.",
    "notes.2": "The close-suggestion logic is an early mock of ML decision-making; a real model ships later.",
    "notes.3": "Next stage: logo design, UI kit, and real API integration.",
    "notes.stage": "Stage 1 of 4 — Prototype",
  },
};

let lang = localStorage.getItem("behine-lang") || "fa";
const t = (k, ...a) => { const v = I18N[lang][k]; return typeof v === "function" ? v(...a) : v ?? k; };
const faN = (n) => Number(n).toLocaleString("fa-IR");
const N = (n, d = 0) => Number(n.toFixed(d)).toLocaleString(lang === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const enN = (n, d = 0) => Number(n.toFixed(d)).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtMb = (mb) => mb >= 1024 ? N(mb / 1024, 1) + " " + t("u.gb") : N(mb) + " " + t("u.mb");

/* ─────────────────────── state ─────────────────────── */
const state = {
  ramTotal: 8, ramSystem: 2.2, ramCache: 0.6,
  battery: { level: 62, health: 91, cycles: 412, design: 4500, charging: false },
  temp: 33.4,
  storage: { used: 78, total: 128 },
  ai: { days: 12, accuracy: 94.2 },
  cleaner: { lastDays: 4, scanned: 614 },
  security: { threat: true, dbv: 2841, scansToday: 0, filesToday: 0, lastScan: new Date(new Date().setHours(6, 0, 0, 0)) },
  boosted: false,
};

let apps = [
  { id: "instagram", en: "Instagram", fa: "اینستاگرام", ic: "📸", ram: 412, drain: 3.1, idle: 38,  freq: 0.80 },
  { id: "telegram",  en: "Telegram",  fa: "تلگرام",    ic: "✈️", ram: 268, drain: 1.2, idle: 5,   freq: 0.95, cat: "messenger" },
  { id: "whatsapp",  en: "WhatsApp",  fa: "واتس‌اپ",   ic: "💬", ram: 196, drain: 0.9, idle: 8,   freq: 0.90, cat: "messenger" },
  { id: "chrome",    en: "Chrome",    fa: "کروم",      ic: "🌐", ram: 540, drain: 2.4, idle: 12,  freq: 0.70 },
  { id: "youtube",   en: "YouTube",   fa: "یوتیوب",    ic: "▶️", ram: 384, drain: 2.8, idle: 64,  freq: 0.60 },
  { id: "spotify",   en: "Spotify",   fa: "اسپاتیفای", ic: "🎵", ram: 224, drain: 1.1, idle: 3,   freq: 0.85, cat: "media" },
  { id: "tiktok",    en: "TikTok",    fa: "تیک‌تاک",   ic: "🎬", ram: 468, drain: 3.6, idle: 140, freq: 0.40 },
  { id: "saga",      en: "Candy Saga",fa: "کندی ساگا", ic: "🎮", ram: 655, drain: 4.2, idle: 210, freq: 0.20, cat: "game" },
  { id: "maps",      en: "Maps",      fa: "نقشه",      ic: "🗺️", ram: 302, drain: 1.8, idle: 95,  freq: 0.50 },
  { id: "gmail",     en: "Gmail",     fa: "جیمیل",     ic: "✉️", ram: 158, drain: 0.6, idle: 22,  freq: 0.75 },
  { id: "uber",      en: "Snapp",     fa: "اسنپ",      ic: "🚗", ram: 184, drain: 0.8, idle: 180, freq: 0.15 },
  { id: "gallery",   en: "Gallery",   fa: "گالری",     ic: "🖼️", ram: 132, drain: 0.3, idle: 45,  freq: 0.65 },
  { id: "shield",    en: "Shield AV", fa: "آنتی‌ویروس",ic: "🛡️", ram: 210, drain: 0.5, idle: 1,   freq: 1.00, cat: "security", pinned: true },
  { id: "sysui",     en: "System UI", fa: "رابط کاربری سیستم", ic: "⚙️", ram: 340, drain: 0.4, idle: 0, freq: 1.00, cat: "system", prot: true },
];

let junk = [
  { id: "cache",  ic: "🗂️", fa: "کش برنامه‌ها",       en: "App cache",        mb: 1180, level: "safe",   nfa: "بدون ریسک • خودکار بازسازی می‌شود", nen: "Risk-free • rebuilds automatically" },
  { id: "temp",   ic: "🧾", fa: "فایل‌های موقت",      en: "Temp files",       mb: 640,  level: "safe",   nfa: "حافظهٔ نهانی سیستم",               nen: "System scratch data" },
  { id: "apk",    ic: "📦", fa: "APKهای قدیمی",       en: "Old APKs",         mb: 512,  level: "safe",   nfa: "۶ فایل نصب قدیمی",                nen: "6 old installers" },
  { id: "resid",  ic: "🗑️", fa: "بقایای حذف‌شده",    en: "Residual files",   mb: 384,  level: "safe",   nfa: "از برنامه‌های حذف‌شده",           nen: "From uninstalled apps" },
  { id: "dupes",  ic: "🖼️", fa: "عکس‌های تکراری",    en: "Duplicate photos", mb: 1120, level: "review", nfa: "۱۲ نسخهٔ تکراری از ۳۴۰ عکس",       nen: "12 dupes across 340 photos" },
  { id: "large",  ic: "🎞️", fa: "فایل‌های حجیم قدیمی", en: "Old large files", mb: 964,  level: "review", nfa: "آخرین دسترسی: ۸ ماه پیش",          nen: "Last opened 8 months ago" },
  { id: "empty",  ic: "📁", fa: "پوشه‌های خالی",      en: "Empty folders",    mb: 3,    level: "safe",   nfa: "۱۲۴ پوشه",                        nen: "124 folders" },
];

const battLog = [
  { t: "08:05", ic: "🔌", tone: "ok",   fa: "شارژ کامل شد — ۱۰۰٪",                 en: "Fully charged — 100%" },
  { t: "08:32", ic: "🪫", tone: "",     fa: "قطع شارژر",                            en: "Unplugged" },
  { t: "10:12", ic: "📉", tone: "warn", fa: "مصرف بالا: کندی ساگا تا ۴٫۲٪/ساعت",     en: "Heavy drain: Candy Saga up to 4.2%/h" },
  { t: "14:05", ic: "🧠", tone: "ai",   fa: "صرفه‌جویی هوشمند پیشنهاد و فعال شد",   en: "AI power-saving suggested & enabled" },
  { t: "16:20", ic: "🌡️", tone: "warn", fa: "هشدار دما: ۳۸ درجه",                   en: "Temp warning: 38°C" },
  { t: "19:10", ic: "🔋", tone: "warn", fa: "رسیدن به ۲۰٪ — حالت صرفه‌جویی فعال شد", en: "Hit 20% — saver mode enabled" },
];

const audit = [
  { ic: "🔦", fa: "Flash Ultra.apk", en: "Flash Ultra.apk", nfa: "مکان + پیامک + دوربین (غیرضروری)", nen: "Location + SMS + camera (unnecessary)", risk: true },
  { ic: "🎮", fa: "کندی ساگا",       en: "Candy Saga",      nfa: "دسترسی مخاطبین توجیه‌نشده",        nen: "Unjustified contacts access",           risk: false },
  { ic: "🛡️", fa: "Shield AV",       en: "Shield AV",       nfa: "دسترسی‌ها استاندارد",              nen: "Standard permissions",                  risk: false },
];

/* ─────────────────────── mock ML engine ─────────────────────── */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function aiScore(app) {
  const mem  = clamp(app.ram / 800, 0, 1);
  const drn  = clamp(app.drain / 5, 0, 1);
  const idle = clamp(app.idle / 180, 0, 1);
  const rare = 1 - app.freq;
  const catBoost = (app.cat === "game" || app.ram > 450) ? 0.08 : 0;
  return clamp(0.36 * mem + 0.24 * drn + 0.22 * idle + 0.18 * rare + catBoost, 0, 1);
}
function aiAction(app) {
  if (app.prot || app.pinned) return "keep";
  if (app.cat === "messenger" && app.freq > 0.8) return "keep";
  if (app.cat === "media" && app.idle < 10) return "keep";
  const s = aiScore(app);
  if (s > 0.60) return "close";
  if (s > 0.44) return "hibern";
  return "keep";
}

const appsRam   = () => apps.filter(a => !a.closed).reduce((s, a) => s + a.ram, 0);
const ramUsedGB = () => state.ramSystem + state.ramCache + appsRam() / 1024;
const closable  = () => apps.filter(a => !a.closed && a.selected && aiAction(a) === "close");
const junkTotal = () => junk.filter(j => !j.cleaned).reduce((s, j) => s + j.mb, 0);
const junkSel   = () => junk.filter(j => !j.cleaned && j.selected);

function healthScore() {
  const usedPct = ramUsedGB() / state.ramTotal;
  let s = 100;
  s -= clamp((usedPct - 0.45) * 55, 0, 34);
  s -= (100 - state.battery.health) * 0.4;
  s -= clamp((state.temp - 32) * 1.6, 0, 10);
  s -= clamp(apps.filter(a => !a.closed && aiAction(a) === "close").length * 2.2, 0, 12);
  s -= clamp(junkTotal() / 1024 * 1.1, 0, 6);
  if (state.security.threat) s -= 3;
  if (state.boosted) s += 4;
  return Math.round(clamp(s, 40, 99));
}

/* ─────────────────────── DOM helpers ─────────────────────── */
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
let toastTimer;
function toast(msg) {
  const tEl = $("toast"); tEl.innerHTML = msg; tEl.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => tEl.classList.remove("show"), 2600);
}

/* ─────────────────────── renders ─────────────────────── */
function renderStatic() {
  document.querySelectorAll("[data-i18n]").forEach(n => { n.innerHTML = t(n.dataset.i18n); });
  document.querySelectorAll("[data-lang-chip]").forEach(n => n.classList.toggle("on", n.dataset.langChip === lang));
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
}

function renderDashboard() {
  const sc = healthScore();
  $("scoreNum").textContent = enN(sc);
  requestAnimationFrame(() => { $("scoreRing").style.strokeDashoffset = 377 * (1 - sc / 100); });
  const level = sc >= 88 ? 0 : sc >= 74 ? 1 : sc >= 60 ? 2 : 3;
  $("verdictTitle").textContent = t(`verdict.${level}.t`);
  $("verdictSub").textContent = t(`verdict.${level}.s`);

  const pct = Math.round(ramUsedGB() / state.ramTotal * 100);
  $("ramDonut").style.setProperty("--p", pct);
  $("ramPct").textContent = N(pct) + "%";
  $("ramSub").textContent = t("ram.sub", N(ramUsedGB(), 1), N(state.ramTotal));

  $("battFill").style.width = state.battery.level + "%";
  $("sbBattFill").style.width = state.battery.level + "%";
  $("sbBattFill").style.background = state.battery.level <= 20 ? "var(--bad)" : "var(--ok)";
  $("battSub").textContent = t("batt.sub", N(state.battery.level)) + (state.battery.charging ? " ⚡" : "");

  const spct = Math.round(state.storage.used / state.storage.total * 100);
  $("storeDonut").style.setProperty("--p", spct);
  $("storePct").textContent = N(spct) + "%";
  $("storeSub").textContent = t("store.sub", state.storage.used, state.storage.total);

  $("tempSub").textContent = t("temp.sub", N(state.temp, 0));

  // quick action chips
  const jt = junkTotal();
  $("qaCleanSub").textContent = jt ? fmtMb(jt) + " " + t("qa.clean.sub") : t("qa.clean.done");
  $("qaSecSub").textContent = state.security.threat ? t("qa.sec.subthreat") : t("qa.sec.subok");
  $("qaLogSub").textContent = t("qa.log.sub", battLog.length + 1);

  // mini feed
  const feed = $("miniFeed"); feed.innerHTML = "";
  const heavy = apps.filter(a => !a.closed && aiAction(a) === "close").length;
  const items = [];
  if (state.security.threat) items.push(["🛡️", t("m.sec")]);
  if (heavy > 0) items.push(["🔥", t("m.ramwarn", heavy)]);
  if (jt > 0) items.push(["🧹", t("m.junk", fmtMb(jt))]);
  if (!items.length) items.push(["✨", t("apps.ob_none")]);
  items.push(["🔋", t("m.battok")]);
  items.slice(0, 3).forEach(([ic, msg], i) => {
    const it = el("div", "mini-item", `<span class="mi-ic">${ic}</span><p>${msg}</p>`);
    it.style.animationDelay = (i * 0.12) + "s";
    feed.appendChild(it);
  });

  // tab badges
  const b = $("tabBadge"); b.hidden = heavy === 0; b.textContent = N(heavy);
  const bs = $("tabBadgeSec"); bs.hidden = !state.security.threat; bs.textContent = N(1);
}

function renderCleaner() {
  $("cleanLast").textContent = t("clean.last", state.cleaner.lastDays);
  $("cleanScanMeta").textContent = t("clean.scanned", state.cleaner.scanned) + " · 🤖 AI";
  const jt = junkTotal();
  if (jt >= 1024) { $("junkBig").textContent = enN(jt / 1024, 1); $("junkUnit").textContent = t("u.gb"); }
  else { $("junkBig").textContent = enN(jt); $("junkUnit").textContent = t("u.mb"); }

  const sel = junkSel();
  const selMb = sel.reduce((s, j) => s + j.mb, 0);
  $("cleanBarText").textContent = sel.length ? t("clean.selbar", sel.length, fmtMb(selMb)) : t("clean.empty");
  $("cleanBtn").style.display = sel.length ? "" : "none";

  const list = $("junkList"); list.innerHTML = "";
  [...junk].sort((a, b) => (a.cleaned ? 1 : 0) - (b.cleaned ? 1 : 0) || b.mb - a.mb).forEach(j => {
    const row = el("div", "app-row" + (j.cleaned ? " cleaned" : ""));
    row.dataset.id = j.id;
    const badge = j.cleaned
      ? `<span class="ai-badge ab-clean">✓ ${t("clean.cleaned")}</span>`
      : j.level === "safe"
        ? `<span class="ai-badge ab-keep">${t("clean.badge.safe")}</span>`
        : `<span class="ai-badge ab-hib">${t("clean.badge.review")}</span>`;
    const sw = j.cleaned
      ? `<label class="switch"><input type="checkbox" disabled /><i></i></label>`
      : `<label class="switch"><input type="checkbox" data-jw="${j.id}" ${j.selected ? "checked" : ""} /><i></i></label>`;
    row.innerHTML = `
      <span class="app-ic">${j.ic}</span>
      <div class="app-meta">
        <b>${lang === "fa" ? j.fa : j.en}</b>
        <small>${lang === "fa" ? j.nfa : j.nen}</small>
      </div>
      <span class="app-size">${fmtMb(j.mb)}</span>
      ${badge}${sw}`;
    list.appendChild(row);
  });

  list.querySelectorAll("[data-jw]").forEach(input => {
    input.addEventListener("change", () => {
      const j = junk.find(x => x.id === input.dataset.jw);
      j.selected = input.checked;
      renderCleaner(); renderDashboard();
    });
  });
}

function renderApps() {
  const open = apps.filter(a => !a.closed);
  $("appsRunning").textContent = t("apps.running", open.length);

  const appGB = appsRam() / 1024;
  $("ramBarText").textContent = `${N(ramUsedGB(), 1)} / ${N(state.ramTotal)} GB`;
  $("ramSegSys").style.width = (state.ramSystem / state.ramTotal * 100) + "%";
  $("ramSegApp").style.width = (appGB / state.ramTotal * 100) + "%";
  $("ramSegCache").style.width = (state.ramCache / state.ramTotal * 100) + "%";

  const sel = closable();
  $("obText").innerHTML = sel.length ? t("apps.ob_some", sel.length, sel.reduce((s, a) => s + a.ram, 0)) : t("apps.ob_none");
  $("optimizeBtn").style.display = sel.length ? "" : "none";

  const list = $("appList"); list.innerHTML = "";
  [...apps].sort((a, b) => (a.closed ? 1 : 0) - (b.closed ? 1 : 0) || b.ram - a.ram).forEach(a => {
    const act = aiAction(a);
    const row = el("div", "app-row" + (a.closed ? " closed" : ""));
    row.dataset.id = a.id;
    const badge = a.closed ? `<span class="ai-badge ab-closed">${t("badge.closed")}</span>`
      : (a.prot || a.pinned) ? `<span class="ai-badge ab-keep">🔒 ${t("badge.lock")}</span>`
      : `<span class="ai-badge ${act === "close" ? "ab-close" : act === "hibern" ? "ab-hib" : "ab-keep"}">${t("badge." + act)}</span>`;
    const sw = (a.prot || a.pinned || a.closed)
      ? `<label class="switch"><input type="checkbox" disabled ${a.closed ? "" : "checked"} /><i></i></label>`
      : `<label class="switch"><input type="checkbox" data-sw="${a.id}" ${a.selected ? "checked" : ""} /><i></i></label>`;
    row.innerHTML = `
      <span class="app-ic">${a.ic}</span>
      <div class="app-meta">
        <b>${lang === "fa" ? a.fa : a.en}</b>
        <small>${t("app.mb", N(a.ram))} · ${t("app.drain", N(a.drain, 1))} · ${t("app.idle", N(a.idle))}</small>
      </div>
      ${badge}${sw}`;
    list.appendChild(row);
  });

  list.querySelectorAll("[data-sw]").forEach(input => {
    input.addEventListener("change", () => {
      const a = apps.find(x => x.id === input.dataset.sw);
      a.selected = input.checked;
      renderApps(); renderDashboard();
    });
  });
}

function renderBattery() {
  const b = state.battery;
  $("battState").textContent = b.charging
    ? t("batt.charging")
    : (() => { const total = Math.round(b.level / 4.1 * 60); return t("batt.discharging", Math.floor(total / 60), total % 60); })();
  $("battHealthBig").textContent = enN(b.health) + "%";
  $("battPeak").innerHTML = "<b>✓</b> " + t("batt.peak");
  $("cyclesVal").textContent = N(b.cycles);
  $("designVal").textContent = `${N(b.design)} mAh`;
  $("realVal").textContent = `${N(Math.round(b.design * b.health / 100))} mAh`;
  $("forecastVal").textContent = t("batt.forecast.v", 14);
  $("levelNow").textContent = enN(b.level) + "%";
  $("healthNow").textContent = enN(b.health) + "%";
  $("logToday").textContent = t("batt.log.today");
  drawLevelChart();
  drawHealthChart();
  renderBattLog();
}

function renderBattLog() {
  const card = $("battLog"); card.innerHTML = "";
  const now = new Date();
  const nowStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const rows = [...battLog, {
    t: nowStr, ic: "🔋", tone: "",
    fa: t("batt.log.now", state.battery.level), en: t("batt.log.now", state.battery.level),
  }];
  rows.forEach((r, i) => {
    const it = el("div", `log-item tone-${r.tone || "mute"}`,
      `<span class="log-time">${r.t}</span><span class="log-ic">${r.ic}</span><span class="log-tx">${lang === "fa" ? r.fa : r.en}</span>`);
    it.style.animationDelay = (i * 0.05) + "s";
    card.appendChild(it);
  });
}

function renderSecurity() {
  const s = state.security;
  $("secDb").textContent = t("sec.db", s.dbv);
  const st = $("secStatus");
  st.textContent = s.threat ? t("sec.threatt") : t("sec.protected");
  st.className = s.threat ? "threat" : "safe";
  $("secShieldIco").textContent = s.threat ? "⚠️" : "🛡️";
  $("secLast").textContent = t("sec.lastscan",
    s.lastScan.toLocaleTimeString(lang === "fa" ? "fa-IR" : "en-GB", { hour: "2-digit", minute: "2-digit" }));
  $("threatCard").hidden = !s.threat;
  $("threatName").textContent = t("sec.threat.trojan");
  $("secStats").textContent = t("sec.stats", s.scansToday, N(s.filesToday));

  const list = $("auditList"); list.innerHTML = "";
  audit.forEach((a, i) => {
    const risk = a.risk && s.threat;
    const row = el("div", "app-row", `
      <span class="app-ic">${a.ic}</span>
      <div class="app-meta">
        <b>${lang === "fa" ? a.fa : a.en}</b>
        <small>${lang === "fa" ? a.nfa : a.nen}</small>
      </div>
      <span class="ai-badge ${risk ? "ab-close" : "ab-keep"}">${t(risk ? "sec.badge.risk" : "sec.badge.ok")}</span>
      <span class="ai-badge ab-ai">🤖</span>`);
    row.style.animationDelay = (i * 0.08) + "s";
    list.appendChild(row);
  });
}

function renderAI() {
  $("modelMeta").textContent = t("ai.meta", state.ai.days, state.ai.accuracy);
  const pct = Math.round(state.ai.days / 30 * 100);
  $("learnPct").textContent = N(pct) + "%";
  requestAnimationFrame(() => { $("learnFill").style.width = pct + "%"; });
  $("learnSub").textContent = t("ai.learnsub");

  const list = $("insightList"); list.innerHTML = "";
  [["📈", t("i.1.t"), t("i.1.p"), 92],
   ["🖼️", t("i.2.t"), t("i.2.p"), 97],
   ["🔋", t("i.3.t"), t("i.3.p"), 81],
   ["⚡", t("i.4.t"), t("i.4.p"), 95],
   ["🛡️", t("i.5.t"), t("i.5.p"), 91]].forEach(([ic, ti, p, c], i) => {
    const ins = el("div", "insight",
      `<span class="insight-ic">${ic}</span><div><b>${ti}</b><p>${p}</p></div><span class="conf">${t("conf", c)}</span>`);
    ins.style.animationDelay = (i * 0.08) + "s";
    list.appendChild(ins);
  });
}

function renderAll() {
  renderStatic(); renderDashboard(); renderCleaner(); renderApps(); renderBattery(); renderSecurity(); renderAI();
}

/* ─────────────────────── minimal charts ─────────────────────── */
function setupCanvas(id) {
  const c = $(id), box = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = box.width * dpr; c.height = (c.getAttribute("height") | 0) * dpr;
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: box.width, h: c.getAttribute("height") | 0 };
}

function drawLevelChart() {
  const { ctx, w, h } = setupCanvas("chartLevel");
  const pts = [];
  const now = new Date().getHours() + new Date().getMinutes() / 60;
  for (let i = 24; i >= 0; i--) {
    const hr = (now - i + 24) % 24;
    let v;
    if (hr < 6.5) v = 96 - (6.5 - hr) * 0.5;
    else if (hr < 8) v = 93 + (hr - 6.5) * 26;
    else v = 100 - (hr - 8) * 4.4;
    pts.push({ x: 3 + (24 - i) / 24 * (w - 6), y: clamp(v, 4, 100) });
  }
  pts[pts.length - 1].y = state.battery.level;
  const Y = (v) => 5 + (1 - v / 100) * (h - 12);

  // hairline mid guide
  ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(3, Y(50)); ctx.lineTo(w - 3, Y(50));
  ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(61,220,132,.22)"); grad.addColorStop(1, "rgba(61,220,132,0)");
  ctx.beginPath(); ctx.moveTo(pts[0].x, Y(pts[0].y));
  pts.forEach(p => ctx.lineTo(p.x, Y(p.y)));
  ctx.strokeStyle = "#3ddc84"; ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.stroke();
  ctx.lineTo(pts[pts.length - 1].x, h - 2); ctx.lineTo(pts[0].x, h - 2); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  const last = pts[pts.length - 1];
  ctx.shadowColor = "rgba(61,220,132,.9)"; ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.arc(last.x, Y(last.y), 2.8, 0, 7); ctx.fillStyle = "#3ddc84"; ctx.fill();
  ctx.shadowBlur = 0;
}

function drawHealthChart() {
  const { ctx, w, h } = setupCanvas("chartHealth");
  const hist = [95.8, 95.1, 94.2, 93.0, 92.1, state.battery.health];
  const proj = [state.battery.health - 0.9, state.battery.health - 1.9];
  const vmin = 78, vmax = 100;
  const X = (i) => 4 + i * ((w - 8) / 7);
  const Y = (v) => 5 + (1 - (v - vmin) / (vmax - vmin)) * (h - 12);

  ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(4, Y(80)); ctx.lineTo(w - 4, Y(80));
  ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);

  ctx.beginPath();
  hist.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(0), Y(v)));
  ctx.strokeStyle = "#3ddc84"; ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.stroke();

  ctx.setLineDash([3, 4]); ctx.beginPath();
  ctx.moveTo(X(5), Y(hist[5]));
  proj.forEach((v, j) => ctx.lineTo(X(6 + j), Y(v)));
  ctx.strokeStyle = "rgba(61,220,132,.55)"; ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]);

  ctx.beginPath(); ctx.arc(X(0), Y(hist[0]), 2, 0, 7);
  ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fill();
  ctx.shadowColor = "rgba(61,220,132,.9)"; ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.arc(X(5), Y(hist[5]), 2.8, 0, 7); ctx.fillStyle = "#3ddc84"; ctx.fill();
  ctx.shadowBlur = 0;
}

/* ─────────────────────── generic flow (overlay) ─────────────────────── */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ov = () => $("boostOverlay");
function flowStart(radarCls, title) {
  const o = ov();
  o.classList.add("show");
  $("boRadar").className = "bo-radar " + radarCls;
  $("boTitle").textContent = title;
  $("boLog").innerHTML = "";
  $("boFill").style.width = "0%";
  $("boResult").style.display = "none";
}
const flowPct = (p) => { $("boFill").style.width = p + "%"; };
function flowLine(ic, left, right, bad = false) {
  const line = el("div", "log-line " + (bad ? "bad" : "ok"), `<span>${ic} ${left}</span><b>${right}</b>`);
  $("boLog").appendChild(line);
  return line;
}
function flowFinish(emoji, big, bigCls, sub, btnTxt, onBtn) {
  $("boTitle").textContent = emoji;
  flowPct(100);
  const res = $("boResult");
  res.querySelector(".bo-big")?.remove(); res.querySelector("p")?.remove();
  res.prepend(el("p", null, sub));
  const bigEl = el("div", "bo-big " + bigCls, big);
  res.prepend(bigEl);
  res.style.display = "flex";
  const btn = $("boClose");
  btn.textContent = btnTxt;
  btn.onclick = () => { ov().classList.remove("show"); onBtn && onBtn(); };
}

/* ── Smart Boost flow ── */
let boosting = false;
async function runBoost() {
  if (boosting) return;
  const targets = closable();
  if (!targets.length) { toast(t("toast.nothing")); return; }
  boosting = true;

  flowStart("rd-boost", t("boost.scan"));
  await sleep(1200); flowPct(15);
  $("boTitle").textContent = t("boost.close");

  let freed = 0, drainSaved = 0, done = 0;
  for (const a of targets) {
    await sleep(500);
    a.closed = true; a.selected = false;
    freed += a.ram; drainSaved += a.drain; done++;
    flowPct(15 + done / targets.length * 72);
    flowLine(a.ic, lang === "fa" ? a.fa : a.en, t("boost.freed", N(a.ram)));
    const row = document.querySelector(`.app-row[data-id="${a.id}"]`);
    if (row) { row.classList.add("closing"); setTimeout(() => { row.classList.remove("closing"); renderApps(); }, 460); }
  }

  state.boosted = true; state.temp = Math.max(30.5, state.temp - 1.8);
  await sleep(550);
  const min = Math.round(drainSaved * 9);
  flowFinish("🎉", fmtMb(freed), "", t("boost.result.s", min, healthScore()), t("boost.done"),
    () => { boosting = false; renderAll(); toast(t("toast.boosted")); });
  renderDashboard();
}

/* ── Smart Clean flow ── */
let cleaning = false;
async function runClean() {
  if (cleaning) return;
  const targets = junkSel();
  if (!targets.length) { toast(t("toast.nothing")); return; }
  cleaning = true;

  flowStart("rd-clean", t("clean.scan"));
  await sleep(1100); flowPct(14);
  $("boTitle").textContent = t("clean.wiping");

  let freed = 0, done = 0;
  for (const j of targets) {
    await sleep(480);
    j.cleaned = true; j.selected = false;
    freed += j.mb; done++;
    flowPct(14 + done / targets.length * 74);
    flowLine(j.ic, lang === "fa" ? j.fa : j.en, "+" + fmtMb(j.mb));
    const row = document.querySelector(`#junkList .app-row[data-id="${j.id}"]`);
    if (row) { row.classList.add("closing"); setTimeout(() => { row.classList.remove("closing"); renderCleaner(); }, 440); }
  }

  state.cleaner.lastDays = 0;
  state.storage.used = Math.max(30, +(state.storage.used - freed / 1024).toFixed(1));
  await sleep(500);
  flowFinish("✨", t("clean.done.big", fmtMb(freed)), "safe", t("clean.done.sub"), t("boost.done"),
    () => { cleaning = false; renderAll(); toast(t("toast.clean")); });
}

/* ── Antivirus scan flow ── */
let scanning = false;
const scanPaths = ["/data/app/com.whatsapp", "/storage/dcim/camera", "/data/data/org.telegram.messenger", "/sdcard/download", "/data/app/com.instagram", "/system/priv-app", "/storage/android/obb", "/data/user/0/com.spotify", "/sdcard/pictures", "/data/app/flash.ultra"];
async function runScan(full) {
  if (scanning) return;
  scanning = true;
  flowStart("rd-scan", full ? t("sec.scan.full") : t("sec.scan.quick"));

  const steps = full ? 34 : 20;
  let scanned = 0;
  const line = flowLine("📄", scanPaths[0], "0");
  for (let i = 0; i < steps; i++) {
    await sleep(full ? 150 : 105);
    scanned += 137 + Math.round(Math.random() * 158);
    line.querySelector("span").textContent = "📄 " + scanPaths[i % scanPaths.length];
    line.querySelector("b").textContent = N(scanned);
    flowPct((i + 1) / steps * 86);
  }
  await sleep(420);

  const s = state.security;
  s.lastScan = new Date(); s.scansToday++; s.filesToday += scanned;

  if (s.threat) {
    flowLine("⚠️", t("sec.threat.trojan"), t("sec.found1"), true);
    await sleep(650);
    flowFinish("🚨", t("sec.found1"), "threat", t("i.5.p"), t("sec.qua.close"),
      () => { scanning = false; state.security.threat = false; renderAll(); toast(t("toast.qua")); });
  } else {
    flowFinish("🛡️", t("sec.safe2"), "safe", t("sec.safesub", N(s.filesToday)), t("boost.done"),
      () => { scanning = false; renderAll(); });
  }
  renderSecurity(); renderDashboard();
}

function quarantine() {
  state.security.threat = false;
  renderAll();
  toast(t("toast.qua"));
}

/* ─────────────────────── simulation tick ─────────────────────── */
function tick() {
  apps.forEach(a => {
    if (a.closed) return;
    a.ram = Math.max(80, Math.round(a.ram + (Math.random() - 0.5) * 8));
    a.idle = Math.max(0, Math.round(a.idle + (Math.random() - 0.45) * 3));
  });
  if (!state.battery.charging && Math.random() < 0.25) state.battery.level = Math.max(4, state.battery.level - 1);
  state.temp = clamp(state.temp + (Math.random() - 0.5) * 0.3, 29.5, 38);
  renderDashboard();
  const d = new Date();
  $("sbTime").textContent = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/* real battery when available */
if (navigator.getBattery) {
  navigator.getBattery().then(b => {
    const sync = () => { state.battery.level = Math.round(b.level * 100); state.battery.charging = b.charging; renderDashboard(); renderBattery(); };
    b.addEventListener("levelchange", sync); b.addEventListener("chargingchange", sync); sync();
  }).catch(() => {});
}

/* ─────────────────────── wiring ─────────────────────── */
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === btn));
    document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === "page-" + btn.dataset.tab));
    if (btn.dataset.tab === "battery") renderBattery();
  });
});
document.querySelectorAll("[data-goto]").forEach(c => {
  c.addEventListener("click", () => document.querySelector(`.tab[data-tab="${c.dataset.goto}"]`).click());
});
$("boostBtn").addEventListener("click", runBoost);
$("optimizeBtn").addEventListener("click", runBoost);
$("cleanBtn").addEventListener("click", runClean);
$("secQuick").addEventListener("click", () => runScan(false));
$("secFull").addEventListener("click", () => runScan(true));
$("quaBtnInline").addEventListener("click", quarantine);
["swAuto", "swNight", "swCharge", "swRt", "swWeb", "swWeekly"].forEach(id =>
  $(id).addEventListener("change", e => toast(t(e.target.checked ? "toast.autoon" : "toast.autooff"))));

$("langToggle").addEventListener("click", () => {
  lang = lang === "fa" ? "en" : "fa";
  localStorage.setItem("behine-lang", lang);
  renderAll();
});
window.addEventListener("resize", () => {
  if ($("page-battery").classList.contains("active")) renderBattery();
});

/* ─────────────────────── init ─────────────────────── */
apps.forEach(a => { a.selected = aiAction(a) === "close"; a.closed = false; });
junk.forEach(j => { j.selected = j.level === "safe"; j.cleaned = false; });
renderAll();
tick();
setInterval(tick, 3000);

/* splash intro (logo reveal) */
setTimeout(() => {
  const s = $("splash");
  if (s) { s.classList.add("hide"); setTimeout(() => s.remove(), 650); }
}, 1800);
