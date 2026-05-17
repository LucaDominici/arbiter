"""Minimal FastAPI app exposing a single health endpoint."""

from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def hello() -> str:
    return "hello"
