/* Tiny i18n layer: swaps text via data-i18n attributes and flips document direction. */

const DICT = {
  fa: {
    'meta.title': 'با من ببین — تماشای همزمان با دوستان',
    'meta.description': 'با من ببین: فیلم و ویدیو را کاملاً همگام با دوستانت تماشا کن، با چت زنده و واکنش‌های لحظه‌ای.',

    'nav.features': 'امکانات',
    'nav.how': 'چطور کار می‌کند',
    'nav.faq': 'سؤالات متداول',
    'nav.create': 'ساخت اتاق',
    'nav.menu': 'منو',

    'hero.badge': 'همگام‌سازی زیر ۱۰۰ میلی‌ثانیه',
    'hero.title.1': 'فیلم را ',
    'hero.title.hl': 'با هم',
    'hero.title.2': ' ببینید، حتی از دو سر دنیا',
    'hero.lead': 'یک اتاق بساز، لینکش را بفرست و ویدیو را دقیقاً همزمان تماشا کنید. پخش، توقف و جابه‌جایی برای همه هم‌زمان اتفاق می‌افتد — با چت زنده و واکنش‌های تصویری کنار پلیر.',
    'hero.cta.primary': 'ساخت اتاق رایگان',
    'hero.cta.secondary': 'دیدن امکانات',
    'hero.note': 'بدون ثبت‌نام · بدون نصب',
    'hero.stat1': 'میلی‌ثانیه اختلاف',
    'hero.stat2': 'نفر در هر اتاق',
    'hero.stat3': 'در دسترس',

    'mock.chat.1': 'این صحنه رو ببین!',
    'mock.chat.2': 'صبر کن، پاپ‌کورن بیارم 🍿',
    'mock.chat.3': 'همگام شد ✅',
    'mock.user1': 'سارا',
    'mock.user2': 'تو',
    'mock.user3': 'سیستم',

    'features.eyebrow': 'امکانات',
    'features.title': 'هر چیزی که برای یک شب فیلم مشترک لازم دارید',
    'features.sub': 'ساده، سریع و بدون دردسر. کافی است لینک را بفرستید.',
    'f1.title': 'همگام‌سازی دقیق',
    'f1.text': 'پخش، توقف و جابه‌جایی برای همه در یک لحظه اعمال می‌شود؛ حتی اگر وسط فیلم وارد شوید.',
    'f2.title': 'چت زنده',
    'f2.text': 'کنار پلیر گپ بزنید، بدون اینکه از فیلم عقب بمانید یا برنامه دیگری باز کنید.',
    'f3.title': 'واکنش‌های لحظه‌ای',
    'f3.text': 'با یک کلیک ایموجی بفرستید تا روی صفحه همه شناور شود.',
    'f4.title': 'یوتیوب، لینک مستقیم و تورنت',
    'f4.text': 'لینک یوتیوب، لینک مستقیم (mp4/m3u8)، مگنت/تورنت یا فایل خودت — همه پشتیبانی می‌شوند.',
    'f5.title': 'کنترل میزبان',
    'f5.text': 'میزبان کنترل پخش را دارد و می‌تواند آن را به هر عضوی واگذار کند.',
    'f6.title': 'بدون محدودیت جغرافیایی',
    'f6.text': 'اگر لینکی برایت باز نمی‌شود، پخش از طریق سرور را روشن کن — چه ایران باشی چه خارج.',

    'how.eyebrow': 'شروع کنید',
    'how.title': 'در سه قدم ساده',
    'how.sub': 'کمتر از یک دقیقه تا شروع تماشا.',
    's1.title': 'اتاق بساز',
    's1.text': 'روی «ساخت اتاق» بزن تا یک اتاق اختصاصی با شناسه یکتا ساخته شود.',
    's2.title': 'لینک را بفرست',
    's2.text': 'لینک اتاق را برای دوستانت بفرست؛ با یک کلیک وارد می‌شوند.',
    's3.title': 'با هم ببینید',
    's3.text': 'منبع ویدیو را انتخاب کن و پخش را بزن — بقیه خودکار همگام می‌شوند.',

    'cta.title': 'آماده‌ای شروع کنی؟',
    'cta.sub': 'یک اتاق بساز یا با شناسه اتاق وارد شو.',
    'cta.create': 'ساخت اتاق',
    'cta.join': 'ورود',
    'cta.placeholder': 'شناسه اتاق (مثلاً abcd-1234)',

    'faq.eyebrow': 'پرسش‌ها',
    'faq.title': 'سؤالات متداول',
    'faq.q1': 'آیا باید ثبت‌نام کنم؟',
    'faq.a1': 'نه. فقط یک نام مستعار وارد می‌کنی و وارد اتاق می‌شوی.',
    'faq.q2': 'فایل ویدیویی من آپلود می‌شود؟',
    'faq.a2': 'خیر. فایل محلی فقط در مرورگر خودت پخش می‌شود؛ فقط زمان پخش همگام می‌شود، پس بقیه هم باید همان فایل را داشته باشند.',
    'faq.q3': 'چند نفر می‌توانند در یک اتاق باشند؟',
    'faq.a3': 'به‌صورت پیش‌فرض تا ۵۰ نفر؛ این عدد در تنظیمات سرور قابل تغییر است.',
    'faq.q4': 'روی موبایل کار می‌کند؟',
    'faq.a4': 'بله، رابط کاربری کاملاً واکنش‌گرا است و روی موبایل و تبلت هم خوب کار می‌کند.',

    'footer.rights': 'ساخته‌شده برای شب‌های فیلم مشترک.',
    'footer.brand': 'BA MAN BEBIN 2026',
    'footer.privacy': 'حریم خصوصی',
    'footer.status': 'وضعیت سرویس',

    'modal.title': 'ورود به اتاق',
    'modal.sub': 'یک نام برای خودت انتخاب کن تا دوستانت بشناسندت.',
    'modal.name': 'نام نمایشی',
    'modal.placeholder': 'مثلاً علی',
    'modal.enter': 'ورود به اتاق',

    'room.back': 'خانه',
    'room.copy': 'کپی لینک دعوت',
    'room.copied': 'لینک دعوت کپی شد ✅',
    'room.leave': 'خروج',
    'room.host': 'میزبان',
    'room.viewer': 'بیننده',
    'room.live': 'زنده',
    'room.members': 'اعضای اتاق',
    'room.chat': 'گفتگو',
    'room.send': 'ارسال',
    'room.msgPlaceholder': 'پیامت را بنویس…',
    'room.sourcePlaceholder': 'لینک یوتیوب را اینجا بگذار…',
    'room.load': 'بارگذاری',
    'room.pickFile': 'فایل محلی',
    'room.sync': 'همگام‌سازی دوباره',
    'room.emptyTitle': 'هنوز ویدیویی انتخاب نشده',
    'room.emptyText': 'میزبان می‌تواند یک لینک یوتیوب بگذارد یا فایل محلی انتخاب کند.',
    'room.onlyHost': 'فقط میزبان می‌تواند پخش را کنترل کند.',
    'room.hostNow': 'حالا تو میزبانی 🎬',
    'room.joined': 'وارد اتاق شد',
    'room.left': 'اتاق را ترک کرد',
    'room.disconnected': 'ارتباط قطع شد؛ در حال اتصال دوباره…',
    'room.reconnected': 'دوباره وصل شدیم ✅',
    'room.invalidUrl': 'لینک یوتیوب معتبر نیست.',
    'room.fileNote': 'فایل محلی فقط برای تو پخش می‌شود؛ بقیه باید همان فایل را باز کنند.',
    'room.typing': 'در حال نوشتن…',

    'room.sourcePlaceholderAny': 'لینک یوتیوب، لینک مستقیم (mp4/m3u8) یا مگنت…',
    'room.test': 'تست پخش',
    'room.testing': 'در حال بررسی لینک…',
    'room.proxy': 'پخش از طریق سرور',
    'room.proxyHint': 'ویدیو از سرور ما عبور می‌کند؛ اگر لینک در کشور تو فیلتر یا مسدود است این را روشن کن.',
    'room.testFirst': 'اول لینک را تست کن تا مطمئن شویم پخش می‌شود.',
    'room.enterLink': 'یک لینک وارد کن.',

    'probe.okTitle': 'لینک سالم است، آماده پخش ✅',
    'probe.warnTitle': 'قابل پخش است، ولی چند نکته هست',
    'probe.failTitle': 'این لینک پخش نمی‌شود',
    'probe.ytTitle': 'لینک یوتیوب معتبر است ✅',
    'probe.torrentTitle': 'مگنت/تورنت شناسایی شد',
    'probe.kind': 'نوع منبع',
    'probe.reachable': 'لینک در دسترس است',
    'probe.contentType': 'نوع محتوا',
    'probe.size': 'حجم فایل',
    'probe.seekable': 'جابه‌جایی در فیلم پشتیبانی می‌شود',
    'probe.noSeek': 'جابه‌جایی (seek) ممکن است کار نکند',
    'probe.corsOpen': 'مستقیم از مرورگر قابل پخش است',
    'probe.corsClosed': 'سرور مقصد اجازه پخش مستقیم نمی‌دهد — «پخش از طریق سرور» روشن شد',
    'probe.hls': 'پخش زنده HLS — با hls.js پخش می‌شود',
    'probe.notVideo': 'محتوا شبیه ویدیو نیست؛ ممکن است صفحه دانلود باشد نه فایل',
    'probe.container': 'این فرمت (مثل mkv/avi) ممکن است در مرورگر پخش نشود',
    'probe.torrentNote': 'تورنت در مرورگر پخش می‌شود و به سیدر فعال نیاز دارد؛ شروعش کمی طول می‌کشد.',
    'probe.torrentP2P': 'فقط تورنت‌هایی که تراکر WebRTC دارند در مرورگر کار می‌کنند.',
    'probe.errTimeout': 'مهلت پاسخ تمام شد — سرور مقصد جواب نداد',
    'probe.errUnreachable': 'سرور مقصد در دسترس نیست',
    'probe.errDns': 'دامنه پیدا نشد',
    'probe.errBlocked': 'این آدرس مجاز نیست (آدرس داخلی/خصوصی)',
    'probe.errProtocol': 'فقط لینک http و https پشتیبانی می‌شود',
    'probe.errInvalid': 'لینک معتبر نیست',
    'probe.errUnsupported': 'این نوع لینک پشتیبانی نمی‌شود',
    'probe.errStatus': 'پاسخ سرور',
    'probe.retryProxy': 'تلاش دوباره از طریق سرور',

    'torrent.connecting': 'در حال اتصال به شبکه تورنت…',
    'torrent.searching': 'در جست‌وجوی سیدر…',
    'torrent.noVideo': 'در این تورنت فایل ویدیویی پیدا نشد.',
    'torrent.failed': 'اتصال به تورنت ناموفق بود.',
    'torrent.peers': 'سیدر',
    'torrent.speed': 'سرعت',
    'torrent.downloaded': 'دریافت‌شده',
    'torrent.ready': 'آماده پخش',

    'mirror.title': 'دامنه‌های در دسترس',
    'mirror.checking': 'در حال بررسی دامنه‌ها…',
    'mirror.current': 'در حال استفاده',
    'mirror.ok': 'در دسترس',
    'mirror.blocked': 'در دسترس نیست',
    'mirror.switch': 'رفتن به این دامنه',
    'mirror.copyBest': 'کپی بهترین لینک دعوت',
    'mirror.noneWorking': 'هیچ دامنه دیگری در دسترس نیست.',
    'mirror.suggest': 'به نظر می‌رسد این دامنه برای تو سریع‌تر است:',
    'mirror.sameRoom': 'همه دامنه‌ها به یک سرور و همان اتاق وصل‌اند.',
    'mirror.inviteNote': 'لینک دعوت با دامنه‌ای کپی شد که برای تو کار می‌کند؛ اگر دوستت باز نکرد، دامنه دیگری را امتحان کنید.',
    'mirror.open': 'دامنه‌ها',

    'status.title': 'وضعیت سرور',
    'status.tagLine': 'همه‌چیز سالم است ✅',
    'status.allGood': 'همه‌چیز سالم است ✅',
    'status.problems': 'مشکلاتی وجود دارد',
    'status.unreachable': 'سرور در دسترس نیست',
    'status.health': 'سلامت',
    'status.uptime': 'زمان بالا بودن',
    'status.rooms': 'اتاق‌ها',
    'status.users': 'کاربران',
    'status.cpu': 'پردازنده',
    'status.cores': 'هسته',
    'status.memUsed': 'رم استفاده شده',
    'status.free': 'آزاد',
    'status.total': 'کل',
    'status.load': 'بار سیستم',
    'status.perCore': 'به‌ترتیب: ۱ / ۵ / ۱۵ دقیقه',
    'status.nodeVer': 'نسخه Node',
    'status.ffmpeg': 'ffmpeg',
    'status.ytdlp': 'yt-dlp',
    'status.backHome': 'بازگشت',
    'status.refreshed': 'آخرین به‌روزرسانی',

    'nf.title': 'صفحه پیدا نشد',
    'nf.text': 'آدرسی که دنبالش بودی وجود ندارد یا اتاق بسته شده است.',
    'nf.home': 'بازگشت به خانه',
  },

  en: {
    'meta.title': 'Ba Man Bebin — Watch together, perfectly in sync',
    'meta.description': 'Ba Man Bebin lets you watch videos in perfect sync with friends, with live chat and instant reactions.',

    'nav.features': 'Features',
    'nav.how': 'How it works',
    'nav.faq': 'FAQ',
    'nav.create': 'Create room',
    'nav.menu': 'Menu',

    'hero.badge': 'Sub-100ms sync',
    'hero.title.1': 'Watch it ',
    'hero.title.hl': 'together',
    'hero.title.2': ', even from opposite ends of the world',
    'hero.lead': 'Spin up a room, share the link, and watch in perfect sync. Play, pause and seek happen for everyone at once — with live chat and floating reactions right next to the player.',
    'hero.cta.primary': 'Create a free room',
    'hero.cta.secondary': 'See features',
    'hero.note': 'No signup · No install',
    'hero.stat1': 'ms drift',
    'hero.stat2': 'people per room',
    'hero.stat3': 'availability',

    'mock.chat.1': 'Look at this scene!',
    'mock.chat.2': 'Hold on, getting popcorn 🍿',
    'mock.chat.3': 'Synced ✅',
    'mock.user1': 'Sara',
    'mock.user2': 'You',
    'mock.user3': 'System',

    'features.eyebrow': 'Features',
    'features.title': 'Everything you need for a shared movie night',
    'features.sub': 'Simple, fast and frictionless. Just send the link.',
    'f1.title': 'Frame-accurate sync',
    'f1.text': 'Play, pause and seek apply to everyone instantly — even if you join mid-movie.',
    'f2.title': 'Live chat',
    'f2.text': 'Chat next to the player without missing a second or switching apps.',
    'f3.title': 'Instant reactions',
    'f3.text': 'One click sends an emoji that floats across everyone’s screen.',
    'f4.title': 'YouTube, direct links & torrents',
    'f4.text': 'YouTube, a direct mp4/m3u8 link, a magnet/torrent, or your own file — all supported.',
    'f5.title': 'Host controls',
    'f5.text': 'The host drives playback and can hand control to anyone in the room.',
    'f6.title': 'No geo-restrictions',
    'f6.text': 'If a link is blocked where you are, stream it through the server instead — works anywhere.',

    'how.eyebrow': 'Get started',
    'how.title': 'Three simple steps',
    'how.sub': 'Less than a minute from zero to watching.',
    's1.title': 'Create a room',
    's1.text': 'Hit “Create room” and get a private space with its own unique ID.',
    's2.title': 'Share the link',
    's2.text': 'Send the room link to your friends — one click and they’re in.',
    's3.title': 'Watch together',
    's3.text': 'Pick a video source and press play; everyone syncs automatically.',

    'cta.title': 'Ready to start?',
    'cta.sub': 'Create a room or join with a room ID.',
    'cta.create': 'Create room',
    'cta.join': 'Join',
    'cta.placeholder': 'Room ID (e.g. abcd-1234)',

    'faq.eyebrow': 'Questions',
    'faq.title': 'Frequently asked',
    'faq.q1': 'Do I need an account?',
    'faq.a1': 'No. Just pick a nickname and you’re in the room.',
    'faq.q2': 'Is my video file uploaded?',
    'faq.a2': 'Never. Local files play only in your own browser; only the timeline is synced, so everyone needs the same file.',
    'faq.q3': 'How many people fit in a room?',
    'faq.a3': 'Up to 50 by default, and that limit is configurable on your server.',
    'faq.q4': 'Does it work on mobile?',
    'faq.a4': 'Yes — the interface is fully responsive and works well on phones and tablets.',

    'footer.rights': 'Built for shared movie nights.',
    'footer.brand': 'BA MAN BEBIN 2026',
    'footer.privacy': 'Privacy',
    'footer.status': 'Service status',

    'modal.title': 'Join the room',
    'modal.sub': 'Pick a name so your friends recognise you.',
    'modal.name': 'Display name',
    'modal.placeholder': 'e.g. Alex',
    'modal.enter': 'Enter room',

    'room.back': 'Home',
    'room.copy': 'Copy invite link',
    'room.copied': 'Invite link copied ✅',
    'room.leave': 'Leave',
    'room.host': 'Host',
    'room.viewer': 'Viewer',
    'room.live': 'Live',
    'room.members': 'In this room',
    'room.chat': 'Chat',
    'room.send': 'Send',
    'room.msgPlaceholder': 'Type a message…',
    'room.sourcePlaceholder': 'Paste a YouTube link…',
    'room.load': 'Load',
    'room.pickFile': 'Local file',
    'room.sync': 'Re-sync',
    'room.emptyTitle': 'No video selected yet',
    'room.emptyText': 'The host can paste a YouTube link or choose a local file.',
    'room.onlyHost': 'Only the host can control playback.',
    'room.hostNow': 'You are the host now 🎬',
    'room.joined': 'joined the room',
    'room.left': 'left the room',
    'room.disconnected': 'Connection lost, reconnecting…',
    'room.reconnected': 'Reconnected ✅',
    'room.invalidUrl': 'That doesn’t look like a valid YouTube link.',
    'room.fileNote': 'Local files play only for you; others must open the same file.',
    'room.typing': 'typing…',

    'room.sourcePlaceholderAny': 'YouTube, direct link (mp4/m3u8) or magnet…',
    'room.test': 'Test playback',
    'room.testing': 'Checking the link…',
    'room.proxy': 'Stream via server',
    'room.proxyHint': 'Routes the video through our server — turn this on if the link is blocked or filtered where you are.',
    'room.testFirst': 'Test the link first so we know it plays.',
    'room.enterLink': 'Please enter a link.',

    'probe.okTitle': 'Link works — ready to play ✅',
    'probe.warnTitle': 'Playable, but a few things to note',
    'probe.failTitle': 'This link will not play',
    'probe.ytTitle': 'Valid YouTube link ✅',
    'probe.torrentTitle': 'Magnet / torrent detected',
    'probe.kind': 'Source type',
    'probe.reachable': 'Link is reachable',
    'probe.contentType': 'Content type',
    'probe.size': 'File size',
    'probe.seekable': 'Seeking is supported',
    'probe.noSeek': 'Seeking may not work',
    'probe.corsOpen': 'Plays directly in the browser',
    'probe.corsClosed': 'Origin blocks direct playback — “Stream via server” enabled',
    'probe.hls': 'HLS stream — will play via hls.js',
    'probe.notVideo': 'Doesn’t look like video; it may be a download page, not a file',
    'probe.container': 'This container (mkv/avi) may not play in the browser',
    'probe.torrentNote': 'Torrents stream in the browser and need active seeders; startup takes a moment.',
    'probe.torrentP2P': 'Only torrents with WebRTC trackers work in a browser.',
    'probe.errTimeout': 'Timed out — the origin did not respond',
    'probe.errUnreachable': 'The origin server is unreachable',
    'probe.errDns': 'Domain not found',
    'probe.errBlocked': 'This address is not allowed (internal/private address)',
    'probe.errProtocol': 'Only http and https links are supported',
    'probe.errInvalid': 'That is not a valid link',
    'probe.errUnsupported': 'This kind of link is not supported',
    'probe.errStatus': 'Server responded',
    'probe.retryProxy': 'Retry through the server',

    'torrent.connecting': 'Connecting to the torrent network…',
    'torrent.searching': 'Looking for seeders…',
    'torrent.noVideo': 'No playable video file found in this torrent.',
    'torrent.failed': 'Could not connect to the torrent.',
    'torrent.peers': 'peers',
    'torrent.speed': 'speed',
    'torrent.downloaded': 'downloaded',
    'torrent.ready': 'Ready to play',

    'mirror.title': 'Available domains',
    'mirror.checking': 'Checking domains…',
    'mirror.current': 'in use',
    'mirror.ok': 'reachable',
    'mirror.blocked': 'unreachable',
    'mirror.switch': 'Switch to this domain',
    'mirror.copyBest': 'Copy best invite link',
    'mirror.noneWorking': 'No other domain is reachable.',
    'mirror.suggest': 'This domain looks faster for you:',
    'mirror.sameRoom': 'All domains hit the same server and the same room.',
    'mirror.inviteNote': 'Invite link copied using a domain that works for you; if your friend can’t open it, try another one.',
    'mirror.open': 'Domains',

    'status.title': 'Server status',
    'status.tagLine': 'Everything looks good ✅',
    'status.allGood': 'Everything looks good ✅',
    'status.problems': 'There are some issues',
    'status.unreachable': 'Server unreachable',
    'status.health': 'Health',
    'status.uptime': 'Uptime',
    'status.rooms': 'Rooms',
    'status.users': 'Users',
    'status.cpu': 'CPU',
    'status.cores': 'cores',
    'status.memUsed': 'Memory used',
    'status.free': 'free',
    'status.total': 'total',
    'status.load': 'System load',
    'status.perCore': '1 / 5 / 15 min averages',
    'status.nodeVer': 'Node version',
    'status.ffmpeg': 'ffmpeg',
    'status.ytdlp': 'yt-dlp',
    'status.backHome': 'Back',
    'status.refreshed': 'Last refresh',

    'nf.title': 'Page not found',
    'nf.text': 'The page you were looking for doesn’t exist, or the room has closed.',
    'nf.home': 'Back home',
  },
};

