package com.bamanbebin.dubber

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.Toast

/**
 * Built-in YouTube Login WebView that lets the user sign in directly on their
 * phone and extract all YouTube/Google cookies (including HttpOnly auth tokens)
 * into Netscape cookies.txt format with a single tap.
 */
class CookieCaptureActivity : Activity() {

    companion object {
        const val EXTRA_COOKIES_RESULT = "cookies_netscape_result"
        private const val LOGIN_URL =
            "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fm.youtube.com"
    }

    private var webView: WebView? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setBackgroundColor(UiKit.BG_DARK)
        }

        // Top action bar
        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(UiKit.CARD_BG)
            val pad = UiKit.dp(this@CookieCaptureActivity, 10)
            setPadding(pad, pad, pad, pad)
        }

        val closeBtn = UiKit.makeSecondaryButton(this, "انصراف").apply {
            setOnClickListener {
                setResult(RESULT_CANCELED)
                finish()
            }
        }

        val titleTv = UiKit.makeTitle(this, "ورود به یوتیوب و دریافت کوکی", 15f).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = UiKit.dp(this@CookieCaptureActivity, 10)
                marginEnd = UiKit.dp(this@CookieCaptureActivity, 10)
            }
        }

        val saveBtn = UiKit.makePrimaryButton(this, "ذخیره کوکی ✅", UiKit.ACCENT_EMERALD).apply {
            setOnClickListener { captureAndReturnCookies() }
        }

        topBar.addView(closeBtn)
        topBar.addView(titleTv)
        topBar.addView(saveBtn)
        root.addView(topBar)

        val hintBar = UiKit.makeBody(
            this,
            "وارد اکانت گوگل/یوتیوب خود شوید؛ به محض باز شدن صفحه یوتیوب، دکمه سبز «ذخیره کوکی ✅» در بالا را بزنید.",
            12.5f
        ).apply {
            setBackgroundColor(UiKit.CARD_ALT)
            val p = UiKit.dp(this@CookieCaptureActivity, 10)
            setPadding(p, p / 2, p, p / 2)
        }
        root.addView(hintBar)

        val progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                UiKit.dp(this@CookieCaptureActivity, 3)
            )
        }
        root.addView(progress)

        val wv = WebView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            webChromeClient = object : WebChromeClient() {
                override fun onProgressChanged(view: WebView?, newProgress: Int) {
                    progress.progress = newProgress
                    progress.visibility = if (newProgress >= 100) View.GONE else View.VISIBLE
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    return false
                }
            }
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)
        wv.loadUrl(LOGIN_URL)
        webView = wv
        root.addView(wv)

        setContentView(root)
    }

    private fun captureAndReturnCookies() {
        val cm = CookieManager.getInstance()
        cm.flush()

        val domainMap = linkedMapOf(
            ".youtube.com" to cm.getCookie("https://www.youtube.com"),
            ".m.youtube.com" to cm.getCookie("https://m.youtube.com"),
            ".google.com" to cm.getCookie("https://www.google.com"),
            ".accounts.google.com" to cm.getCookie("https://accounts.google.com")
        )
        // Re-map subdomains onto canonical parent domains for yt-dlp
        val mergedHeaders = linkedMapOf(
            ".youtube.com" to listOfNotNull(
                domainMap[".youtube.com"],
                domainMap[".m.youtube.com"]
            ).joinToString("; "),
            ".google.com" to listOfNotNull(
                domainMap[".google.com"],
                domainMap[".accounts.google.com"]
            ).joinToString("; ")
        )

        val netscape = CookieUtils.fromWebViewDomainHeaders(mergedHeaders)
        val summary = CookieUtils.inspectCookies(netscape)
        if (!summary.isValid) {
            Toast.makeText(this, "هنوز کوکی‌ای ثبت نشده؛ ابتدا وارد اکانت شوید.", Toast.LENGTH_LONG).show()
            return
        }

        val data = Intent().putExtra(EXTRA_COOKIES_RESULT, netscape)
        setResult(RESULT_OK, data)
        finish()
    }

    override fun onDestroy() {
        webView?.destroy()
        webView = null
        super.onDestroy()
    }
}
