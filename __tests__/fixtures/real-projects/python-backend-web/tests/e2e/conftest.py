import os

import pytest
from playwright.sync_api import Page


@pytest.fixture(scope="session")
def base_url() -> str:
    return os.environ.get("E2E_BASE_URL", "http://localhost:8000")


@pytest.fixture
def page(page: Page) -> Page:
    return page
