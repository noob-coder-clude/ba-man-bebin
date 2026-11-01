package com.bamanbebin.dubber

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

data class CookieSummary(
    val isValid: Boolean,
    val count: Int,
    val hasAuthTokens: Boolean,
    val formatLabel: String,
    val statusText: String
)

object CookieUtils {

    private val AUTH_NAMES = setOf(
        "SID", "HSID", "SSID", "APISID", "SAPISID",
        "__Secure-1PSID", "__Secure-3PSID",
        "__Secure-1PSIDTS", "__Secure-3PSIDTS",
        "LOGIN_INFO"
    )

    private val ALLOWED_DOMAINS = listOf(
        "youtube.com", "youtu.be", "google.com", "googlevideo.com", "googleapis.com"
    )

    private fun isRelevantDomain(domain: String): Boolean {
        val d = domain.trim().trimStart('.').lowercase()
        return ALLOWED_DOMAINS.any { d == it || d.endsWith(".$it") }
    }

    fun inspectCookies(rawText: String): CookieSummary {
        val trimmed = rawText.trim()
        if (trimmed.isEmpty()) {
            return CookieSummary(
                isValid = false,
                count = 0,
                hasAuthTokens = false,
                formatLabel = "خالی",
                statusText = "⚪ کوکی یوتیوب هنوز وارد نشده است"
            )
        }

        val normalized = normalizeToNetscape(trimmed)
        val lines = normalized.lines().filter {
            val l = it.trim()
            l.isNotEmpty() && (!l.startsWith("#") || l.startsWith("#HttpOnly_"))
        }

        if (lines.isEmpty()) {
            return CookieSummary(
                isValid = false,
                count = 0,
                hasAuthTokens = false,
                formatLabel = "نامعتبر",
                statusText = "⚠️ فرمت کوکی قابل تشخیص نیست (فایل Netscape، JSON یا رشته Cookie وارد کنید)"
            )
        }

        val foundAuth = mutableSetOf<String>()
        for (line in lines) {
            val clean = line.removePrefix("#HttpOnly_")
            val cols = clean.split('\t')
            if (cols.size >= 7 && cols[5] in AUTH_NAMES && cols[6].isNotBlank()) {
                foundAuth.add(cols[5])
            }
        }

        val fmt = when {
            trimmed.startsWith("[") || trimmed.startsWith("{") -> "JSON"
            trimmed.contains('\t') || trimmed.contains("# Netscape") -> "Netscape"
            else -> "Header"
        }

        return if (foundAuth.isNotEmpty()) {
            CookieSummary(
                isValid = true,
                count = lines.size,
                hasAuthTokens = true,
                formatLabel = fmt,
                statusText = "✅ کوکی معتبر یوتیوب (${lines.size} ردیف، شامل توکن لاگین اکانت)"
            )
        } else {
            CookieSummary(
                isValid = true,
                count = lines.size,
                hasAuthTokens = false,
                formatLabel = fmt,
                statusText = "⚠️ ${lines.size} کوکی خوانده شد ولی کوکی لاگین (SID/LOGIN_INFO) دیده نشد؛ ممکن است ویدیوهای محدود باز نشوند"
            )
        }
    }

