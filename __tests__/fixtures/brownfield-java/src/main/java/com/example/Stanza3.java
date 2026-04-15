package com.example;

// brownfield-test seeded violation: EmptyCatchBlock (one per file)
public class Stanza3 {
    public void method() {
        try {
            doWork();
        } catch (Exception e) {
        }
    }

    private void doWork() {}
}
