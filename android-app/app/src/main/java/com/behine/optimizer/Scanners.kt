package com.behine.optimizer

import android.content.Context
import android.os.Build
import android.os.Environment
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Real scanners for Behine (all work runs on the JS-bridge background thread).
 *
 *  - Junk:   cache dirs of installed apps, gallery thumbnails, stray .log
 *            files in Download, empty top-level folders. Scan reports sizes;
 *            clean only touches the exact paths that were reported.
 *  - Threat: SHA-256 of every installed APK, compared against a versioned
 *            JSON hash DB (bundled seed + OTA update from our own repo).
 *            Seed DB is INTENTIONALLY empty — the pipeline is real, the
 *            feed gets populated next (MalwareBazaar APK hash dump).
 */
object BehineScanners {

  private const val THREAT_DB_URL =
    "https://raw.githubusercontent.com/noob-coder-clude/ba-man-bebin/arena/019fb441-ba-man-bebin/prototype/threatdb/threatdb.json"
  private const val MAX_HASH_BYTES = 220L * 1024 * 1024
  private const val WALK_CAP = 250_000

  /* ===================== storage ===================== */

  fun isAllFilesGranted(): Boolean =
    if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager()
    else true // MANAGE_EXTERNAL_STORAGE not needed below Q (targetSdk<=28 only); here: require anyway

  private fun root(): File = Environment.getExternalStorageDirectory()

  private class Walker {
    var visited = 0
    var bytes = 0L
    fun sizeOf(f: File?): Long {
      if (f == null || !f.exists()) return 0L
      if (visited > WALK_CAP) return bytes
      if (f.isFile) { visited++; val l = f.length(); bytes += l; return l }
      val kids = f.listFiles() ?: return 0L
      var s = 0L
      for (k in kids) s += sizeOf(k)
      return s
    }
  }

  private fun installedPkgs(ctx: Context): Set<String> =
    try {
      @Suppress("DEPRECATION")
      ctx.packageManager.getInstalledPackages(0).map { it.packageName }.toSet()
    } catch (e: Throwable) { emptySet() }

  private fun cacheDirs(ctx: Context): List<File> {
    val data = File(root(), "Android/data")
    val out = ArrayList<File>()
    for (pkg in installedPkgs(ctx)) {
      for (n in arrayOf("cache", "code_cache")) {
        val d = File(File(data, pkg), n)
        if (d.isDirectory) out.add(d)
      }
    }
    return out
  }

