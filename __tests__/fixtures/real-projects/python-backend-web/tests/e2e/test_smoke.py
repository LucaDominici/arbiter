import re

from playwright.sync_api import Page, expect


def test_home_page_title(page: Page, base_url: str) -> None:
    page.goto(base_url)
    expect(page).to_have_title(re.compile(r".+"))
