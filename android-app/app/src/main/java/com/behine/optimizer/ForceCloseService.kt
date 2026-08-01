package com.behine.optimizer

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Clicks "Force stop" inside system Settings for each queued package,
 * then confirms the dialog and advances the queue. User must enable it
 * manually in Settings → Accessibility (standard cleaner-app approach).
 */
class ForceCloseService : AccessibilityService() {

  private val labelsForceStop = listOf("Force stop", "توقف اجباری", "توقف کامل")
  private val labelsOk = listOf("OK", "باشه", "بله", "تأیید", "تایید")
  private val handler = Handler(Looper.getMainLooper())

  override fun onAccessibilityEvent(event: AccessibilityEvent) {
    if (event.packageName?.toString() != "com.android.settings") return
    if (ForceQueue.pending.isEmpty()) return
    val root = rootInActiveWindow ?: return

    // 1) confirmation dialog first
    if (clickFirst(root, labelsOk)) {
      ForceQueue.pending.poll()
      handler.postDelayed({ BehineBridge.openNextFromQueue() }, 900)
      return
    }
    // 2) the force stop button itself
    clickFirst(root, labelsForceStop)
  }

  private fun clickFirst(root: AccessibilityNodeInfo, texts: List<String>): Boolean {
    for (t in texts) for (n in root.findAccessibilityNodeInfosByText(t)) {
      if (clickNode(n)) return true
    }
    return false
  }

  private fun clickNode(node: AccessibilityNodeInfo?): Boolean {
    var n = node; var hops = 0
    while (n != null && hops < 6) {
      if (n.isClickable && n.isEnabled) { n.performAction(AccessibilityNodeInfo.ACTION_CLICK); return true }
      n = n.parent; hops++
    }
    return false
  }

  override fun onInterrupt() {}
}