  private fun thumbFiles(): List<File> {
    val d = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM), ".thumbnails")
    return if (d.isDirectory) (d.listFiles()?.filter { it.isFile } ?: emptyList()) else emptyList()
  }

  private fun logFiles(): List<File> {
    val d = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOAD)
    return if (d.isDirectory) (d.listFiles()?.filter { it.isFile && it.name.endsWith(".log", true) } ?: emptyList()) else emptyList()
  }

  private fun emptyDirs(): List<File> {
    val r = root()
    val out = ArrayList<File>()
    for (top in (r.listFiles() ?: return out)) {
      if (out.size > 400) break
      if (top.isDirectory && !top.isHidden && top.name !in listOf("Android", "DCIM", "Download",
          "Pictures", "Music", "Movies", "Documents", "Alarms", "Notifications", "Podcasts", "Ringtones")) {
        try { if ((top.listFiles()?.size ?: 1) == 0) out.add(top) } catch (e: Throwable) {}
      }
    }
    return out
  }

  fun scanJunk(ctx: Context): String {
    if (!isAllFilesGranted()) return JSONObject().put("perm", false).toString()
    val cats = JSONArray()
    fun cat(id: String, label: String, bytes: Long, count: Int, level: String) {
      if (count <= 0) return
      cats.put(JSONObject().put("id", id).put("label", label)
        .put("mb", (bytes / 10485.76).let { Math.round(it) / 100.0 })
        .put("count", count).put("level", level))
    }
    val caches = cacheDirs(ctx)
    var cacheTotal = 0L
    val w = Walker(); for (d in caches) cacheTotal += w.sizeOf(d)
    val thumbs = thumbFiles(); val thB = thumbs.fold(0L) { a, f -> a + f.length() }
    val logs = logFiles(); val lgB = logs.fold(0L) { a, f -> a + f.length() }
    val empt = emptyDirs()

    cat("cache", "کَش برنامه‌ها", cacheTotal, caches.size, "safe")
    cat("thumbnails", "بندانگشتی‌های گالری", thB, thumbs.size, "safe")
    cat("logs", "فایل‌های log سرگردان", lgB, logs.size, "review")
    cat("emptydirs", "پوشه‌های خالی", 0L, empt.size, "review")
    return JSONObject().put("perm", true).put("cats", cats).toString()
  }

  private fun rmContents(dir: File, onlyEmptySelf: Boolean): Long {
    var freed = 0L
    val kids = dir.listFiles() ?: return 0L
    for (k in kids) {
      try {
        freed += walkerDelete(k, onlyEmptySelf)
      } catch (e: Throwable) {}
    }
    return freed
  }

  private fun walkerDelete(f: File, onlyEmptySelf: Boolean): Long {
    if (f.isFile) {
      if (onlyEmptySelf) return 0L
      val l = f.length()
      return if (f.delete()) l else 0L
    }
    var freed = 0L
    val kids = f.listFiles()
    if (kids != null) for (k in kids) freed += walkerDelete(k, onlyEmptySelf)
    try { f.delete() } catch (e: Throwable) {} // removes dir when empty
    return freed
  }

  fun cleanJunk(ctx: Context, catsJson: String): String {
    if (!isAllFilesGranted()) return JSONObject().put("perm", false).toString()
    val want = HashSet<String>()
    try { val a = JSONArray(catsJson); for (i in 0 until a.length()) want.add(a.getString(i)) } catch (e: Throwable) {}
    var freed = 0L
    if (want.contains("cache")) for (d in cacheDirs(ctx)) freed += rmContents(d, false)
    if (want.contains("thumbnails")) for (f in thumbFiles()) { val l = f.length(); try { if (f.delete()) freed += l } catch (e: Throwable) {} }
    if (want.contains("logs")) for (f in logFiles()) { val l = f.length(); try { if (f.delete()) freed += l } catch (e: Throwable) {} }
    if (want.contains("emptydirs")) for (d in emptyDirs()) try { d.delete() } catch (e: Throwable) {}
    return JSONObject().put("perm", true)
      .put("freedMB", (freed / 10485.76).let { Math.round(it) / 100.0 }).toString()
  }

  /* ===================== threat scan ===================== */

  private fun sha256(f: File): String? {
    return try {
      val md = MessageDigest.getInstance("SHA-256")
      FileInputStream(f).use { s ->
        val buf = ByteArray(64 * 1024)
        while (true) { val r = s.read(buf); if (r <= 0) break; md.update(buf, 0, r) }
      }
      md.digest().joinToString("") { "%02x".format(it) }
    } catch (e: Throwable) { null }
  }

  private fun effectiveDbFile(ctx: Context): Pair<String, Boolean> {
    val ota = File(ctx.filesDir, "threatdb.json")
    if (ota.isFile && ota.length() > 2) return ota.readText() to true
    return try {
      ctx.assets.open("threatdb.json").bufferedReader().use { it.readText() } to false
    } catch (e: Throwable) { "{\"version\":0,\"hashes\":[]}" to false }
  }

  private class Db(val version: Int, val updated: String, val hashes: Set<String>, val names: Map<String, String>, val ota: Boolean)

  private fun loadDb(ctx: Context): Db {
    val (txt, ota) = effectiveDbFile(ctx)
    return try {
      val o = JSONObject(txt)
      val arr = o.optJSONArray("hashes")
      val hs = HashSet<String>(); if (arr != null) for (i in 0 until arr.length()) hs.add(arr.getString(i).lowercase())
      val nm = HashMap<String, String>()
      val names = o.optJSONObject("names")
      if (names != null) for (k in names.keys()) nm[k.lowercase()] = names.getString(k)
      Db(o.optInt("version", 0), o.optString("updated", ""), hs, nm, ota)
    } catch (e: Throwable) { Db(0, "", emptySet(), emptyMap(), ota) }
  }

  fun threatDbInfo(ctx: Context): String {
    val db = loadDb(ctx)
    return JSONObject().put("version", db.version).put("count", db.hashes.size)
      .put("updated", db.updated).put("ota", db.ota).toString()
  }

  fun updateThreatDb(ctx: Context): String {
    return try {
      val conn = (URL(THREAT_DB_URL).openConnection() as HttpURLConnection).apply {
        connectTimeout = 15000; readTimeout = 30000; instanceFollowRedirects = true
      }
      conn.connect()
      if (conn.responseCode != 200) return JSONObject().put("ok", false).put("err", "http:" + conn.responseCode).toString()
      val body = conn.inputStream.readBytes().toString(Charsets.UTF_8)
      val o = JSONObject(body)
      val newV = o.optInt("version", 0)
      val cur = loadDb(ctx)
      if (newV == 0) return JSONObject().put("ok", false).put("err", "bad-db").toString()
      if (newV <= cur.version) return JSONObject().put("ok", true).put("same", true).put("version", cur.version).put("count", cur.hashes.size).toString()
      val tmp = File(ctx.filesDir, "threatdb.json.tmp")
      tmp.writeText(body)
      val dst = File(ctx.filesDir, "threatdb.json")
      if (dst.exists() && !tmp.renameTo(dst)) { tmp.copyTo(dst, true); tmp.delete() } else if (!dst.exists()) tmp.renameTo(dst)
      JSONObject().put("ok", true).put("version", newV)
        .put("count", o.optJSONArray("hashes")?.length() ?: 0).toString()
    } catch (e: Throwable) {
      JSONObject().put("ok", false).put("err", (e.javaClass.simpleName + ":" + (e.message ?: "")).take(120)).toString()
    }
  }

  private val riskWeights = mapOf(
    "android.permission.REQUEST_INSTALL_PACKAGES" to 3,
    "android.permission.SYSTEM_ALERT_WINDOW" to 2,
    "android.permission.READ_SMS" to 2,
    "android.permission.RECEIVE_SMS" to 2,
    "android.permission.RECORD_AUDIO" to 1,
    "android.permission.WRITE_SETTINGS" to 1,
    "android.permission.READ_CALL_LOG" to 1
  )

  fun scanInstalledApps(ctx: Context): String {
    val started = System.currentTimeMillis()
    val db = loadDb(ctx)
    val pm = ctx.packageManager
    val threats = JSONArray()
    var scanned = 0; var skipped = 0; var med = 0
    @Suppress("DEPRECATION")
    val pkgs = try { pm.getInstalledPackages(0) } catch (e: Throwable) { emptyList() }
    for (pi in pkgs) {
      if (pi.packageName == ctx.packageName) continue
      val ai = pi.applicationInfo ?: continue
      val apk = try { File(ai.sourceDir) } catch (e: Throwable) { null }
      if (apk == null || !apk.isFile) { skipped++; continue }
      if (apk.length() > MAX_HASH_BYTES) { scanned++; skipped++; continue }
      val sha = sha256(apk) ?: run { skipped++; continue }
      scanned++
      if (db.hashes.contains(sha)) {
        val label = try { pm.getApplicationLabel(ai).toString() } catch (e: Throwable) { pi.packageName }
        threats.put(JSONObject().put("pkg", pi.packageName).put("label", label)
          .put("name", db.names[sha] ?: "Android.Malware.Gen")
          .put("sha", sha.take(16)))
      }
      if (med < 64) {
        @Suppress("DEPRECATION")
        val perms = try { pm.getPackageInfo(pi.packageName, android.content.pm.PackageManager.GET_PERMISSIONS).requestedPermissions } catch (e: Throwable) { null }
        var w = 0
        if (perms != null) for (p in perms) w += riskWeights[p] ?: 0
        if (w >= 5) med++
      }
    }
    return JSONObject().put("scanned", scanned).put("skipped", skipped)
      .put("watchlist", med).put("threats", threats)
      .put("dbVersion", db.version).put("dbCount", db.hashes.size)
      .put("elapsedMs", System.currentTimeMillis() - started).toString()
  }
}
