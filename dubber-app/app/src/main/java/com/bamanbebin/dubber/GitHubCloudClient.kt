package com.bamanbebin.dubber

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class StepProgress(
    val name: String,
    val status: String,     // queued | in_progress | completed
    val conclusion: String  // success | failure | skipped | ""
)

data class RunPollResult(
    val runId: Long,
    val status: String,     // queued | in_progress | completed
    val conclusion: String, // success | failure | cancelled | ""
    val htmlUrl: String,
    val steps: List<StepProgress>,
    val errorDetail: String
)

data class DubReleaseItem(
    val releaseId: Long,
    val tagName: String,
    val jobId: String,
    val titleFa: String,
    val titleOrig: String,
    val summaryFa: String,
    val durationSec: Double,
    val fileSizeMb: Double,
    val voice: String,
    val ttsModel: String,
    val youtubeUrl: String,
    val createdAt: String,
    val mp4BrowserUrl: String,
    val mp4ApiAssetUrl: String,
    val srtBrowserUrl: String,
    val srtApiAssetUrl: String
)

data class RepoSetupStatus(
    val ok: Boolean,
    val defaultBranch: String,
    val workflowPresent: Boolean,
    val secretsUploaded: Boolean,
    val message: String
)

class GitHubCloudClient(private val store: SecureStore) {

    companion object {
        private const val API_BASE = "https://api.github.com"

        // Minimal workflow template if user connects a fresh repository and auto-installs via PAT
        val EMBEDDED_WORKFLOW_YAML = """
name: farsi-dubber

on:
  push:
    branches: ['arena/**', 'main']
    paths:
      - 'dubber-app/**'
      - 'dubber-ci/**'
      - 'dubber-jobs/current-job.json'
      - '.github/workflows/farsi-dubber.yml'
  workflow_dispatch:
    inputs:
      job_id:
        description: 'Unique Dub Job ID'
        required: true
        type: string
      youtube_url:
        description: 'YouTube Video URL'
        required: true
        type: string
      voice_name:
        description: 'Gemini Voice Name'
        required: false
        default: 'auto'
        type: string
      video_quality:
        description: 'Max Video Height'
        required: false
        default: '720'
        type: string
      style_mode:
        description: 'Translation Tone'
        required: false
        default: 'conversational'
        type: string
      bg_volume:
        description: 'Background Volume Percent'
        required: false
        default: '0'
        type: string
      burn_subs:
        description: 'Burn Subtitles'
        required: false
        default: 'false'
        type: string

permissions:
  contents: write

jobs:
  build-apk:
    if: >-
      github.event_name == 'push' &&
      !contains(github.event.head_commit.message, '[dub-job]')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - uses: android-actions/setup-android@v3
      - uses: gradle/actions/setup-gradle@v4
        with:
          gradle-version: '8.10.2'
      - name: Build & verify signed APK
        env:
          CI_VERSION_CODE: ${'$'}{{ github.run_number }}
          GH_TOKEN: ${'$'}{{ secrets.GITHUB_TOKEN }}
        run: bash dubber-ci/build-apk.sh
      - uses: actions/upload-artifact@v4
        if: success()
        with:
          name: baman-dubber-apk
          path: dubber-app/app/build/outputs/apk/release/baman-dubber.apk
          retention-days: 30

  dub-video:
    if: github.event_name == 'workflow_dispatch' || contains(github.event.head_commit.message, '[dub-job]')
    runs-on: ubuntu-latest
    timeout-minutes: 90
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      - name: Run Cloud Persian Dubbing Pipeline
        env:
          GH_TOKEN: ${'$'}{{ secrets.GITHUB_TOKEN }}
          GEMINI_API_KEY: ${'$'}{{ secrets.GEMINI_API_KEY }}
          YT_COOKIES_GZ_B64: ${'$'}{{ secrets.YT_COOKIES_GZ_B64 }}
          DUB_JOB_ID: ${'$'}{{ inputs.job_id }}
          DUB_YOUTUBE_URL: ${'$'}{{ inputs.youtube_url }}
          DUB_VOICE_NAME: ${'$'}{{ inputs.voice_name }}
          DUB_VIDEO_QUALITY: ${'$'}{{ inputs.video_quality }}
          DUB_STYLE_MODE: ${'$'}{{ inputs.style_mode }}
          DUB_BG_VOLUME: ${'$'}{{ inputs.bg_volume }}
          DUB_BURN_SUBS: ${'$'}{{ inputs.burn_subs }}
        run: bash dubber-ci/run-dub.sh
""".trimIndent() + "\n"
    }

