"""Screenshot the demo page in both themes.
  python scripts/shoot.py [base_url] [query...]   (needs playwright with chromium)
Writes shots/<query>-<theme>.png
"""
import os, sys, urllib.parse
from playwright.sync_api import sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5173"
queries = sys.argv[2:] or ["t=14&mode=lines", "t=14"]
os.makedirs("shots", exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch()
    for qstr in queries:
        for theme in ("light", "dark"):
            page = b.new_page(viewport={"width": 1100, "height": 620}, device_scale_factor=2)
            url = f"{base}/?{qstr}&theme={theme}"
            page.goto(url, wait_until="networkidle")
            page.wait_for_timeout(600)
            name = urllib.parse.quote(qstr, safe="") .replace("%", "_")
            out = f"shots/{name}-{theme}.png"
            page.screenshot(path=out)
            print(out)
            page.close()
    b.close()
