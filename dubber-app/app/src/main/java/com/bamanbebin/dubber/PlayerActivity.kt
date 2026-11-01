package com.bamanbebin.dubber

import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import android.widget.VideoView
import java.util.concurrent.Executors

/**
 * Built-in Cinema Streaming Player for Persian-Dubbed GitHub Release Videos.
 * Supports instant HTTPS streaming (+faststart MP4), live Persian .srt subtitle
 * overlay toggle, ±10s skip, landscape fullscreen, and 1-tap download to phone.
 */
class PlayerActivity : Activity() {

    companion object {
        const val EXTRA_TITLE_FA = "extra_title_fa"
        const val EXTRA_MP4_BROWSER_URL = "extra_mp4_browser_url"
        const val EXTRA_MP4_API_URL = "extra_mp4_api_url"
        const val EXTRA_SRT_BROWSER_URL = "extra_srt_browser_url"
        const val EXTRA_SRT_API_URL = "extra_srt_api_url"
    }

    private val bgExecutor = Executors.newCachedThreadPool()
    private val uiHandler = Handler(Looper.getMainLooper())

    private lateinit var videoView: VideoView
    private lateinit var loadingSpinner: ProgressBar
    private lateinit var subtitleTv: TextView
    private lateinit var seekBar: SeekBar
    private lateinit var timeTv: TextView
    private lateinit var playPauseBtn: TextView
    private lateinit var controlsOverlay: LinearLayout

    private var srtCues: List<SrtCue> = emptyList()
    private var subtitlesEnabled = true
    private var isUserSeeking = false
    private var isLandscape = false
    private var resolvedStreamUrl: String = ""
    private var titleFa: String = "ویدیوی دوبله‌شده"

    private val ticker = object : Runnable {
        override fun run() {
            if (::videoView.isInitialized) {
                try {
                    val pos = videoView.currentPosition
                    val dur = videoView.duration
                    if (dur > 0 && !isUserSeeking) {
                        seekBar.max = dur
                        seekBar.progress = pos
                        timeTv.text = "${fmtTime(pos)} / ${fmtTime(dur)}"
                    }
                    if (subtitlesEnabled && srtCues.isNotEmpty()) {
                        val cue = SrtParser.findCueAt(srtCues, pos.toLong())
                        if (!cue.isNullOrBlank()) {
                            subtitleTv.text = cue
                            subtitleTv.visibility = View.VISIBLE
                        } else {
                            subtitleTv.visibility = View.GONE
                        }
                    } else {
                        subtitleTv.visibility = View.GONE
                    }
                } catch (_: Exception) {
                }
            }
            uiHandler.postDelayed(this, 180L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        titleFa = intent.getStringExtra(EXTRA_TITLE_FA) ?: "ویدیوی دوبله‌شده"
        val mp4Browser = intent.getStringExtra(EXTRA_MP4_BROWSER_URL) ?: ""
        val mp4Api = intent.getStringExtra(EXTRA_MP4_API_URL) ?: ""
        val srtBrowser = intent.getStringExtra(EXTRA_SRT_BROWSER_URL) ?: ""
        val srtApi = intent.getStringExtra(EXTRA_SRT_API_URL) ?: ""

        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }

        videoView = VideoView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER
            )
            setOnPreparedListener { mp ->
                loadingSpinner.visibility = View.GONE
                mp.isLooping = false
                start()
                playPauseBtn.text = "⏸ توقف"
            }
            setOnCompletionListener {
                playPauseBtn.text = "▶️ پخش مجدد"
            }
            setOnErrorListener { _, what, extra ->
                loadingSpinner.visibility = View.GONE
                Toast.makeText(
                    this@PlayerActivity,
                    "خطا در پخش آنلاین ویدیو ($what/$extra). می‌توانید دکمه دانلود را بزنید.",
                    Toast.LENGTH_LONG
                ).show()
                true
            }
        }
        root.addView(videoView)