    private data class HttpResp(val code: Int, val body: String, val location: String?)

    private fun request(
        method: String,
        pathOrUrl: String,
        jsonBody: JSONObject? = null,
        accept: String = "application/vnd.github+json",
        followRedirects: Boolean = true
    ): HttpResp {
        val token = store.githubToken
        if (token.isEmpty()) {
            throw IllegalStateException("توکن گیت‌هاب (PAT) هنوز در تب تنظیمات وارد نشده است.")
        }
        val fullUrl = if (pathOrUrl.startsWith("http")) pathOrUrl else "$API_BASE$pathOrUrl"
        val conn = (URL(fullUrl).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            instanceFollowRedirects = followRedirects
            connectTimeout = 20_000
            readTimeout = 30_000
            setRequestProperty("Accept", accept)
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
            setRequestProperty("User-Agent", "BaManDubber-Android/1.0")
        }

        if (jsonBody != null) {
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            val bytes = jsonBody.toString().toByteArray(Charsets.UTF_8)
            conn.outputStream.use { it.write(bytes) }
        }

        val code = conn.responseCode
        val loc = conn.getHeaderField("Location")
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val text = if (stream != null) {
            BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
        } else {
            ""
        }
        conn.disconnect()
        return HttpResp(code, text, loc)
    }

    private fun cleanRepo(): String {
        var r = store.githubRepo.trim()
        r = r.removePrefix("https://github.com/").removePrefix("http://github.com/").trim('/')
        if (r.endsWith(".git")) r = r.removeSuffix(".git")
        if (!r.contains('/')) {
            throw IllegalArgumentException("نام ریپو باید به فرم username/repo باشد (مثلاً ${AppDefaults.DEFAULT_REPO}).")
        }
        return r
    }

    fun uploadSecretEncrypted(repo: String, secretName: String, plainValue: String) {
        if (plainValue.isEmpty()) return
        val pkResp = request("GET", "/repos/$repo/actions/secrets/public-key")
        if (pkResp.code !in 200..299) {
            throw RuntimeException(
                "خطا در دریافت کلید عمومی Secrets گیت‌هاب (کد ${pkResp.code}). " +
                    "مطمئن شوید توکن شما دسترسی repo / Secrets دارد."
            )
        }
        val pkJson = JSONObject(pkResp.body)
        val keyId = pkJson.getString("key_id")
        val pubKeyBytes = Base64.decode(pkJson.getString("key"), Base64.DEFAULT)

        val sealed = LibsodiumSealedBox.seal(plainValue.toByteArray(Charsets.UTF_8), pubKeyBytes)
        val encB64 = Base64.encodeToString(sealed, Base64.NO_WRAP)

        val putBody = JSONObject().apply {
            put("encrypted_value", encB64)
            put("key_id", keyId)
        }
        val putResp = request("PUT", "/repos/$repo/actions/secrets/$secretName", putBody)
        if (putResp.code !in 200..299) {
            throw RuntimeException("خطا در ذخیره سکرت $secretName روی گیت‌هاب (کد ${putResp.code}): ${putResp.body}")
        }
    }

    fun syncSecretsIfNeeded(force: Boolean = false) {
        val repo = cleanRepo()
        val geminiKey = store.geminiApiKey
        if (geminiKey.isEmpty()) {
            throw IllegalStateException("لطفاً ابتدا کلید Gemini API را در تب تنظیمات وارد کنید.")
        }
        val curHash = store.computeCurrentSecretsHash()
        if (!force && store.secretsSyncedHash == curHash) {
            return
        }

        uploadSecretEncrypted(repo, "GEMINI_API_KEY", geminiKey)
        val cookiesGzB64 = CookieUtils.toGzipBase64(store.youtubeCookies)
        if (cookiesGzB64.isNotEmpty()) {
            uploadSecretEncrypted(repo, "YT_COOKIES_GZ_B64", cookiesGzB64)
        }
        store.secretsSyncedHash = curHash
    }

