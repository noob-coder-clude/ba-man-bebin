package com.bamanbebin.dubber

import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import java.util.concurrent.Executors

class MainActivity : Activity() {

    companion object {
        private const val REQ_PICK_COOKIE_FILE = 1001
        private const val REQ_WEBVIEW_COOKIE = 1002

        private val VOICE_LABELS = listOf(
            "تشخیص خودکار زن/مرد (چندگوینده هوشمند)",
            "مرد — گرم و مستند (Orus)",
            "مرد — پرانرژی و یوتیوبی (Puck)",
            "مرد — عمیق و سینمایی (Charon)",
            "زن — طبیعی و صمیمی (Aoede)",
            "زن — شفاف و رسمی (Kore)"
        )
        private val VOICE_CODES = listOf("auto", "Orus", "Puck", "Charon", "Aoede", "Kore")

        private val QUALITY_LABELS = listOf(
            "360p — کم‌حجم و سریع",
            "480p — کیفیت متعادل",
            "720p HD — پیشنهادی",
            "1080p Full HD — بالاترین کیفیت"
        )
        private val QUALITY_CODES = listOf("360", "480", "720", "1080")

        private val STYLE_LABELS = listOf(
            "محاوره‌ای طبیعی و روان (یوتیوبی)",
            "معیار، رسمی و مستند",
            "پرانرژی و هیجانی"
        )
        private val STYLE_CODES = listOf("conversational", "formal", "energetic")
    }

    private lateinit var store: SecureStore
    private lateinit var ghClient: GitHubCloudClient
    private val bgExecutor = Executors.newCachedThreadPool()
    private val uiHandler = Handler(Looper.getMainLooper())

    // Tab views
    private lateinit var tabBtnDub: Button
    private lateinit var tabBtnLib: Button
    private lateinit var tabBtnSet: Button
    private lateinit var panelDub: LinearLayout
    private lateinit var panelLib: LinearLayout
    private lateinit var panelSet: LinearLayout
    private lateinit var headerReadyBadge: TextView

    // New Dub tab widgets
    private lateinit var ytUrlInput: EditText
    private lateinit var voiceSpinner: Spinner
    private lateinit var qualitySpinner: Spinner
    private lateinit var styleSpinner: Spinner
    private lateinit var keepBgCheck: CheckBox
    private lateinit var burnSubsCheck: CheckBox
    private lateinit var startDubBtn: Button

    // Live Cloud Progress Card widgets
    private lateinit var progressCard: LinearLayout
    private lateinit var progressTitleTv: TextView
    private lateinit var progressStepsTv: TextView
    private lateinit var progressSpinnerBar: ProgressBar
    private lateinit var readyActionsRow: LinearLayout
    private lateinit var cancelJobBtn: Button
    private lateinit var openGhRunBtn: Button
    private var currentRunHtmlUrl: String = ""
    private var latestCompletedItem: DubReleaseItem? = null
    private var isPolling = false

    // Library tab widgets
    private lateinit var libraryContainer: LinearLayout
    private lateinit var refreshLibBtn: Button

    // Settings tab widgets
    private lateinit var geminiKeyInput: EditText
    private lateinit var cookieStatusTv: TextView
    private lateinit var cookieRawInput: EditText
    private lateinit var ghRepoInput: EditText
    private lateinit var ghBranchInput: EditText
    private lateinit var ghTokenInput: EditText
    private lateinit var syncStatusTv: TextView
    private lateinit var syncSetupBtn: Button

