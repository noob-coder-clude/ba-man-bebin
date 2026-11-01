package com.bamanbebin.dubber

import org.junit.Assert.assertEquals
import org.junit.Test

class LibsodiumSealedBoxTest {

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it.toInt() and 0xff) }

    @Test
    fun matchesLibsodiumOfficialSealedBoxVector() {
        val recipSk = ByteArray(32) { (it + 1).toByte() }
        val ephemSk = ByteArray(32) { (it + 33).toByte() }
        val base9 = ByteArray(32).also { it[0] = 9 }

        val recipPk = ByteArray(32)
        LibsodiumSealedBox.scalarMult(recipPk, recipSk, base9)
        assertEquals(
            "07a37cbc142093c8b755dc1b10e86cb426374ad16aa853ed0bdfc0b2b86d1c7c",
            recipPk.toHex()
        )

        val msg = "AIzaSyDummyGeminiKey_1234567890".toByteArray(Charsets.UTF_8)
        val sealed = LibsodiumSealedBox.sealDeterministic(msg, recipPk, ephemSk)
        assertEquals(
            "5869aff450549732cbaaed5e5df9b30a6da31cb0e5742bad5ad4a1a768f1a67b" +
                "4f5438ce276bdc0576314c3d57d7ae150391e46ad327080205b983aa49a0ad25" +
                "3c6ef347b52514f6f391e2905313f0",
            sealed.toHex()
        )
    }
}
