import pytest
from playwright.sync_api import Page


@pytest.fixture(scope="session")
def base_url() -> str:
    return "http://localhost:8000"


@pytest.fixture
def page(page: Page) -> Page:
    return page