        // Tap video surface to toggle controls visibility
        val tapCatcher = View(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setOnClickListener {
                controlsOverlay.visibility =
                    if (controlsOverlay.visibility == View.VISIBLE) View.GONE else View.VISIBLE
            }
        }
        root.addView(tapCatcher)

        loadingSpinner = ProgressBar(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                UiKit.dp(this@PlayerActivity, 54),
                UiKit.dp(this@PlayerActivity, 54),
                Gravity.CENTER
            )
        }
        root.addView(loadingSpinner)

        // Live Persian Subtitle Overlay
        subtitleTv = TextView(this).apply {
            visibility = View.GONE
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16.5f)
            gravity = Gravity.CENTER
            textDirection = View.TEXT_DIRECTION_RTL
            background = UiKit.roundedBg(0xCC000000.toInt(), 10, 0, 0, this@PlayerActivity)
            val pH = UiKit.dp(this@PlayerActivity, 14)
            val pV = UiKit.dp(this@PlayerActivity, 7)
            setPadding(pH, pV, pH, pV)
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            ).apply {
                bottomMargin = UiKit.dp(this@PlayerActivity, 96)
                marginStart = UiKit.dp(this@PlayerActivity, 20)
                marginEnd = UiKit.dp(this@PlayerActivity, 20)
            }
        }
        root.addView(subtitleTv)

        // Controls Overlay (Top Header + Bottom Transport)
        controlsOverlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(0xBB0B0F19.toInt())
            val p = UiKit.dp(this@PlayerActivity, 12)
            setPadding(p, p, p, p)
        }
        val backBtn = UiKit.makeSecondaryButton(this, "بازگشت ❯").apply {
            setOnClickListener { finish() }
        }
        val headerTv = UiKit.makeTitle(this, titleFa, 15f).apply {
            maxLines = 1
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = UiKit.dp(this@PlayerActivity, 10)
                marginEnd = UiKit.dp(this@PlayerActivity, 10)
            }
        }
        val dlBtn = UiKit.makePrimaryButton(this, "دانلود ⬇️", UiKit.ACCENT_EMERALD).apply {
            setOnClickListener { enqueueDownload() }
        }
        topBar.addView(backBtn)
        topBar.addView(headerTv)
        topBar.addView(dlBtn)
        controlsOverlay.addView(topBar)

        controlsOverlay.addView(
            View(this).apply {
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
                isClickable = false
            }
        )

        val bottomBar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xCC0B0F19.toInt())
            val p = UiKit.dp(this@PlayerActivity, 12)
            setPadding(p, p, p, p)
        }

        seekBar = SeekBar(this).apply {
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(sb: SeekBar?, progress: Int, fromUser: Boolean) {
                    if (fromUser && videoView.duration > 0) {
                        timeTv.text = "${fmtTime(progress)} / ${fmtTime(videoView.duration)}"
                    }
                }

                override fun onStartTrackingTouch(sb: SeekBar?) {
                    isUserSeeking = true
                }

                override fun onStopTrackingTouch(sb: SeekBar?) {
                    isUserSeeking = false
                    sb?.let { videoView.seekTo(it.progress) }
                }
            })
        }
        bottomBar.addView(seekBar)

        val transportRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }

        playPauseBtn = UiKit.makePrimaryButton(this, "⏳ آماده...", UiKit.ACCENT_RUBY).apply {
            setOnClickListener {
                if (videoView.isPlaying) {
                    videoView.pause()
                    text = "▶️ ادامه"
                } else {
                    videoView.start()
                    text = "⏸ توقف"
                }
            }
        }
        val back10Btn = UiKit.makeSecondaryButton(this, "-۱۰s").apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { marginStart = UiKit.dp(this@PlayerActivity, 6) }
            setOnClickListener {
                videoView.seekTo((videoView.currentPosition - 10_000).coerceAtLeast(0))
            }
        }
        val fwd10Btn = UiKit.makeSecondaryButton(this, "+۱۰s").apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { marginStart = UiKit.dp(this@PlayerActivity, 6) }
            setOnClickListener {
                val dur = videoView.duration
                if (dur > 0) videoView.seekTo((videoView.currentPosition + 10_000).coerceAtMost(dur))
            }
        }
        val subToggleBtn = UiKit.makeSecondaryButton(this, "زیرنویس: روشن").apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { marginStart = UiKit.dp(this@PlayerActivity, 6) }
            setOnClickListener {
                subtitlesEnabled = !subtitlesEnabled
                text = if (subtitlesEnabled) "زیرنویس: روشن" else "زیرنویس: خاموش"
            }
        }
        val rotateBtn = UiKit.makeSecondaryButton(this, "⛶ چرخش").apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { marginStart = UiKit.dp(this@PlayerActivity, 6) }
            setOnClickListener {
                isLandscape = !isLandscape
                requestedOrientation = if (isLandscape) {
                    ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                } else {
                    ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                }
            }
        }

        timeTv = UiKit.makeBody(this, "00:00 / 00:00", 12.5f).apply {
            textDirection = View.TEXT_DIRECTION_LTR
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = UiKit.dp(this@PlayerActivity, 8)
            }
        }

        transportRow.addView(playPauseBtn)
        transportRow.addView(back10Btn)
        transportRow.addView(fwd10Btn)
        transportRow.addView(subToggleBtn)
        transportRow.addView(rotateBtn)
        transportRow.addView(timeTv)
        bottomBar.addView(transportRow)
        controlsOverlay.addView(bottomBar)

        root.addView(controlsOverlay)
        setContentView(root)

        val store = SecureStore(this)
        val gh = GitHubCloudClient(store)

        bgExecutor.execute {
            val streamUrl = gh.resolveStreamableUrl(mp4Api, mp4Browser)
            resolvedStreamUrl = streamUrl

            var parsedSubs: List<SrtCue> = emptyList()
            if (srtApi.isNotEmpty() || srtBrowser.isNotEmpty()) {
                try {
                    val srtUrl = gh.resolveStreamableUrl(srtApi, srtBrowser)
                    if (srtUrl.isNotEmpty()) {
                        val srtText = gh.fetchTextUrl(srtUrl)
                        parsedSubs = SrtParser.parse(srtText)
                    }
                } catch (_: Exception) {
                }
            }

            uiHandler.post {
                srtCues = parsedSubs
                if (streamUrl.isEmpty()) {
                    loadingSpinner.visibility = View.GONE
                    Toast.makeText(this, "لینک پخش ویدیو یافت نشد.", Toast.LENGTH_LONG).show()
                } else {
                    videoView.setVideoURI(Uri.parse(streamUrl))
                }
            }
        }

        uiHandler.post(ticker)
    }

    private fun enqueueDownload() {
        val url = resolvedStreamUrl
        if (url.isEmpty()) {
            Toast.makeText(this, "لینک دانلود هنوز آماده نشده است.", Toast.LENGTH_SHORT).show()
            return
        }
        val safeName = titleFa.replace(Regex("[^\\p{L}\\p{N}_\\- ]"), "").trim().take(45).ifEmpty { "dubbed_video" }
        val fileName = "${safeName}_fa.mp4"
        try {
            val req = DownloadManager.Request(Uri.parse(url))
                .setTitle("دانلود دوبله فارسی: $titleFa")
                .setDescription("در حال ذخیره در پوشه Movies/BaManDubber")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_MOVIES, "BaManDubber/$fileName")
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            dm.enqueue(req)
            Toast.makeText(this, "دانلود آغاز شد (پوشه Movies/BaManDubber) ✅", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Toast.makeText(this, "خطا در شروع دانلود: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun fmtTime(ms: Int): String {
        val totalSec = (ms / 1000).coerceAtLeast(0)
        val m = totalSec / 60
        val s = totalSec % 60
        return "%02d:%02d".format(m, s)
    }

    override fun onDestroy() {
        uiHandler.removeCallbacksAndMessages(null)
        bgExecutor.shutdownNow()
        super.onDestroy()
    }
}
