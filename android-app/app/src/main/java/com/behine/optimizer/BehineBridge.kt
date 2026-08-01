package com.behine.optimizer

import android.app.Activity
import android.app.ActivityManager
import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.BatteryManager
import android.provider.Settings
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentLinkedQueue

/** packages queued for accessibility force-stop */
object ForceQueue { val pending = ConcurrentLinkedQueue<String>() }
object AppHolder { var ctx: Context? = null }

class BehineBridge(act: Activity) {
  private val app = act.applicationContext
  init { AppHolder.ctx = app }

  /* ---------- device stats ---------- */
  @JavascriptInterface fun getBattery(): String {
    val i = app.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return "{}"
    val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
    val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
    val status = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
    val temp = i.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10f
    return JSONObject()
      .put("level", if (scale > 0) level * 100 / scale else -1)
      .put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL)
      .put("temp", temp.toDouble()).toString()
  }

  @JavascriptInterface fun getMemory(): String {
    val am = app.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val info = ActivityManager.MemoryInfo(); am.getMemoryInfo(info)
    return JSONObject().put("totalMB", info.totalMem / 1048576).put("availMB", info.availMem / 1048576).toString()
  }

  /* ---------- usage stats ---------- */
  @JavascriptInterface fun isUsageGranted(): Boolean {
    val ops = app.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    return try {
      ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), app.packageName) == AppOpsManager.MODE_ALLOWED
    } catch (e: Throwable) {
      @Suppress("DEPRECATION")
      ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), app.packageName) == AppOpsManager.MODE_ALLOWED
    }
  }

  @JavascriptInterface fun getTopApps(): String {
    if (!isUsageGranted()) return "[]"
    val usm = app.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val end = System.currentTimeMillis()
    val list = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, end - 86400000L, end)
      .filter { it.totalTimeInForeground > 0 && it.packageName != app.packageName }
      .sortedByDescending { it.totalTimeInForeground }.take(12)
    val pm = app.packageManager
    val arr = JSONArray()
    for (s in list) {
      val label = try { pm.getApplicationLabel(pm.getApplicationInfo(s.packageName, 0)).toString() }
                  catch (e: Exception) { s.packageName }
      arr.put(JSONObject().put("pkg", s.packageName).put("label", label).put("min", s.totalTimeInForeground / 60000))
    }
    return arr.toString()
  }

  /* ---------- permissions screens ---------- */
  @JavascriptInterface fun openUsageSettings() {
    app.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  @JavascriptInterface fun isAccEnabled(): Boolean {
    val flat = Settings.Secure.getString(app.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
    return flat.contains(app.packageName, ignoreCase = true)
  }

  @JavascriptInterface fun openAccSettings() {
    app.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  /* ---------- real junk & threat scanners ---------- */
  @JavascriptInterface fun isAllFilesGranted(): Boolean = BehineScanners.isAllFilesGranted()

  @JavascriptInterface fun openAllFilesSettings() {
    try {
      val i = if (android.os.Build.VERSION.SDK_INT >= 30)
        Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + app.packageName))
      else Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
      app.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: Throwable) {
      try { app.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e2: Throwable) {}
    }
  }

  @JavascriptInterface fun scanJunk(): String = BehineScanners.scanJunk(app)
  @JavascriptInterface fun cleanJunk(cats: String): String = BehineScanners.cleanJunk(app, cats)
  @JavascriptInterface fun scanInstalledApps(): String = BehineScanners.scanInstalledApps(app)
  @JavascriptInterface fun threatDbInfo(): String = BehineScanners.threatDbInfo(app)
  @JavascriptInterface fun updateThreatDb(): String = BehineScanners.updateThreatDb(app)

  @JavascriptInterface fun uninstallApp(pkg: String) {
    try { app.startActivity(Intent(Intent.ACTION_DELETE, Uri.parse("package:$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Throwable) {}
  }

  /* ---------- force close ---------- */
  @JavascriptInterface fun forceClose(pkgsJson: String): String {
    try {
      val a = JSONArray(pkgsJson)
      ForceQueue.pending.clear()
      for (i in 0 until a.length()) ForceQueue.pending.add(a.getString(i))
    } catch (e: Exception) { return "err" }
    openPkgDetails(ForceQueue.pending.peek())
    return "queue:" + ForceQueue.pending.size
  }

  companion object {
    private fun openIntent(pkg: String): Intent =
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    @JvmStatic fun openPkgDetails(pkg: String?) {
      val c = AppHolder.ctx ?: return; pkg ?: return
      try { c.startActivity(openIntent(pkg)) } catch (e: Exception) {}
    }
    @JvmStatic fun openNextFromQueue() = openPkgDetails(ForceQueue.pending.peek())
  }
}