const STORAGE_KEY = 'bmb.lang';

export function currentLang() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'fa' || saved === 'en') return saved;
  return (navigator.language || 'en').toLowerCase().startsWith('fa') ? 'fa' : 'en';
}

export function t(key, lang = currentLang()) {
  return DICT[lang]?.[key] ?? DICT.en[key] ?? key;
}

export function applyLang(lang) {
  const dict = DICT[lang] || DICT.en;
  localStorage.setItem(STORAGE_KEY, lang);

  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (dict[key] !== undefined) el.textContent = dict[key];
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (dict[key] !== undefined) el.placeholder = dict[key];
  });

  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const key = el.dataset.i18nAria;
    if (dict[key] !== undefined) el.setAttribute('aria-label', dict[key]);
  });

  const title = document.querySelector('title[data-i18n]');
  if (title) document.title = dict[title.dataset.i18n] || document.title;

  const desc = document.querySelector('meta[name="description"]');
  if (desc && dict['meta.description']) desc.setAttribute('content', dict['meta.description']);

  document.querySelectorAll('.lang-switch button').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.lang === lang);
  });

  document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

export function initLangSwitch() {
  applyLang(currentLang());
  document.querySelectorAll('.lang-switch button').forEach((btn) => {
    btn.addEventListener('click', () => applyLang(btn.dataset.lang));
  });
}