    /**
     * Convert Netscape, JSON Cookie-Editor, or raw Cookie header into clean
     * YouTube/Google-scoped Netscape cookies.txt text.
     */
    fun normalizeToNetscape(rawText: String): String {
        val text = rawText.trim()
        if (text.isEmpty()) return ""

        val outRows = LinkedHashMap<String, String>()
        val defaultExpiry = (System.currentTimeMillis() / 1000L) + 365L * 86400L

        fun addRow(domainIn: String, pathIn: String, secure: Boolean, expiryIn: Long, nameIn: String, valIn: String, httpOnly: Boolean) {
            var dom = domainIn.trim()
            val name = nameIn.trim()
            val value = valIn.trim().replace("\t", "").replace("\r", "").replace("\n", "")
            if (dom.isEmpty() || name.isEmpty() || !isRelevantDomain(dom)) return
            if (!dom.startsWith(".") && dom.contains(".")) dom = ".$dom"
            val sub = if (dom.startsWith(".")) "TRUE" else "FALSE"
            val path = if (pathIn.trim().startsWith("/")) pathIn.trim() else "/"
            val sec = if (secure || name.startsWith("__Secure-") || name.startsWith("__Host-")) "TRUE" else "FALSE"
            val exp = if (expiryIn > 0L) expiryIn else defaultExpiry
            val prefix = if (httpOnly) "#HttpOnly_" else ""
            outRows["$dom|$path|$name"] = "$prefix$dom\t$sub\t$path\t$sec\t$exp\t$name\t$value"
        }

        if (text.startsWith("[") || text.startsWith("{")) {
            try {
                val arr: JSONArray = if (text.startsWith("{")) {
                    JSONObject(text).optJSONArray("cookies") ?: JSONArray()
                } else {
                    JSONArray(text)
                }
                for (i in 0 until arr.length()) {
                    val obj = arr.optJSONObject(i) ?: continue
                    val exp = obj.optDouble("expirationDate", obj.optDouble("expiry", 0.0)).toLong()
                    addRow(
                        domainIn = obj.optString("domain", ".youtube.com"),
                        pathIn = obj.optString("path", "/"),
                        secure = obj.optBoolean("secure", true),
                        expiryIn = exp,
                        nameIn = obj.optString("name", ""),
                        valIn = obj.optString("value", ""),
                        httpOnly = obj.optBoolean("httpOnly", false)
                    )
                }
            } catch (_: Exception) {
            }
        }

        if (outRows.isEmpty() && (text.contains('\t') || text.contains("# Netscape") || text.contains("#HttpOnly_"))) {
            for (rawLine in text.lines()) {
                var line = rawLine.trim()
                if (line.isEmpty()) continue
                var httpOnly = false
                if (line.startsWith("#HttpOnly_")) {
                    httpOnly = true
                    line = line.removePrefix("#HttpOnly_")
                } else if (line.startsWith("#")) {
                    continue
                }
                var parts = line.split('\t')
                if (parts.size < 6) parts = line.split(Regex("\\s+"))
                if (parts.size == 6) parts = parts + ""
                if (parts.size < 7) continue
                val exp = parts[4].toDoubleOrNull()?.toLong() ?: 0L
                addRow(
                    domainIn = parts[0],
                    pathIn = parts[2],
                    secure = parts[3].equals("TRUE", ignoreCase = true),
                    expiryIn = exp,
                    nameIn = parts[5],
                    valIn = parts.subList(6, parts.size).joinToString("\t"),
                    httpOnly = httpOnly
                )
            }
        }

        if (outRows.isEmpty() && text.contains("=")) {
            val body = if (text.lowercase().startsWith("cookie:")) text.substring(7).trim() else text
            for (pair in body.replace("\n", ";").split(";")) {
                val idx = pair.indexOf('=')
                if (idx <= 0) continue
                val k = pair.substring(0, idx).trim()
                val v = pair.substring(idx + 1).trim()
                if (k.isNotEmpty()) {
                    addRow(".youtube.com", "/", true, defaultExpiry, k, v, false)
                }
            }
        }

        if (outRows.isEmpty()) return ""
        return buildString {
            append("# Netscape HTTP Cookie File\n")
            for (row in outRows.values) {
                append(row).append('\n')
            }
        }
    }

    /**
     * Build Netscape cookies.txt from Android WebView CookieManager header strings.
     */
    fun fromWebViewDomainHeaders(domainHeaders: Map<String, String?>): String {
        val exp = (System.currentTimeMillis() / 1000L) + 365L * 86400L
        val rows = LinkedHashMap<String, String>()
        for ((domain, cookieHeader) in domainHeaders) {
            if (cookieHeader.isNullOrBlank()) continue
            val dom = if (domain.startsWith(".")) domain else ".$domain"
            for (part in cookieHeader.split(";")) {
                val eq = part.indexOf('=')
                if (eq <= 0) continue
                val name = part.substring(0, eq).trim()
                val value = part.substring(eq + 1).trim()
                if (name.isEmpty()) continue
                rows["$dom|$name"] = "$dom\tTRUE\t/\tTRUE\t$exp\t$name\t$value"
            }
        }
        if (rows.isEmpty()) return ""
        return "# Netscape HTTP Cookie File\n" + rows.values.joinToString("\n") + "\n"
    }

    fun toGzipBase64(rawCookies: String): String {
        val clean = normalizeToNetscape(rawCookies)
        if (clean.isEmpty()) return ""
        val bos = ByteArrayOutputStream()
        GZIPOutputStream(bos).use { gz ->
            gz.write(clean.toByteArray(Charsets.UTF_8))
        }
        return Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
    }
}