    private val pollRunnable = object : Runnable {
        override fun run() {
            val runId = store.activeRunId
            if (runId <= 0L) {
                isPolling = false
                return
            }
            bgExecutor.execute {
                try {
                    val res = ghClient.pollRunStatus(runId)
                    var matchedRelease: DubReleaseItem? = null
                    if (res.status == "completed" && res.conclusion == "success") {
                        val lib = ghClient.fetchDubbedLibrary()
                        matchedRelease = lib.firstOrNull { it.jobId == store.activeJobId } ?: lib.firstOrNull()
                    }
                    uiHandler.post {
                        renderPollResult(res, matchedRelease)
                        if (res.status != "completed") {
                            uiHandler.postDelayed(this, 4500L)
                        } else {
                            isPolling = false
                            store.activeRunId = 0L
                        }
                    }
                } catch (e: Exception) {
                    uiHandler.post {
                        progressStepsTv.text = "در حال تلاش مجدد برای اتصال به گیت‌هاب... (${e.message})"
                        uiHandler.postDelayed(this, 6000L)
                    }
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SecureStore(this)
        ghClient = GitHubCloudClient(store)

        buildFullUi()
        handleIncomingShareIntent(intent)
        refreshReadinessBadge()

        if (store.activeRunId > 0L) {
            progressCard.visibility = View.VISIBLE
            startPollingLoop()
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent != null) {
            setIntent(intent)
            handleIncomingShareIntent(intent)
        }
    }

    private fun handleIncomingShareIntent(incoming: Intent?) {
        if (incoming?.action == Intent.ACTION_SEND && incoming.type == "text/plain") {
            val sharedText = incoming.getStringExtra(Intent.EXTRA_TEXT)?.trim() ?: ""
            val urlMatch = Regex("https?://[^\\s<>\"']+").find(sharedText)?.value ?: sharedText
            if (urlMatch.isNotEmpty()) {
                ytUrlInput.setText(urlMatch)
                switchTab(0)
                Toast.makeText(this, "لینک یوتیوب دریافت شد ✅ آماده دوبله!", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun buildFullUi() {
        val outer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setBackgroundColor(UiKit.BG_DARK)
        }

        // 1. Header Bar
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(UiKit.CARD_BG)
            val pH = UiKit.dp(this@MainActivity, 16)
            val pV = UiKit.dp(this@MainActivity, 14)
            setPadding(pH, pV, pH, pV)
        }

        val brandCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        brandCol.addView(UiKit.makeTitle(this, "🎬 دوبلور ابری فارسی", 18.5f))
        brandCol.addView(UiKit.makeBody(this, "پردازش ۱۰۰٪ روی سرور گیت‌هاب با هوش مصنوعی Gemini", 12f))

        headerReadyBadge = TextView(this).apply {
            textSize = 12f
            setTextColor(Color.WHITE)
            val pH = UiKit.dp(this@MainActivity, 10)
            val pV = UiKit.dp(this@MainActivity, 6)
            setPadding(pH, pV, pH, pV)
            setOnClickListener { switchTab(2) }
        }
        header.addView(brandCol)
        header.addView(headerReadyBadge)
        outer.addView(header)

        // 2. Segmented Tab Bar
        val tabBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(UiKit.CARD_BG)
            val p = UiKit.dp(this@MainActivity, 10)
            setPadding(p, 0, p, p)
        }
        tabBtnDub = makeTabButton("🎙️ دوبله جدید") { switchTab(0) }
        tabBtnLib = makeTabButton("🎞️ آرشیو و پخش") {
            switchTab(1)
            loadLibrary()
        }
        tabBtnSet = makeTabButton("⚙️ تنظیمات و کوکی") { switchTab(2) }

        tabBar.addView(tabBtnDub, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        tabBar.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(UiKit.dp(this@MainActivity, 6), 1) })
        tabBar.addView(tabBtnLib, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        tabBar.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(UiKit.dp(this@MainActivity, 6), 1) })
        tabBar.addView(tabBtnSet, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        outer.addView(tabBar)

        // 3. Scrollable Content Area
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val contentHolder = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = UiKit.dp(this@MainActivity, 14)
            setPadding(p, p, p, p)
        }

        panelDub = buildDubTab()
        panelLib = buildLibraryTab()
        panelSet = buildSettingsTab()

        contentHolder.addView(panelDub)
        contentHolder.addView(panelLib)
        contentHolder.addView(panelSet)
        scroll.addView(contentHolder)
        outer.addView(scroll)

        setContentView(outer)

        // Open Settings automatically on very first launch if credentials aren't configured yet
        if (store.geminiApiKey.isEmpty() || store.githubToken.isEmpty()) {
            switchTab(2)
        } else {
            switchTab(0)
        }
    }

    private fun makeTabButton(label: String, onClick: () -> Unit): Button {
        return Button(this).apply {
            text = label
            isAllCaps = false
            textSize = 13f
            minHeight = UiKit.dp(this@MainActivity, 44)
            setOnClickListener { onClick() }
        }
    }

    private fun switchTab(idx: Int) {
        panelDub.visibility = if (idx == 0) View.VISIBLE else View.GONE
        panelLib.visibility = if (idx == 1) View.VISIBLE else View.GONE
        panelSet.visibility = if (idx == 2) View.VISIBLE else View.GONE

        val activeBg = UiKit.roundedBg(UiKit.ACCENT_RUBY, 11, 0, 0, this)
        val idleBg = UiKit.roundedBg(UiKit.INPUT_BG, 11, UiKit.BORDER_SUBTLE, 1, this)

        tabBtnDub.background = if (idx == 0) activeBg else idleBg
        tabBtnLib.background = if (idx == 1) UiKit.roundedBg(UiKit.ACCENT_RUBY, 11, 0, 0, this) else UiKit.roundedBg(UiKit.INPUT_BG, 11, UiKit.BORDER_SUBTLE, 1, this)
        tabBtnSet.background = if (idx == 2) UiKit.roundedBg(UiKit.ACCENT_RUBY, 11, 0, 0, this) else UiKit.roundedBg(UiKit.INPUT_BG, 11, UiKit.BORDER_SUBTLE, 1, this)

        tabBtnDub.setTextColor(if (idx == 0) Color.WHITE else UiKit.TEXT_SECONDARY)
        tabBtnLib.setTextColor(if (idx == 1) Color.WHITE else UiKit.TEXT_SECONDARY)
        tabBtnSet.setTextColor(if (idx == 2) Color.WHITE else UiKit.TEXT_SECONDARY)
    }

    private fun buildDubTab(): LinearLayout {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        // Card 1: YouTube URL + Options
        val formCard = UiKit.makeCard(this)
        formCard.addView(UiKit.makeTitle(this, "لینک ویدیوی یوتیوب"))
        formCard.addView(
            UiKit.makeBody(
                this,
                "لینک ویدیو یا Shorts یوتیوب را وارد کنید (یا مستقیم از داخل اپ یوتیوب دکمه Share را بزنید و «دوبلور ابری» را انتخاب کنید)."
            )
        )
        formCard.addView(UiKit.spacer(this, 10))

        ytUrlInput = UiKit.makeInput(this, "https://youtu.be/... یا https://youtube.com/watch?v=...")
        formCard.addView(ytUrlInput)
        formCard.addView(UiKit.spacer(this, 8))

        val urlBtnRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        val pasteUrlBtn = UiKit.makeSecondaryButton(this, "📋 چسباندن لینک").apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener {
                val clip = readClipboard()
                if (clip.isNotEmpty()) ytUrlInput.setText(clip)
            }
        }
        val clearUrlBtn = UiKit.makeSecondaryButton(this, "پاک کردن").apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                marginStart = UiKit.dp(this@MainActivity, 8)
            }
            setOnClickListener { ytUrlInput.setText("") }
        }
        urlBtnRow.addView(pasteUrlBtn)
        urlBtnRow.addView(clearUrlBtn)
        formCard.addView(urlBtnRow)

