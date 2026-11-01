package com.bamanbebin.dubber

import java.security.SecureRandom

/**
 * Pure-Kotlin implementation of Libsodium's `crypto_box_seal`
 * (X25519 + Blake2b-24 nonce + HSalsa20 + XSalsa20-Poly1305).
 *
 * Used to encrypt GEMINI_API_KEY and YT_COOKIES_GZ_B64 against GitHub's
 * repository Actions public key before uploading via REST API.
 * Zero native .so dependencies (100% 16KB-page-size safe on Android 8..16+).
 */
object LibsodiumSealedBox {

    private val SIGMA_BYTES = "expand 32-byte k".toByteArray(Charsets.US_ASCII)

    private val BLAKE2B_IV = longArrayOf(
        0x6a09e667f3bcc908L,
        -0x4498517a7b3558c5L, // 0xbb67ae8584caa73bUL
        0x3c6ef372fe94f82bL,
        -0x5ab00ac5a0e2c90fL, // 0xa54ff53a5f1d36f1UL
        0x510e527fade682d1L,
        -0x64fa9773d4c193e1L, // 0x9b05688c2b3e6c1fUL
        0x1f83d9abfb41bd6bL,
        0x5be0cd19137e2179L
    )

    private val BLAKE2B_SIGMA = arrayOf(
        intArrayOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15),
        intArrayOf(14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3),
        intArrayOf(11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4),
        intArrayOf(7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8),
        intArrayOf(9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13),
        intArrayOf(2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9),
        intArrayOf(12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11),
        intArrayOf(13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10),
        intArrayOf(6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5),
        intArrayOf(10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0),
        intArrayOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15),
        intArrayOf(14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3)
    )

    private val C121665 = LongArray(16).apply {
        this[0] = 0xDB41L
        this[1] = 1L
    }

    /**
     * Encrypt [message] for [recipientPublicKey] (32 bytes) using anonymous SealedBox.
     * Output length is `32 + 16 + message.size`.
     */
    fun seal(message: ByteArray, recipientPublicKey: ByteArray): ByteArray {
        require(recipientPublicKey.size == 32) { "Recipient X25519 public key must be 32 bytes." }
        val ephemeralSk = ByteArray(32)
        SecureRandom().nextBytes(ephemeralSk)
        return sealDeterministic(message, recipientPublicKey, ephemeralSk)
    }

    internal fun sealDeterministic(
        message: ByteArray,
        recipientPublicKey: ByteArray,
        ephemeralSecretKey: ByteArray
    ): ByteArray {
        require(recipientPublicKey.size == 32)
        require(ephemeralSecretKey.size == 32)

        val base9 = ByteArray(32).also { it[0] = 9 }
        val ephemeralPk = ByteArray(32)
        scalarMult(ephemeralPk, ephemeralSecretKey, base9)

        val pkConcat = ByteArray(64)
        System.arraycopy(ephemeralPk, 0, pkConcat, 0, 32)
        System.arraycopy(recipientPublicKey, 0, pkConcat, 32, 32)
        val nonce = blake2b24(pkConcat)

        val sharedRaw = ByteArray(32)
        scalarMult(sharedRaw, ephemeralSecretKey, recipientPublicKey)
        val boxKey = ByteArray(32)
        coreSalsa20(boxKey, ByteArray(16), sharedRaw, SIGMA_BYTES, true)

        val mLen = message.size
        val padded = ByteArray(mLen + 32)
        val ctPadded = ByteArray(mLen + 32)
        System.arraycopy(message, 0, padded, 32, mLen)

        xsalsa20Xor(ctPadded, padded, mLen + 32, nonce, boxKey)
        val mac = ByteArray(16)
        poly1305(mac, ctPadded, 32, mLen, ctPadded)

        val out = ByteArray(32 + 16 + mLen)
        System.arraycopy(ephemeralPk, 0, out, 0, 32)
        System.arraycopy(mac, 0, out, 32, 16)
        System.arraycopy(ctPadded, 32, out, 48, mLen)
        return out
    }

    private fun rotr64(x: Long, c: Int): Long = (x ushr c) or (x shl (64 - c))

    private fun b2G(v: LongArray, a: Int, b: Int, c: Int, d: Int, x: Long, y: Long) {
        v[a] = v[a] + v[b] + x
        v[d] = rotr64(v[d] xor v[a], 32)
        v[c] = v[c] + v[d]
        v[b] = rotr64(v[b] xor v[c], 24)
        v[a] = v[a] + v[b] + y
        v[d] = rotr64(v[d] xor v[a], 16)
        v[c] = v[c] + v[d]
        v[b] = rotr64(v[b] xor v[c], 63)
    }

    private fun blake2b24(input64: ByteArray): ByteArray {
        val h = BLAKE2B_IV.copyOf()
        h[0] = h[0] xor (0x01010000L xor 24L)

        val block = ByteArray(128)
        System.arraycopy(input64, 0, block, 0, input64.size)

        val m = LongArray(16)
        for (i in 0 until 16) {
            var w = 0L
            for (b in 0 until 8) {
                w = w or ((block[i * 8 + b].toLong() and 0xffL) shl (8 * b))
            }
            m[i] = w
        }

        val v = LongArray(16)
        for (i in 0 until 8) {
            v[i] = h[i]
            v[i + 8] = BLAKE2B_IV[i]
        }
        v[12] = v[12] xor input64.size.toLong()
        v[14] = v[14] xor -1L

        for (r in 0 until 12) {
            val s = BLAKE2B_SIGMA[r]
            b2G(v, 0, 4, 8, 12, m[s[0]], m[s[1]])
            b2G(v, 1, 5, 9, 13, m[s[2]], m[s[3]])
            b2G(v, 2, 6, 10, 14, m[s[4]], m[s[5]])
            b2G(v, 3, 7, 11, 15, m[s[6]], m[s[7]])
            b2G(v, 0, 5, 10, 15, m[s[8]], m[s[9]])
            b2G(v, 1, 6, 11, 12, m[s[10]], m[s[11]])
            b2G(v, 2, 7, 8, 13, m[s[12]], m[s[13]])
            b2G(v, 3, 4, 9, 14, m[s[14]], m[s[15]])
        }
        for (i in 0 until 8) {
            h[i] = h[i] xor v[i] xor v[i + 8]
        }
        val out = ByteArray(24)
        for (i in 0 until 24) {
            out[i] = ((h[i / 8] ushr (8 * (i % 8))) and 0xffL).toByte()
        }
        return out
    }

    private fun ld32(x: ByteArray, off: Int): Int {
        return (x[off].toInt() and 0xff) or
            ((x[off + 1].toInt() and 0xff) shl 8) or
            ((x[off + 2].toInt() and 0xff) shl 16) or
            ((x[off + 3].toInt() and 0xff) shl 24)
    }

    private fun st32(x: ByteArray, off: Int, uIn: Int) {
        var u = uIn
        for (i in 0 until 4) {
            x[off + i] = (u and 0xff).toByte()
            u = u ushr 8
        }
    }

    private fun rotl32(x: Int, c: Int): Int = (x shl c) or (x ushr (32 - c))

    private fun coreSalsa20(
        out: ByteArray,
        in16: ByteArray,
        k32: ByteArray,
        c16: ByteArray,
        hsalsa: Boolean
    ) {
        val w = IntArray(16)
        val x = IntArray(16)
        val y = IntArray(16)
        val t = IntArray(4)

        for (i in 0 until 4) {
            x[5 * i] = ld32(c16, 4 * i)
            x[1 + i] = ld32(k32, 4 * i)
            x[6 + i] = ld32(in16, 4 * i)
            x[11 + i] = ld32(k32, 16 + 4 * i)
        }
        for (i in 0 until 16) y[i] = x[i]

        for (i in 0 until 20) {
            for (j in 0 until 4) {
                for (m in 0 until 4) t[m] = x[(5 * j + 4 * m) % 16]
                t[1] = t[1] xor rotl32(t[0] + t[3], 7)
                t[2] = t[2] xor rotl32(t[1] + t[0], 9)
                t[3] = t[3] xor rotl32(t[2] + t[1], 13)
                t[0] = t[0] xor rotl32(t[3] + t[2], 18)
                for (m in 0 until 4) w[4 * j + (j + m) % 4] = t[m]
            }
            for (m in 0 until 16) x[m] = w[m]
        }

        if (hsalsa) {
            for (i in 0 until 16) x[i] += y[i]
            for (i in 0 until 4) {
                x[5 * i] -= ld32(c16, 4 * i)
                x[6 + i] -= ld32(in16, 4 * i)
            }
            for (i in 0 until 4) {
                st32(out, 4 * i, x[5 * i])
                st32(out, 16 + 4 * i, x[6 + i])
            }
        } else {
            for (i in 0 until 16) st32(out, 4 * i, x[i] + y[i])
        }
    }

    private fun xsalsa20Xor(
        c: ByteArray,
        m: ByteArray,
        len: Int,
        n24: ByteArray,
        k32: ByteArray
    ) {
        val z = ByteArray(16)
        val x = ByteArray(64)
        val subk = ByteArray(32)
        val nPrefix = ByteArray(16)
        System.arraycopy(n24, 0, nPrefix, 0, 16)
        coreSalsa20(subk, nPrefix, k32, SIGMA_BYTES, true)
        System.arraycopy(n24, 16, z, 0, 8)

        var rem = len
        var pos = 0
        while (rem >= 64) {
            coreSalsa20(x, z, subk, SIGMA_BYTES, false)
            for (i in 0 until 64) {
                c[pos + i] = ((m[pos + i].toInt() and 0xff) xor (x[i].toInt() and 0xff)).toByte()
            }
            var u = 1
            for (i in 8 until 16) {
                u += (z[i].toInt() and 0xff)
                z[i] = (u and 0xff).toByte()
                u = u ushr 8
            }
            rem -= 64
            pos += 64
        }
        if (rem > 0) {
            coreSalsa20(x, z, subk, SIGMA_BYTES, false)
            for (i in 0 until rem) {
                c[pos + i] = ((m[pos + i].toInt() and 0xff) xor (x[i].toInt() and 0xff)).toByte()
            }
        }
    }

    private fun poly1305(
        out16: ByteArray,
        m: ByteArray,
        mOff: Int,
        mLen: Int,
        k32: ByteArray
    ) {
        val r = LongArray(17)
        val h = LongArray(17)
        val c = LongArray(17)
        for (j in 0 until 16) r[j] = (k32[j].toLong() and 0xffL)
        r[3] = r[3] and 15L
        r[4] = r[4] and 252L
        r[7] = r[7] and 15L
        r[8] = r[8] and 252L
        r[11] = r[11] and 15L
        r[12] = r[12] and 252L
        r[15] = r[15] and 15L
        r[16] = 0L

        var pos = mOff
        var rem = mLen
        while (rem > 0) {
            for (j in 0 until 17) c[j] = 0L
            var j = 0
            while (j < 16 && j < rem) {
                c[j] = (m[pos + j].toLong() and 0xffL)
                j++
            }
            c[j] = 1L
            pos += j
            rem -= j

            var u = 0L
            for (i in 0 until 17) {
                u += h[i] + c[i]
                h[i] = u and 255L
                u = u ushr 8
            }
            val hr = LongArray(17)
            for (i in 0 until 17) {
                u = 0L
                for (jj in 0..i) u += h[jj] * r[i - jj]
                for (jj in (i + 1) until 17) u += 320L * h[jj] * r[i + 17 - jj]
                hr[i] = u
            }
            for (i in 0 until 17) h[i] = hr[i]
            u = 0L
            for (i in 0 until 16) {
                u += h[i]
                h[i] = u and 255L
                u = u ushr 8
            }
            u += h[16]
            h[16] = u and 3L
            u = 5L * (u ushr 2)
            for (i in 0 until 16) {
                u += h[i]
                h[i] = u and 255L
                u = u ushr 8
            }
            u += h[16]
            h[16] = u
        }

        val minusp = longArrayOf(5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 252)
        val orig = h.copyOf()
        var u = 0L
        for (j in 0 until 17) {
            u += h[j] + minusp[j]
            h[j] = u and 255L
            u = u ushr 8
        }
        val neg = -(((h[16] ushr 7) and 1L) xor 1L)
        for (j in 0 until 17) {
            h[j] = h[j] xor (neg and (orig[j] xor h[j]))
        }
        u = 0L
        for (j in 0 until 16) {
            u += h[j] + (k32[j + 16].toLong() and 0xffL)
            h[j] = u and 255L
            u = u ushr 8
        }
        for (j in 0 until 16) {
            out16[j] = (h[j] and 0xffL).toByte()
        }
    }

    private fun car25519(o: LongArray) {
        for (i in 0 until 16) {
            o[i] += (1L shl 16)
            val c = o[i] shr 16
            if (i < 15) {
                o[i + 1] += c - 1L
            } else {
                o[0] += 38L * (c - 1L)
            }
            o[i] -= c shl 16
        }
    }

    private fun sel25519(p: LongArray, q: LongArray, b: Int) {
        val c = (b - 1).toLong().inv()
        for (i in 0 until 16) {
            val t = c and (p[i] xor q[i])
            p[i] = p[i] xor t
            q[i] = q[i] xor t
        }
    }

    private fun pack25519(o: ByteArray, n: LongArray) {
        val m = LongArray(16)
        val t = n.copyOf()
        car25519(t)
        car25519(t)
        car25519(t)
        for (j in 0 until 2) {
            m[0] = t[0] - 0xffedL
            for (i in 1 until 15) {
                m[i] = t[i] - 0xffffL - ((m[i - 1] shr 16) and 1L)
                m[i - 1] = m[i - 1] and 0xffffL
            }
            m[15] = t[15] - 0x7fffL - ((m[14] shr 16) and 1L)
            val b = ((m[15] shr 16) and 1L).toInt()
            m[14] = m[14] and 0xffffL
            sel25519(t, m, 1 - b)
        }
        for (i in 0 until 16) {
            o[2 * i] = (t[i] and 0xffL).toByte()
            o[2 * i + 1] = ((t[i] shr 8) and 0xffL).toByte()
        }
    }

    private fun unpack25519(o: LongArray, n: ByteArray) {
        for (i in 0 until 16) {
            o[i] = (n[2 * i].toLong() and 0xffL) + ((n[2 * i + 1].toLong() and 0xffL) shl 8)
        }
        o[15] = o[15] and 0x7fffL
    }

    private fun gfAdd(o: LongArray, a: LongArray, b: LongArray) {
        for (i in 0 until 16) o[i] = a[i] + b[i]
    }

    private fun gfSub(o: LongArray, a: LongArray, b: LongArray) {
        for (i in 0 until 16) o[i] = a[i] - b[i]
    }

    private fun gfMul(o: LongArray, a: LongArray, b: LongArray) {
        val t = LongArray(31)
        for (i in 0 until 16) {
            for (j in 0 until 16) {
                t[i + j] += a[i] * b[j]
            }
        }
        for (i in 0 until 15) t[i] += 38L * t[i + 16]
        for (i in 0 until 16) o[i] = t[i]
        car25519(o)
        car25519(o)
    }

    private fun gfSq(o: LongArray, a: LongArray) = gfMul(o, a, a)

    private fun inv25519(o: LongArray, inp: LongArray) {
        val c = inp.copyOf()
        for (a in 253 downTo 0) {
            gfSq(c, c)
            if (a != 2 && a != 4) gfMul(c, c, inp)
        }
        for (a in 0 until 16) o[a] = c[a]
    }

    internal fun scalarMult(q: ByteArray, n: ByteArray, p: ByteArray) {
        val z = n.copyOf()
        z[31] = (((z[31].toInt() and 0xff) and 127) or 64).toByte()
        z[0] = ((z[0].toInt() and 0xff) and 248).toByte()

        val x = LongArray(16)
        val a = LongArray(16)
        val b = LongArray(16)
        val c = LongArray(16)
        val d = LongArray(16)
        val e = LongArray(16)
        val f = LongArray(16)

        unpack25519(x, p)
        for (i in 0 until 16) b[i] = x[i]
        a[0] = 1L
        d[0] = 1L

        for (i in 254 downTo 0) {
            val r = ((z[i shr 3].toInt() and 0xff) ushr (i and 7)) and 1
            sel25519(a, b, r)
            sel25519(c, d, r)
            gfAdd(e, a, c)
            gfSub(a, a, c)
            gfAdd(c, b, d)
            gfSub(b, b, d)
            gfSq(d, e)
            gfSq(f, a)
            gfMul(a, c, a)
            gfMul(c, b, e)
            gfAdd(e, a, c)
            gfSub(a, a, c)
            gfSq(b, a)
            gfSub(c, d, f)
            gfMul(a, c, C121665)
            gfAdd(a, a, d)
            gfMul(c, c, a)
            gfMul(a, d, f)
            gfMul(d, b, x)
            gfSq(b, e)
            sel25519(a, b, r)
            sel25519(c, d, r)
        }
        inv25519(c, c)
        gfMul(a, a, c)
        pack25519(q, a)
    }
}
