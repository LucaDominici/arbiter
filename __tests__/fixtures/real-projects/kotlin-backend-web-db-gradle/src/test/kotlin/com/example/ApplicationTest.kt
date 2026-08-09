package com.example

import kotlin.test.Test
import kotlin.test.assertEquals

class ApplicationTest {
    @Test
    fun greetingIsStable() {
        assertEquals("Hello, Arbiter", greeting("Arbiter"))
    }
}