        formCard.addView(UiKit.spacer(this, 14))
        formCard.addView(UiKit.makeTitle(this, "گوینده فارسی (موتور صوتی Gemini)", 15f))
        formCard.addView(UiKit.spacer(this, 6))
        voiceSpinner = UiKit.makeSpinner(this, VOICE_LABELS).apply {
            setSelection(store.preferredVoiceIdx.coerceIn(0, VOICE_LABELS.lastIndex))
        }
        formCard.addView(voiceSpinner)

        formCard.addView(UiKit.spacer(this, 12))
        formCard.addView(UiKit.makeTitle(this, "کیفیت ویدیوی خروجی", 15f))
        formCard.addView(UiKit.spacer(this, 6))
        qualitySpinner = UiKit.makeSpinner(this, QUALITY_LABELS).apply {
            setSelection(store.preferredQualityIdx.coerceIn(0, QUALITY_LABELS.lastIndex))
        }
        formCard.addView(qualitySpinner)

        formCard.addView(UiKit.spacer(this, 12))
        formCard.addView(UiKit.makeTitle(this, "سبک ترجمه و گویندگی", 15f))
        formCard.addView(UiKit.spacer(this, 6))
        styleSpinner = UiKit.makeSpinner(this, STYLE_LABELS).apply {
            setSelection(store.preferredStyleIdx.coerceIn(0, STYLE_LABELS.lastIndex))
        }
        formCard.addView(styleSpinner)

        formCard.addView(UiKit.spacer(this, 12))
        keepBgCheck = CheckBox(this).apply {
            text = "حفظ ملایم صدای محیط اصلی (۱۵٪) — در حالت تیک‌نخورده صدای اصلی کامل حذف می‌شود"
            setTextColor(UiKit.TEXT_SECONDARY)
            textSize = 13f
            isChecked = store.keepBgAudio
        }
        formCard.addView(keepBgCheck)

        burnSubsCheck = CheckBox(this).apply {
            text = "حک دائمی زیرنویس فارسی روی تصویر (بدون تیک هم زیرنویس زنده در پلیر فعال است)"
            setTextColor(UiKit.TEXT_SECONDARY)
            textSize = 13f
            isChecked = store.burnSubtitles
        }
        formCard.addView(burnSubsCheck)

        formCard.addView(UiKit.spacer(this, 14))
        startDubBtn = UiKit.makePrimaryButton(this, "🚀 شروع دوبله فارسی روی سرور گیت‌هاب").apply {
            setOnClickListener { triggerCloudDub() }
        }
        formCard.addView(startDubBtn)
        wrap.addView(formCard)

        // Card 2: Live GitHub Actions Cloud Progress Card
        progressCard = UiKit.makeCard(this).apply {
            visibility = View.GONE
        }
        progressTitleTv = UiKit.makeTitle(this, "⏳ وضعیت پردازش روی سرور گیت‌هاب", 16f)
        progressCard.addView(progressTitleTv)
        progressCard.addView(UiKit.spacer(this, 8))

        progressSpinnerBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
        }
        progressCard.addView(progressSpinnerBar)
        progressCard.addView(UiKit.spacer(this, 8))

        progressStepsTv = UiKit.makeBody(this, "در حال ارسال درخواست به سرور ابری...")
        progressCard.addView(progressStepsTv)
        progressCard.addView(UiKit.spacer(this, 12))

        readyActionsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            visibility = View.GONE
        }
        val playReadyBtn = UiKit.makePrimaryButton(this, "▶️ پخش آنلاین همین الان", UiKit.ACCENT_EMERALD).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener {
                latestCompletedItem?.let { openPlayer(it) }
            }
        }
        val dlReadyBtn = UiKit.makeSecondaryButton(this, "⬇️ دانلود در گوشی").apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                marginStart = UiKit.dp(this@MainActivity, 8)
            }
            setOnClickListener {
                latestCompletedItem?.let { downloadReleaseItem(it) }
            }
        }
        readyActionsRow.addView(playReadyBtn)
        readyActionsRow.addView(dlReadyBtn)
        progressCard.addView(readyActionsRow)
        progressCard.addView(UiKit.spacer(this, 8))

        val runFooterRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        openGhRunBtn = UiKit.makeSecondaryButton(this, "مشاهده لاگ گیت‌هاب 🌐").apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener {
                val u = currentRunHtmlUrl.ifEmpty { "https://github.com/${store.githubRepo}/actions" }
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u)))
            }
        }
        cancelJobBtn = UiKit.makeSecondaryButton(this, "لغو پردازش ⏹").apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                marginStart = UiKit.dp(this@MainActivity, 8)
            }
            setOnClickListener { cancelCurrentJob() }
        }
        runFooterRow.addView(openGhRunBtn)
        runFooterRow.addView(cancelJobBtn)
        progressCard.addView(runFooterRow)

        wrap.addView(progressCard)
        return wrap
    }

    private fun buildLibraryTab(): LinearLayout {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        val topCard = UiKit.makeCard(this)
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val infoCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        infoCol.addView(UiKit.makeTitle(this, "آرشیو ویدیوهای دوبله‌شده", 16f))
        infoCol.addView(UiKit.makeBody(this, "پخش آنلاین فوری با زیرنویس فارسی یا دانلود مستقیم در حافظه گوشی", 12.5f))

        refreshLibBtn = UiKit.makeSecondaryButton(this, "🔄 بروزرسانی").apply {
            setOnClickListener { loadLibrary() }
        }
        row.addView(infoCol)
        row.addView(refreshLibBtn)
        topCard.addView(row)
        wrap.addView(topCard)

        libraryContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        wrap.addView(libraryContainer)
        return wrap
    }

    private fun buildSettingsTab(): LinearLayout {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        // Card 1: Gemini API Key
        val geminiCard = UiKit.makeCard(this)
        geminiCard.addView(UiKit.makeTitle(this, "۱. کلید هوش مصنوعی Gemini"))
        geminiCard.addView(
            UiKit.makeBody(
                this,
                "هم ترجمه زمان‌بندی‌شده و هم صدای دوبله فارسی مستقیماً با همین کلید روی سرور گیت‌هاب انجام می‌شود (کلید با الگوریتم Libsodium رمزنگاری و در Secrets گیت‌هاب ذخیره می‌شود)."
            )
        )
        geminiCard.addView(UiKit.spacer(this, 10))
        geminiKeyInput = UiKit.makeInput(this, "AIzaSy...", isPassword = true).apply {
            setText(store.geminiApiKey)
        }
        geminiCard.addView(geminiKeyInput)
        geminiCard.addView(UiKit.spacer(this, 8))

        val gemBtnRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        var keyVisible = false
        val toggleKeyVisBtn = UiKit.makeSecondaryButton(this, "👁 نمایش کلید").apply {
            setOnClickListener {
                keyVisible = !keyVisible
                geminiKeyInput.inputType = if (keyVisible) {
                    InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                } else {
                    InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                }
                text = if (keyVisible) "🙈 مخفی کردن" else "👁 نمایش کلید"
            }
        }
        val getKeyBtn = UiKit.makeSecondaryButton(this, "دریافت کلید از Google AI Studio 🌐").apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = UiKit.dp(this@MainActivity, 8)
            }
            setOnClickListener {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://aistudio.google.com/apikey")))
            }
        }
        gemBtnRow.addView(toggleKeyVisBtn)
        gemBtnRow.addView(getKeyBtn)
        geminiCard.addView(gemBtnRow)
        wrap.addView(geminiCard)

        // Card 2: YouTube Cookies
        val cookieCard = UiKit.makeCard(this)
        cookieCard.addView(UiKit.makeTitle(this, "۲. کوکی اکانت یوتیوب"))
        cookieCard.addView(
            UiKit.makeBody(
                this,
                "کوکی باعث می‌شود سرور گیت‌هاب بدون خطای ربات (Sign in to confirm you’re not a bot) ویدیوها را دانلود کند. به ۳ روش می‌توانید کوکی بدهید:"
            )
        )
        cookieCard.addView(UiKit.spacer(this, 10))

        val webLoginBtn = UiKit.makePrimaryButton(
            this,
            "🔑 ورود مستقیم به اکانت یوتیوب در برنامه (تک‌کلیکی)",
            0xFF2563EB.toInt()
        ).apply {
            setOnClickListener {
                startActivityForResult(
                    Intent(this@MainActivity, CookieCaptureActivity::class.java),
                    REQ_WEBVIEW_COOKIE
                )
            }
        }
        cookieCard.addView(webLoginBtn)
        cookieCard.addView(UiKit.spacer(this, 8))

        val cookieBtnRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val pickFileBtn = UiKit.makeSecondaryButton(this, "📂 انتخاب فایل کوکی").apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener {
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                }
                startActivityForResult(intent, REQ_PICK_COOKIE_FILE)
            }
        }
        val pasteCookieBtn = UiKit.makeSecondaryButton(this, "📋 چسباندن متن کوکی").apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = UiKit.dp(this@MainActivity, 8)
            }
            setOnClickListener {
                val clip = readClipboard()
                if (clip.isNotEmpty()) {
                    cookieRawInput.setText(clip)
                    updateCookieBadge(clip)
                }
            }
        }
        cookieBtnRow.addView(pickFileBtn)
        cookieBtnRow.addView(pasteCookieBtn)
        cookieCard.addView(cookieBtnRow)

        cookieCard.addView(UiKit.spacer(this, 8))
        cookieRawInput = UiKit.makeInput(
            this,
            "# Netscape HTTP Cookie File  یا  JSON  یا  SID=...; __Secure-1PSID=...",
            multiLine = true
        ).apply {
            setText(store.youtubeCookies)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    updateCookieBadge(s?.toString() ?: "")
                }
            })
        }
        cookieCard.addView(cookieRawInput)
        cookieCard.addView(UiKit.spacer(this, 6))

        cookieStatusTv = UiKit.makeBody(this, "", 13f)
        cookieCard.addView(cookieStatusTv)
        updateCookieBadge(store.youtubeCookies)
        wrap.addView(cookieCard)

        // Card 3: GitHub Server Connection
        val ghCard = UiKit.makeCard(this)
        ghCard.addView(UiKit.makeTitle(this, "۳. سرور ابری گیت‌هاب (GitHub Actions)"))
        ghCard.addView(
            UiKit.makeBody(
                this,
                "توکن شخصی گیت‌هاب (PAT) با دسترسی repo و workflow وارد کنید تا برنامه مستقیماً سرور گیت‌هاب را کنترل کند."
            )
        )
        ghCard.addView(UiKit.spacer(this, 10))

        ghCard.addView(UiKit.makeBody(this, "نام ریپو (username/repo):", 12.5f))
        ghRepoInput = UiKit.makeInput(this, AppDefaults.DEFAULT_REPO).apply {
            setText(store.githubRepo)
        }
        ghCard.addView(ghRepoInput)
        ghCard.addView(UiKit.spacer(this, 8))

        ghCard.addView(UiKit.makeBody(this, "برنچ هدف (Branch):", 12.5f))
        ghBranchInput = UiKit.makeInput(this, AppDefaults.DEFAULT_BRANCH).apply {
            setText(store.githubBranch)
        }
        ghCard.addView(ghBranchInput)
        ghCard.addView(UiKit.spacer(this, 8))

        ghCard.addView(UiKit.makeBody(this, "توکن گیت‌هاب (Personal Access Token):", 12.5f))
        ghTokenInput = UiKit.makeInput(this, "ghp_... یا github_pat_...", isPassword = true).apply {
            setText(store.githubToken)
        }
        ghCard.addView(ghTokenInput)
        ghCard.addView(UiKit.spacer(this, 8))

        val createPatBtn = UiKit.makeSecondaryButton(this, "ساخت توکن آماده در گیت‌هاب (با دسترسی repo + workflow) 🌐").apply {
            setOnClickListener {
                startActivity(
                    Intent(
                        Intent.ACTION_VIEW,
                        Uri.parse("https://github.com/settings/tokens/new?scopes=repo,workflow&description=BaManDubber")
                    )
                )
            }
        }
        ghCard.addView(createPatBtn)
        ghCard.addView(UiKit.spacer(this, 12))

        syncSetupBtn = UiKit.makePrimaryButton(
            this,
            "🔒 ذخیره، رمزنگاری سکرت‌ها و تست سرور گیت‌هاب",
            UiKit.ACCENT_EMERALD
        ).apply {
            setOnClickListener { saveAndVerifyServer() }
        }
        ghCard.addView(syncSetupBtn)
        ghCard.addView(UiKit.spacer(this, 8))

        syncStatusTv = UiKit.makeBody(this, "", 13f)
        ghCard.addView(syncStatusTv)
        wrap.addView(ghCard)

        return wrap
    }

    private fun updateCookieBadge(raw: String) {
        val summary = CookieUtils.inspectCookies(raw)
        cookieStatusTv.text = summary.statusText
        cookieStatusTv.setTextColor(
            when {
                summary.hasAuthTokens -> UiKit.ACCENT_EMERALD
                summary.isValid -> UiKit.ACCENT_AMBER
                else -> UiKit.TEXT_SECONDARY
            }
        )
    }

    private fun persistSettingsInputs() {
        store.geminiApiKey = geminiKeyInput.text.toString()
        store.youtubeCookies = cookieRawInput.text.toString()
        store.githubRepo = ghRepoInput.text.toString().ifBlank { AppDefaults.DEFAULT_REPO }
        store.githubBranch = ghBranchInput.text.toString().ifBlank { AppDefaults.DEFAULT_BRANCH }
        store.githubToken = ghTokenInput.text.toString()
        refreshReadinessBadge()
    }

    private fun refreshReadinessBadge() {
        val ready = store.geminiApiKey.isNotEmpty() && store.githubToken.isNotEmpty()
        val hasCookies = CookieUtils.inspectCookies(store.youtubeCookies).isValid
        when {
            ready && hasCookies -> {
                headerReadyBadge.text = "✅ آماده دوبله"
                headerReadyBadge.background = UiKit.roundedBg(0xFF065F46.toInt(), 99, UiKit.ACCENT_EMERALD, 1, this)
            }
            ready -> {
                headerReadyBadge.text = "⚠️ بدون کوکی"
                headerReadyBadge.background = UiKit.roundedBg(0xFF78350F.toInt(), 99, UiKit.ACCENT_AMBER, 1, this)
            }
            else -> {
                headerReadyBadge.text = "⚙️ تکمیل تنظیمات"
                headerReadyBadge.background = UiKit.roundedBg(UiKit.CARD_ALT, 99, UiKit.ACCENT_RUBY, 1, this)
            }
        }
    }

    private fun saveAndVerifyServer() {
        persistSettingsInputs()
        if (store.geminiApiKey.isEmpty()) {
            Toast.makeText(this, "ابتدا کلید Gemini را وارد کنید.", Toast.LENGTH_LONG).show()
            return
        }
        if (store.githubToken.isEmpty()) {
            Toast.makeText(this, "ابتدا توکن گیت‌هاب (PAT) را وارد کنید.", Toast.LENGTH_LONG).show()
            return
        }

        syncSetupBtn.isEnabled = false
        syncSetupBtn.text = "⏳ در حال رمزنگاری و اتصال به گیت‌هاب..."
        syncStatusTv.text = "در حال دریافت کلید عمومی ریپو و آپلود امن کلید Gemini و کوکی‌ها..."
        syncStatusTv.setTextColor(UiKit.TEXT_SECONDARY)

        bgExecutor.execute {
            try {
                val res = ghClient.verifyAndSetupRepo()
                uiHandler.post {
                    syncSetupBtn.isEnabled = true
                    syncSetupBtn.text = "🔒 ذخیره، رمزنگاری سکرت‌ها و تست سرور گیت‌هاب"
                    syncStatusTv.text = res.message
                    syncStatusTv.setTextColor(if (res.ok) UiKit.ACCENT_EMERALD else UiKit.ACCENT_AMBER)
                    refreshReadinessBadge()
                    if (res.ok) {
                        Toast.makeText(this, "سرور گیت‌هاب آماده دوبله است! 🎉", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                uiHandler.post {
                    syncSetupBtn.isEnabled = true
                    syncSetupBtn.text = "🔒 ذخیره، رمزنگاری سکرت‌ها و تست سرور گیت‌هاب"
                    syncStatusTv.text = "❌ خطا: ${e.message}"
                    syncStatusTv.setTextColor(UiKit.ACCENT_RUBY)
                }
            }
        }
    }

    private fun triggerCloudDub() {
        val url = ytUrlInput.text.toString().trim()
        if (url.isEmpty()) {
            Toast.makeText(this, "لطفاً لینک ویدیوی یوتیوب را وارد کنید.", Toast.LENGTH_SHORT).show()
            return
        }
        if (store.geminiApiKey.isEmpty() || store.githubToken.isEmpty()) {
            Toast.makeText(this, "ابتدا کلید Gemini و توکن گیت‌هاب را در تب تنظیمات وارد کنید.", Toast.LENGTH_LONG).show()
            switchTab(2)
            return
        }

        val vIdx = voiceSpinner.selectedItemPosition.coerceIn(0, VOICE_CODES.lastIndex)
        val qIdx = qualitySpinner.selectedItemPosition.coerceIn(0, QUALITY_CODES.lastIndex)
        val sIdx = styleSpinner.selectedItemPosition.coerceIn(0, STYLE_CODES.lastIndex)
        store.preferredVoiceIdx = vIdx
        store.preferredQualityIdx = qIdx
        store.preferredStyleIdx = sIdx
        store.keepBgAudio = keepBgCheck.isChecked
        store.burnSubtitles = burnSubsCheck.isChecked

        val voiceCode = VOICE_CODES[vIdx]
        val qualityCode = QUALITY_CODES[qIdx]
        val styleCode = STYLE_CODES[sIdx]
        val bgVolumePct = if (keepBgCheck.isChecked) 15 else 0
        val burnSubs = burnSubsCheck.isChecked

        startDubBtn.isEnabled = false
        startDubBtn.text = "⏳ در حال ارسال به سرور گیت‌هاب..."
        progressCard.visibility = View.VISIBLE
        readyActionsRow.visibility = View.GONE
        progressSpinnerBar.visibility = View.VISIBLE
        progressTitleTv.text = "🚀 در حال راه‌اندازی سرور دوبله گیت‌هاب..."
        progressStepsTv.text = "همگام‌سازی رمزنگاری‌شده کلیدها و ثبت سفارش دوبله..."

        bgExecutor.execute {
            try {
                val (_, runId) = ghClient.startDubJob(
                    youtubeUrl = url,
                    voiceName = voiceCode,
                    videoQuality = qualityCode,
                    styleMode = styleCode,
                    bgVolumePct = bgVolumePct,
                    burnSubtitles = burnSubs
                )
                uiHandler.post {
                    startDubBtn.isEnabled = true
                    startDubBtn.text = "🚀 شروع دوبله فارسی روی سرور گیت‌هاب"
                    if (runId > 0L) {
                        progressTitleTv.text = "⚙️ سرور گیت‌هاب مشغول دوبله ویدیو است"
                        progressStepsTv.text = "شناسه اجرا: #$runId — در حال دریافت زنده مراحل..."
                        startPollingLoop()
                    } else {
                        progressTitleTv.text = "✅ درخواست دوبله به گیت‌هاب ارسال شد"
                        progressStepsTv.text =
                            "درخواست ثبت شد. اگر اجرای خودکار شروع نشد، از تب تنظیمات بررسی کنید فایل ورک‌فلو روی برنچ فعال باشد."
                        progressSpinnerBar.visibility = View.GONE
                    }
                }
            } catch (e: Exception) {
                uiHandler.post {
                    startDubBtn.isEnabled = true
                    startDubBtn.text = "🚀 شروع دوبله فارسی روی سرور گیت‌هاب"
                    progressSpinnerBar.visibility = View.GONE
                    progressTitleTv.text = "❌ خطا در شروع دوبله"
                    progressStepsTv.text = e.message ?: "خطای ناشناخته"
                }
            }
        }
    }

    private fun startPollingLoop() {
        if (isPolling) return
        isPolling = true
        uiHandler.removeCallbacks(pollRunnable)
        uiHandler.post(pollRunnable)
    }

    private fun renderPollResult(res: RunPollResult, completedItem: DubReleaseItem?) {
        currentRunHtmlUrl = res.htmlUrl

        val stepLines = res.steps.joinToString("\n") { st ->
            val icon = when {
                st.status == "completed" && st.conclusion == "success" -> "✅"
                st.status == "completed" && st.conclusion == "failure" -> "❌"
                st.status == "in_progress" -> "🔄"
                else -> "⏺"
            }
            "$icon ${st.name}"
        }

        when {
            res.status != "completed" -> {
                progressSpinnerBar.visibility = View.VISIBLE
                cancelJobBtn.visibility = View.VISIBLE
                readyActionsRow.visibility = View.GONE
                progressTitleTv.text = if (res.status == "queued") {
                    "⏳ در صف اختصاص سرور ابری گیت‌هاب..."
                } else {
                    "🎙️ در حال دوبله فارسی روی سرور گیت‌هاب..."
                }
                progressStepsTv.text = stepLines.ifEmpty { "در حال آماده‌سازی ماشین مجازی لینوکس گیت‌هاب..." }
            }
            res.conclusion == "success" -> {
                progressSpinnerBar.visibility = View.GONE
                cancelJobBtn.visibility = View.GONE
                progressTitleTv.text = "🎉 دوبله فارسی با موفقیت آماده شد!"
                latestCompletedItem = completedItem
                if (completedItem != null) {
                    progressStepsTv.text =
                        "«${completedItem.titleFa}» (${"%.1f".format(completedItem.fileSizeMb)} مگابایت)\n$stepLines"
                    readyActionsRow.visibility = View.VISIBLE
                } else {
                    progressStepsTv.text = "$stepLines\nاز تب «آرشیو و پخش» ویدیو را تماشا یا دانلود کنید."
                }
            }
            res.conclusion == "cancelled" -> {
                progressSpinnerBar.visibility = View.GONE
                cancelJobBtn.visibility = View.GONE
                progressTitleTv.text = "⏹ پردازش دوبله لغو شد"
                progressStepsTv.text = stepLines
            }
            else -> {
                progressSpinnerBar.visibility = View.GONE
                cancelJobBtn.visibility = View.GONE
                progressTitleTv.text = "❌ خطا در حین دوبله روی سرور"
                val detail = if (res.errorDetail.isNotEmpty()) "\n\nعلت خطا:\n${res.errorDetail}" else ""
                progressStepsTv.text = "$stepLines$detail"
            }
        }
    }

    private fun cancelCurrentJob() {
        val runId = store.activeRunId
        if (runId <= 0L) return
        bgExecutor.execute {
            try {
                ghClient.cancelRun(runId)
                uiHandler.post {
                    Toast.makeText(this, "درخواست لغو به سرور گیت‌هاب ارسال شد.", Toast.LENGTH_SHORT).show()
                }
            } catch (_: Exception) {
            }
        }
    }

    private fun loadLibrary() {
        if (store.githubToken.isEmpty()) {
            libraryContainer.removeAllViews()
            val emptyCard = UiKit.makeCard(this)
            emptyCard.addView(UiKit.makeBody(this, "ابتدا توکن گیت‌هاب را در تب «تنظیمات و کوکی» وارد کنید."))
            libraryContainer.addView(emptyCard)
            return
        }

        refreshLibBtn.isEnabled = false
        refreshLibBtn.text = "⏳..."
        libraryContainer.removeAllViews()
        val loadingCard = UiKit.makeCard(this)
        loadingCard.addView(UiKit.makeBody(this, "در حال دریافت لیست ویدیوهای دوبله‌شده از گیت‌هاب..."))
        libraryContainer.addView(loadingCard)

        bgExecutor.execute {
            try {
                val items = ghClient.fetchDubbedLibrary()
                uiHandler.post {
                    refreshLibBtn.isEnabled = true
                    refreshLibBtn.text = "🔄 بروزرسانی"
                    renderLibraryItems(items)
                }
            } catch (e: Exception) {
                uiHandler.post {
                    refreshLibBtn.isEnabled = true
                    refreshLibBtn.text = "🔄 بروزرسانی"
                    libraryContainer.removeAllViews()
                    val errCard = UiKit.makeCard(this)
                    errCard.addView(UiKit.makeBody(this, "❌ ${e.message}", color = UiKit.ACCENT_RUBY))
                    libraryContainer.addView(errCard)
                }
            }
        }
    }

    private fun renderLibraryItems(items: List<DubReleaseItem>) {
        libraryContainer.removeAllViews()
        if (items.isEmpty()) {
            val empty = UiKit.makeCard(this)
            empty.addView(UiKit.makeBody(this, "هنوز ویدیوی دوبله‌شده‌ای در این ریپو ثبت نشده است. از تب «دوبله جدید» اولین ویدیو را بفرستید!"))
            libraryContainer.addView(empty)
            return
        }

        for (item in items) {
            val card = UiKit.makeCard(this)
            card.addView(UiKit.makeTitle(this, item.titleFa, 16f))
            if (item.titleOrig.isNotEmpty() && item.titleOrig != item.titleFa) {
                card.addView(UiKit.makeBody(this, item.titleOrig, 12f))
            }
            if (item.summaryFa.isNotEmpty()) {
                card.addView(UiKit.spacer(this, 4))
                card.addView(UiKit.makeBody(this, item.summaryFa, 13f, UiKit.TEXT_PRIMARY))
            }
            card.addView(UiKit.spacer(this, 6))
            val durMin = (item.durationSec / 60.0).toInt()
            val durSecRem = (item.durationSec % 60.0).toInt()
            val metaLine = "⏱ %02d:%02d   •   📦 %.1f MB   •   🎙️ %s".format(
                durMin,
                durSecRem,
                item.fileSizeMb,
                item.voice
            )
            card.addView(UiKit.makeBody(this, metaLine, 12f))
            card.addView(UiKit.spacer(this, 10))

            val btnRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            val playBtn = UiKit.makePrimaryButton(this, "▶️ پخش آنلاین", UiKit.ACCENT_RUBY).apply {
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                setOnClickListener { openPlayer(item) }
            }
            val dlBtn = UiKit.makeSecondaryButton(this, "⬇️ دانلود").apply {
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    marginStart = UiKit.dp(this@MainActivity, 6)
                }
                setOnClickListener { downloadReleaseItem(item) }
            }
            val delBtn = UiKit.makeSecondaryButton(this, "🗑️").apply {
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    marginStart = UiKit.dp(this@MainActivity, 6)
                }
                setOnClickListener { confirmDeleteItem(item) }
            }
            btnRow.addView(playBtn)
            btnRow.addView(dlBtn)
            btnRow.addView(delBtn)
            card.addView(btnRow)

            libraryContainer.addView(card)
        }
    }

    private fun openPlayer(item: DubReleaseItem) {
        val i = Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_TITLE_FA, item.titleFa)
            putExtra(PlayerActivity.EXTRA_MP4_BROWSER_URL, item.mp4BrowserUrl)
            putExtra(PlayerActivity.EXTRA_MP4_API_URL, item.mp4ApiAssetUrl)
            putExtra(PlayerActivity.EXTRA_SRT_BROWSER_URL, item.srtBrowserUrl)
            putExtra(PlayerActivity.EXTRA_SRT_API_URL, item.srtApiAssetUrl)
        }
        startActivity(i)
    }

    private fun downloadReleaseItem(item: DubReleaseItem) {
        Toast.makeText(this, "در حال آماده‌سازی لینک دانلود مستقیم...", Toast.LENGTH_SHORT).show()
        bgExecutor.execute {
            val directUrl = ghClient.resolveStreamableUrl(item.mp4ApiAssetUrl, item.mp4BrowserUrl)
            uiHandler.post {
                if (directUrl.isEmpty()) {
                    Toast.makeText(this, "لینک دانلود یافت نشد.", Toast.LENGTH_LONG).show()
                    return@post
                }
                val safeName = item.titleFa
                    .replace(Regex("[^\\p{L}\\p{N}_\\- ]"), "")
                    .trim()
                    .take(45)
                    .ifEmpty { item.jobId }
                try {
                    val req = DownloadManager.Request(Uri.parse(directUrl))
                        .setTitle("دوبله فارسی: ${item.titleFa}")
                        .setDescription("ذخیره در پوشه Movies/BaManDubber")
                        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        .setDestinationInExternalPublicDir(Environment.DIRECTORY_MOVIES, "BaManDubber/${safeName}_fa.mp4")
                    val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                    dm.enqueue(req)
                    Toast.makeText(this, "دانلود در پوشه Movies/BaManDubber آغاز شد ✅", Toast.LENGTH_LONG).show()
                } catch (e: Exception) {
                    Toast.makeText(this, "خطا در دانلود: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun confirmDeleteItem(item: DubReleaseItem) {
        AlertDialog.Builder(this)
            .setTitle("حذف ویدیو از سرور گیت‌هاب")
            .setMessage("آیا مطمئن هستید که «${item.titleFa}» از Releases گیت‌هاب حذف شود؟")
            .setPositiveButton("بله، حذف شود") { _, _ ->
                bgExecutor.execute {
                    try {
                        ghClient.deleteDubRelease(item.releaseId, item.tagName)
                        uiHandler.post {
                            Toast.makeText(this, "با موفقیت از گیت‌هاب حذف شد.", Toast.LENGTH_SHORT).show()
                            loadLibrary()
                        }
                    } catch (e: Exception) {
                        uiHandler.post {
                            Toast.makeText(this, "خطا در حذف: ${e.message}", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
            .setNegativeButton("انصراف", null)
            .show()
    }

    private fun readClipboard(): String {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return ""
        val clip = cm.primaryClip ?: return ""
        if (clip.itemCount <= 0) return ""
        return clip.getItemAt(0).coerceToText(this)?.toString()?.trim() ?: ""
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK || data == null) return

        when (requestCode) {
            REQ_PICK_COOKIE_FILE -> {
                val uri = data.data ?: return
                try {
                    val content = contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)?.use {
                        it.readText()
                    } ?: ""
                    cookieRawInput.setText(content)
                    store.youtubeCookies = content
                    updateCookieBadge(content)
                    refreshReadinessBadge()
                    Toast.makeText(this, "فایل کوکی با موفقیت بارگذاری شد ✅", Toast.LENGTH_SHORT).show()
                } catch (e: Exception) {
                    Toast.makeText(this, "خطا در خواندن فایل کوکی: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
            REQ_WEBVIEW_COOKIE -> {
                val captured = data.getStringExtra(CookieCaptureActivity.EXTRA_COOKIES_RESULT) ?: ""
                if (captured.isNotEmpty()) {
                    cookieRawInput.setText(captured)
                    store.youtubeCookies = captured
                    updateCookieBadge(captured)
                    refreshReadinessBadge()
                    Toast.makeText(this, "کوکی یوتیوب استخراج شد! حالا دکمه ذخیره و تست سرور را بزنید ✅", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    override fun onPause() {
        super.onPause()
        if (::geminiKeyInput.isInitialized) {
            persistSettingsInputs()
        }
    }

    override fun onDestroy() {
        uiHandler.removeCallbacksAndMessages(null)
        bgExecutor.shutdownNow()
        super.onDestroy()
    }
}
