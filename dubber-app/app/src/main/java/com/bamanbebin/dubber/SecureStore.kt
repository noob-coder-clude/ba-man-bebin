package com.bamanbebin.dubber

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object AppDefaults {
    const val DEFAULT_REPO = "noob-coder-clude/ba-man-bebin"
    const val DEFAULT_BRANCH = "arena/2f2201f9-ba-man-bebin"
    const val WORKFLOW_FILENAME = "farsi-dubber.yml"
}

class SecureStore(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("dubber_secure_prefs", Context.MODE_PRIVATE)

    companion object {
        private const val KEY_ALIAS = "BaManDubberMasterKey_v1"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    }

    private fun getOrCreateKey(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
        if (existing != null) return existing.secretKey

        val keyGen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        keyGen.init(spec)
        return keyGen.generateKey()
    }

    private fun putEncrypted(prefKey: String, value: String) {
        if (value.isEmpty()) {
            prefs.edit().remove(prefKey).apply()
            return
        }
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
            val iv = cipher.iv
            val enc = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            val combined = ByteArray(1 + iv.size + enc.size)
            combined[0] = iv.size.toByte()
            System.arraycopy(iv, 0, combined, 1, iv.size)
            System.arraycopy(enc, 0, combined, 1 + iv.size, enc.size)
            prefs.edit()
                .putString(prefKey, Base64.encodeToString(combined, Base64.NO_WRAP))
                .apply()
        } catch (_: Exception) {
            // Fallback on unusual custom ROMs without hardware keystore
            prefs.edit()
                .putString(prefKey, "PLAIN:" + Base64.encodeToString(value.toByteArray(Charsets.UTF_8), Base64.NO_WRAP))
                .apply()
        }
    }

    private fun getDecrypted(prefKey: String): String {
        val raw = prefs.getString(prefKey, null) ?: return ""
        if (raw.startsWith("PLAIN:")) {
            return try {
                String(Base64.decode(raw.removePrefix("PLAIN:"), Base64.NO_WRAP), Charsets.UTF_8)
            } catch (_: Exception) {
                ""
            }
        }
        return try {
            val combined = Base64.decode(raw, Base64.NO_WRAP)
            val ivLen = combined[0].toInt() and 0xff
            val iv = combined.copyOfRange(1, 1 + ivLen)
            val enc = combined.copyOfRange(1 + ivLen, combined.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(enc), Charsets.UTF_8)
        } catch (_: Exception) {
            ""
        }
    }

    var geminiApiKey: String
        get() = getDecrypted("sec_gemini_key").trim()
        set(v) = putEncrypted("sec_gemini_key", v.trim())

    var youtubeCookies: String
        get() = getDecrypted("sec_yt_cookies")
        set(v) = putEncrypted("sec_yt_cookies", v)

    var githubToken: String
        get() = getDecrypted("sec_gh_token").trim()
        set(v) = putEncrypted("sec_gh_token", v.trim())

    var githubRepo: String
        get() = prefs.getString("gh_repo", AppDefaults.DEFAULT_REPO)?.trim()
            ?.takeIf { it.isNotEmpty() } ?: AppDefaults.DEFAULT_REPO
        set(v) = prefs.edit().putString("gh_repo", v.trim()).apply()

    var githubBranch: String
        get() = prefs.getString("gh_branch", AppDefaults.DEFAULT_BRANCH)?.trim()
            ?.takeIf { it.isNotEmpty() } ?: AppDefaults.DEFAULT_BRANCH
        set(v) = prefs.edit().putString("gh_branch", v.trim()).apply()

    var activeRunId: Long
        get() = prefs.getLong("active_run_id", 0L)
        set(v) = prefs.edit().putLong("active_run_id", v).apply()

    var activeJobId: String
        get() = prefs.getString("active_job_id", "") ?: ""
        set(v) = prefs.edit().putString("active_job_id", v).apply()

    var secretsSyncedHash: String
        get() = prefs.getString("secrets_synced_hash", "") ?: ""
        set(v) = prefs.edit().putString("secrets_synced_hash", v).apply()

    var preferredVoiceIdx: Int
        get() = prefs.getInt("pref_voice_idx", 0)
        set(v) = prefs.edit().putInt("pref_voice_idx", v).apply()

    var preferredQualityIdx: Int
        get() = prefs.getInt("pref_quality_idx", 2) // Default index 2 = 720p HD
        set(v) = prefs.edit().putInt("pref_quality_idx", v).apply()

    var preferredStyleIdx: Int
        get() = prefs.getInt("pref_style_idx", 0)
        set(v) = prefs.edit().putInt("pref_style_idx", v).apply()

    var keepBgAudio: Boolean
        get() = prefs.getBoolean("pref_keep_bg", false) // Default false = 100% replace original audio
        set(v) = prefs.edit().putBoolean("pref_keep_bg", v).apply()

    var burnSubtitles: Boolean
        get() = prefs.getBoolean("pref_burn_subs", false)
        set(v) = prefs.edit().putBoolean("pref_burn_subs", v).apply()

    fun computeCurrentSecretsHash(): String {
        val raw = "$githubRepo|$geminiApiKey|${youtubeCookies.trim()}"
        val digest = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }
}