    fun verifyAndSetupRepo(): RepoSetupStatus {
        val repo = cleanRepo()
        val branch = store.githubBranch

        val repoResp = request("GET", "/repos/$repo")
        if (repoResp.code !in 200..299) {
            return RepoSetupStatus(
                ok = false,
                defaultBranch = "main",
                workflowPresent = false,
                secretsUploaded = false,
                message = "❌ عدم دسترسی به ریپو $repo (کد ${repoResp.code}). توکن گیت‌هاب یا نام ریپو را بررسی کنید."
            )
        }
        val repoJson = JSONObject(repoResp.body)
        val defaultBranch = repoJson.optString("default_branch", "main")

        // Upload encrypted secrets
        syncSecretsIfNeeded(force = true)

        // Check whether .github/workflows/farsi-dubber.yml exists on selected branch
        val encRef = URLEncoder.encode(branch, "UTF-8")
        val wfPath = ".github/workflows/${AppDefaults.WORKFLOW_FILENAME}"
        val wfCheck = request("GET", "/repos/$repo/contents/$wfPath?ref=$encRef")
        var wfPresent = wfCheck.code in 200..299

        if (!wfPresent) {
            // Attempt automatic 1-click workflow installation if PAT has `workflow` scope
            val putWf = JSONObject().apply {
                put("message", "ci: install Cloud Persian Dubber workflow")
                put("content", Base64.encodeToString(EMBEDDED_WORKFLOW_YAML.toByteArray(Charsets.UTF_8), Base64.NO_WRAP))
                put("branch", branch)
            }
            val createResp = request("PUT", "/repos/$repo/contents/$wfPath", putWf)
            wfPresent = createResp.code in 200..299
        }

        val msg = if (wfPresent) {
            "✅ اتصال به سرور گیت‌هاب برقرار شد، کلید Gemini و کوکی به‌صورت رمزنگاری‌شده در Secrets ذخیره شدند و سرور آماده دوبله است!"
        } else {
            "⚠️ کلیدها رمزنگاری و ذخیره شدند، اما فایل ورک‌فلو (.github/workflows/${AppDefaults.WORKFLOW_FILENAME}) هنوز روی برنچ $branch نیست (توکن دسترسی workflow نداشت). یک‌بار فایل ورک‌فلو را در گیت‌هاب اضافه کنید."
        }

        return RepoSetupStatus(
            ok = wfPresent,
            defaultBranch = defaultBranch,
            workflowPresent = wfPresent,
            secretsUploaded = true,
            message = msg
        )
    }

