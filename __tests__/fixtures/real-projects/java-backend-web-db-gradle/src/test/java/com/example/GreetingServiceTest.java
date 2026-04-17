package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

class GreetingServiceTest {

    @Test
    void greetsWithName() {
        final GreetingService service = new GreetingService();
        assertEquals("Hello, World!", service.greet("World"));
    }
}
