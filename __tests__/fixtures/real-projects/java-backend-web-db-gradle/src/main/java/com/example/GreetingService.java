package com.example;

import org.springframework.stereotype.Service;

@Service
public class GreetingService {

    public String greet(final String name) {
        return "Hello, " + name + "!";
    }
}
