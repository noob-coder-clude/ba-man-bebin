package com.bamanbebin.dubber

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView

object UiKit {
    const val BG_DARK = 0xFF0B0F19.toInt()
    const val CARD_BG = 0xFF141B2D.toInt()
    const val CARD_ALT = 0xFF1B243B.toInt()
    const val INPUT_BG = 0xFF0E1424.toInt()
    const val BORDER_SUBTLE = 0xFF283454.toInt()
    const val ACCENT_RUBY = 0xFFE11D48.toInt()
    const val ACCENT_AMBER = 0xFFF59E0B.toInt()
    const val ACCENT_EMERALD = 0xFF10B981.toInt()
    const val TEXT_PRIMARY = 0xFFF8FAFC.toInt()
    const val TEXT_SECONDARY = 0xFF94A3B8.toInt()

    fun dp(ctx: Context, v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), ctx.resources.displayMetrics).toInt()

    fun roundedBg(
        fillColor: Int,
        radiusDp: Int = 14,
        strokeColor: Int = 0,
        strokeWidthDp: Int = 0,
        ctx: Context
    ): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dp(ctx, radiusDp).toFloat()
        setColor(fillColor)
        if (strokeWidthDp > 0) {
            setStroke(dp(ctx, strokeWidthDp), strokeColor)
        }
    }

    fun makeCard(ctx: Context, marginBottomDp: Int = 14): LinearLayout {
        return LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            background = roundedBg(CARD_BG, 16, BORDER_SUBTLE, 1, ctx)
            val pad = dp(ctx, 16)
            setPadding(pad, pad, pad, pad)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(ctx, marginBottomDp)
            }
        }
    }

    fun makeTitle(ctx: Context, text: String, sizeSp: Float = 17f): TextView {
        return TextView(ctx).apply {
            this.text = text
            setTextColor(TEXT_PRIMARY)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
            setTypeface(Typeface.DEFAULT_BOLD)
            gravity = Gravity.RIGHT
            textDirection = View.TEXT_DIRECTION_RTL
        }
    }

    fun makeBody(ctx: Context, text: String, sizeSp: Float = 13.5f, color: Int = TEXT_SECONDARY): TextView {
        return TextView(ctx).apply {
            this.text = text
            setTextColor(color)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
            setLineSpacing(dp(ctx, 3).toFloat(), 1.0f)
            gravity = Gravity.RIGHT
            textDirection = View.TEXT_DIRECTION_RTL
        }
    }

    fun makeInput(
        ctx: Context,
        hintText: String,
        isPassword: Boolean = false,
        multiLine: Boolean = false,
        ltrContent: Boolean = true
    ): EditText {
        return EditText(ctx).apply {
            hint = hintText
            setHintTextColor(0xFF64748B.toInt())
            setTextColor(TEXT_PRIMARY)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            background = roundedBg(INPUT_BG, 12, BORDER_SUBTLE, 1, ctx)
            val pH = dp(ctx, 14)
            val pV = dp(ctx, 12)
            setPadding(pH, pV, pH, pV)
            textDirection = if (ltrContent) View.TEXT_DIRECTION_LTR else View.TEXT_DIRECTION_RTL
            gravity = if (ltrContent) Gravity.LEFT or Gravity.CENTER_VERTICAL else Gravity.RIGHT or Gravity.CENTER_VERTICAL
            inputType = when {
                isPassword -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                multiLine -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
                else -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            }
            if (multiLine) {
                minLines = 3
                maxLines = 6
                gravity = Gravity.TOP or Gravity.LEFT
            }
        }
    }

    fun makePrimaryButton(ctx: Context, label: String, color: Int = ACCENT_RUBY): Button {
        return Button(ctx).apply {
            text = label
            isAllCaps = false
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setTypeface(Typeface.DEFAULT_BOLD)
            minHeight = dp(ctx, 50)
            background = roundedBg(color, 13, 0, 0, ctx)
            setPadding(dp(ctx, 16), dp(ctx, 12), dp(ctx, 16), dp(ctx, 12))
        }
    }

    fun makeSecondaryButton(ctx: Context, label: String): Button {
        return Button(ctx).apply {
            text = label
            isAllCaps = false
            setTextColor(TEXT_PRIMARY)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
            minHeight = dp(ctx, 46)
            background = roundedBg(CARD_ALT, 12, BORDER_SUBTLE, 1, ctx)
            setPadding(dp(ctx, 12), dp(ctx, 10), dp(ctx, 12), dp(ctx, 10))
        }
    }

    fun makeSpinner(ctx: Context, options: List<String>): Spinner {
        return Spinner(ctx).apply {
            background = roundedBg(INPUT_BG, 12, BORDER_SUBTLE, 1, ctx)
            minimumHeight = dp(ctx, 48)
            setPadding(dp(ctx, 10), dp(ctx, 4), dp(ctx, 10), dp(ctx, 4))
            val adapter = object : ArrayAdapter<String>(ctx, android.R.layout.simple_spinner_item, options) {
                override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                    val tv = super.getView(position, convertView, parent) as TextView
                    tv.setTextColor(TEXT_PRIMARY)
                    tv.textSize = 14f
                    tv.textDirection = View.TEXT_DIRECTION_RTL
                    tv.gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
                    return tv
                }

                override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup): View {
                    val tv = super.getDropDownView(position, convertView, parent) as TextView
                    tv.setBackgroundColor(CARD_ALT)
                    tv.setTextColor(TEXT_PRIMARY)
                    tv.textSize = 14f
                    tv.textDirection = View.TEXT_DIRECTION_RTL
                    tv.gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
                    val p = dp(ctx, 13)
                    tv.setPadding(p, p, p, p)
                    return tv
                }
            }
            this.adapter = adapter
        }
    }

    fun spacer(ctx: Context, heightDp: Int): View {
        return View(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(1, dp(ctx, heightDp))
        }
    }
}
