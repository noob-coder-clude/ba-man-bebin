package com.behine.optimizer

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {
  private lateinit var web: WebView
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    web = WebView(this)
    web.setBackgroundColor(Color.BLACK)
    web.settings.javaScriptEnabled = true
    web.settings.domStorageEnabled = true
    web.settings.allowFileAccess = true
    web.addJavascriptInterface(BehineBridge(this), "BehineNative")
    web.webViewClient = WebViewClient()
    setContentView(web)
    web.loadUrl("file:///android_asset/www/index.html")
  }
  @Deprecated("Deprecated in Java")
  override fun onBackPressed() {
    if (this::web.isInitialized && web.canGoBack()) web.goBack() else super.onBackPressed()
  }
}
