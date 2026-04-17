package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

class MathUtilsTest {

    @Test
    void addsTwoNumbers() {
        assertEquals(5, MathUtils.add(2, 3));
    }

    @Test
    void multipliesTwoNumbers() {
        assertEquals(12, MathUtils.multiply(3, 4));
    }
}