    fun startDubJob(
        youtubeUrl: String,
        voiceName: String,
        videoQuality: String,
        styleMode: String,
        bgVolumePct: Int,
        burnSubtitles: Boolean
    ): Pair<String, Long> {
        val repo = cleanRepo()
        val branch = store.githubBranch
        syncSecretsIfNeeded(force = false)

        val jobId = "${System.currentTimeMillis() / 1000L}-${(1000..9999).random()}"
        val triggerTimeMs = System.currentTimeMillis() - 5000L

        // Attempt 1: Clean workflow_dispatch (works when workflow is registered on default branch)
        val dispatchBody = JSONObject().apply {
            put("ref", branch)
            put(
                "inputs",
                JSONObject().apply {
                    put("job_id", jobId)
                    put("youtube_url", youtubeUrl)
                    put("voice_name", voiceName)
                    put("video_quality", videoQuality)
                    put("style_mode", styleMode)
                    put("bg_volume", bgVolumePct.toString())
                    put("burn_subs", burnSubtitles.toString())
                }
            )
        }
        val dispResp = request(
            "POST",
            "/repos/$repo/actions/workflows/${AppDefaults.WORKFLOW_FILENAME}/dispatches",
            dispatchBody
        )

        if (dispResp.code !in 200..299) {
            // Attempt 2: Push dubber-jobs/current-job.json on `branch` (works on ANY branch even before merging to main!)
            val jobJson = JSONObject().apply {
                put("job_id", jobId)
                put("youtube_url", youtubeUrl)
                put("voice_name", voiceName)
                put("video_quality", videoQuality)
                put("style_mode", styleMode)
                put("bg_volume", bgVolumePct)
                put("burn_subs", burnSubtitles)
                put("requested_at", System.currentTimeMillis())
            }
            val jobFilePath = "dubber-jobs/current-job.json"
            val encRef = URLEncoder.encode(branch, "UTF-8")
            val existing = request("GET", "/repos/$repo/contents/$jobFilePath?ref=$encRef")
            val existingSha = if (existing.code in 200..299) {
                JSONObject(existing.body).optString("sha", "")
            } else {
                ""
            }

            val putBody = JSONObject().apply {
                put("message", "chore: start dub job $jobId [dub-job]")
                put(
                    "content",
                    Base64.encodeToString(jobJson.toString(2).toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
                )
                put("branch", branch)
                if (existingSha.isNotEmpty()) put("sha", existingSha)
            }
            val pushResp = request("PUT", "/repos/$repo/contents/$jobFilePath", putBody)
            if (pushResp.code !in 200..299) {
                throw RuntimeException(
                    "خطا در ارسال درخواست به سرور گیت‌هاب (کد ${pushResp.code}). " +
                        "از تب تنظیمات دکمه «بررسی و همگام‌سازی سرور» را بزنید."
                )
            }
        }

        // Wait briefly and locate the newly triggered GitHub Actions run ID
        var foundRunId = 0L
        val encBranch = URLEncoder.encode(branch, "UTF-8")
        for (attempt in 1..8) {
            Thread.sleep(2200L)
            val runsResp = request("GET", "/repos/$repo/actions/runs?branch=$encBranch&per_page=8")
            if (runsResp.code in 200..299) {
                val runs = JSONObject(runsResp.body).optJSONArray("workflow_runs") ?: JSONArray()
                for (i in 0 until runs.length()) {
                    val run = runs.getJSONObject(i)
                    val path = run.optString("path", "")
                    val createdAt = run.optString("created_at", "")
                    val createdMs = parseIsoMillis(createdAt)
                    if (path.endsWith(AppDefaults.WORKFLOW_FILENAME) && createdMs >= triggerTimeMs - 15_000L) {
                        foundRunId = run.getLong("id")
                        break
                    }
                }
            }
            if (foundRunId > 0L) break
        }

        store.activeJobId = jobId
        store.activeRunId = foundRunId
        return Pair(jobId, foundRunId)
    }

    fun pollRunStatus(runId: Long): RunPollResult {
        val repo = cleanRepo()
        val runResp = request("GET", "/repos/$repo/actions/runs/$runId")
        if (runResp.code !in 200..299) {
            throw RuntimeException("خطا در خواندن وضعیت سرور گیت‌هاب (کد ${runResp.code})")
        }
        val runJson = JSONObject(runResp.body)
        val status = runJson.optString("status", "queued")
        val conclusion = runJson.optString("conclusion", "")
        val htmlUrl = runJson.optString("html_url", "https://github.com/$repo/actions")

        val stepsOut = mutableListOf<StepProgress>()
        var checkRunId = 0L

        val jobsResp = request("GET", "/repos/$repo/actions/runs/$runId/jobs")
        if (jobsResp.code in 200..299) {
            val jobs = JSONObject(jobsResp.body).optJSONArray("jobs") ?: JSONArray()
            for (j in 0 until jobs.length()) {
                val job = jobs.getJSONObject(j)
                if (job.optString("conclusion") == "skipped") continue
                checkRunId = job.optLong("id", 0L)
                val steps = job.optJSONArray("steps") ?: JSONArray()
                for (s in 0 until steps.length()) {
                    val st = steps.getJSONObject(s)
                    val sName = st.optString("name", "")
                    if (sName.startsWith("Set up job") || sName.startsWith("Complete job") || sName.startsWith("Post ")) {
                        continue
                    }
                    stepsOut.add(
                        StepProgress(
                            name = sName,
                            status = st.optString("status", ""),
                            conclusion = st.optString("conclusion", "")
                        )
                    )
                }
                break
            }
        }

        var errDetail = ""
        if (conclusion == "failure" && checkRunId > 0L) {
            val annResp = request("GET", "/repos/$repo/check-runs/$checkRunId/annotations")
            if (annResp.code in 200..299) {
                val arr = JSONArray(annResp.body)
                for (i in 0 until arr.length()) {
                    val a = arr.getJSONObject(i)
                    val title = a.optString("title", "")
                    val msg = a.optString("message", "")
                    if (title.contains("DUBBER_ERROR") || msg.isNotBlank()) {
                        errDetail = msg
                        if (title.contains("DUBBER_ERROR")) break
                    }
                }
            }
        }

        return RunPollResult(
            runId = runId,
            status = status,
            conclusion = conclusion,
            htmlUrl = htmlUrl,
            steps = stepsOut,
            errorDetail = errDetail
        )
    }

    fun cancelRun(runId: Long) {
        val repo = cleanRepo()
        request("POST", "/repos/$repo/actions/runs/$runId/cancel")
    }

    fun fetchDubbedLibrary(): List<DubReleaseItem> {
        val repo = cleanRepo()
        val resp = request("GET", "/repos/$repo/releases?per_page=30")
        if (resp.code !in 200..299) {
            throw RuntimeException("خطا در دریافت لیست ویدیوها از گیت‌هاب (کد ${resp.code})")
        }
        val arr = JSONArray(resp.body)
        val items = mutableListOf<DubReleaseItem>()

        for (i in 0 until arr.length()) {
            val rel = arr.getJSONObject(i)
            val tag = rel.optString("tag_name", "")
            if (!tag.startsWith("dub-")) continue

            val body = rel.optString("body", "")
            val metaJson = extractMetaJson(body)
            val assets = rel.optJSONArray("assets") ?: JSONArray()

            var mp4Browser = ""
            var mp4Api = ""
            var srtBrowser = ""
            var srtApi = ""

            for (a in 0 until assets.length()) {
                val asset = assets.getJSONObject(a)
                val name = asset.optString("name", "").lowercase()
                val bUrl = asset.optString("browser_download_url", "")
                val aUrl = asset.optString("url", "")
                if (name.endsWith(".mp4")) {
                    mp4Browser = bUrl
                    mp4Api = aUrl
                } else if (name.endsWith(".srt")) {
                    srtBrowser = bUrl
                    srtApi = aUrl
                }
            }
            if (mp4Browser.isEmpty() && mp4Api.isEmpty()) continue

            items.add(
                DubReleaseItem(
                    releaseId = rel.getLong("id"),
                    tagName = tag,
                    jobId = metaJson.optString("job_id", tag.removePrefix("dub-")),
                    titleFa = metaJson.optString("title_fa", rel.optString("name", tag)),
                    titleOrig = metaJson.optString("title_orig", ""),
                    summaryFa = metaJson.optString("summary_fa", ""),
                    durationSec = metaJson.optDouble("duration_sec", 0.0),
                    fileSizeMb = metaJson.optDouble("file_size_mb", 0.0),
                    voice = metaJson.optString("voice", "auto"),
                    ttsModel = metaJson.optString("tts_model", "gemini-tts"),
                    youtubeUrl = metaJson.optString("youtube_url", ""),
                    createdAt = rel.optString("created_at", ""),
                    mp4BrowserUrl = mp4Browser,
                    mp4ApiAssetUrl = mp4Api,
                    srtBrowserUrl = srtBrowser,
                    srtApiAssetUrl = srtApi
                )
            )
        }
        return items
    }

    /**
     * Resolve an authenticated temporary direct URL (works for BOTH public and private repos!)
     */
    fun resolveStreamableUrl(apiAssetUrl: String, fallbackBrowserUrl: String): String {
        if (apiAssetUrl.isNotEmpty() && store.githubToken.isNotEmpty()) {
            try {
                val r = request(
                    method = "GET",
                    pathOrUrl = apiAssetUrl,
                    accept = "application/octet-stream",
                    followRedirects = false
                )
                if (r.code in 301..308 && !r.location.isNullOrBlank()) {
                    return r.location
                }
            } catch (_: Exception) {
            }
        }
        return fallbackBrowserUrl
    }

    fun fetchTextUrl(url: String): String {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 20_000
        }
        return try {
            conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    fun deleteDubRelease(releaseId: Long, tagName: String) {
        val repo = cleanRepo()
        request("DELETE", "/repos/$repo/releases/$releaseId")
        val encTag = URLEncoder.encode(tagName, "UTF-8")
        request("DELETE", "/repos/$repo/git/refs/tags/$encTag")
    }

    private fun extractMetaJson(body: String): JSONObject {
        val start = body.indexOf("<!-- DUB_META:")
        if (start >= 0) {
            val jsonStart = start + "<!-- DUB_META:".length
            val end = body.indexOf("-->", jsonStart)
            if (end > jsonStart) {
                return try {
                    JSONObject(body.substring(jsonStart, end).trim())
                } catch (_: Exception) {
                    JSONObject()
                }
            }
        }
        return JSONObject()
    }

    private fun parseIsoMillis(iso: String): Long {
        return try {
            java.time.Instant.parse(iso).toEpochMilli()
        } catch (_: Exception) {
            System.currentTimeMillis()
        }
    }
}
