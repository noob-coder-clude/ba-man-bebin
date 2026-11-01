package com.bamanbebin.dubber

data class SrtCue(
    val startMs: Long,
    val endMs: Long,
    val text: String
)

object SrtParser {

    private val TS_REGEX = Regex(
        """(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})"""
    )

    private fun toMs(h: String, m: String, s: String, ms: String): Long {
        val millis = ms.padEnd(3, '0').take(3).toLongOrNull() ?: 0L
        return (h.toLong() * 3600L + m.toLong() * 60L + s.toLong()) * 1000L + millis
    }

    fun parse(srtContent: String): List<SrtCue> {
        val cues = mutableListOf<SrtCue>()
        val blocks = srtContent.replace("\r\n", "\n").trim().split(Regex("\n\n+"))
        for (block in blocks) {
            val lines = block.lines().map { it.trim() }.filter { it.isNotEmpty() }
            if (lines.size < 2) continue
            val tsIdx = lines.indexOfFirst { it.contains("-->") }
            if (tsIdx < 0 || tsIdx + 1 >= lines.size) continue
            val match = TS_REGEX.find(lines[tsIdx]) ?: continue
            val g = match.groupValues
            val startMs = toMs(g[1], g[2], g[3], g[4])
            val endMs = toMs(g[5], g[6], g[7], g[8])
            val text = lines.subList(tsIdx + 1, lines.size)
                .joinToString("\n")
                .replace(Regex("<[^>]+>"), "")
                .trim()
            if (text.isNotEmpty() && endMs > startMs) {
                cues.add(SrtCue(startMs, endMs, text))
            }
        }
        return cues.sortedBy { it.startMs }
    }

    fun findCueAt(cues: List<SrtCue>, positionMs: Long): String? {
        if (cues.isEmpty()) return null
        var lo = 0
        var hi = cues.lastIndex
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            val c = cues[mid]
            when {
                positionMs < c.startMs -> hi = mid - 1
                positionMs > c.endMs -> lo = mid + 1
                else -> return c.text
            }
        }
        return null
    }
}
