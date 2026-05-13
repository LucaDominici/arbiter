import re

from playwright.sync_api import Page, expect


def test_home_page_status(page: Page, base_url: str) -> None:
    response = page.goto(base_url)
    assert response is not None
    assert response.status < 400


def test_home_page_title(page: Page, base_url: str) -> None:
    page.goto(base_url)
    expect(page).to_have_title(re.compile(r".+"))


def test_home_page_body_visible(page: Page, base_url: str) -> None:
    page.goto(base_url)
    expect(page.locator("body")).to_be_visible()
