# ينزّل خطوط الواجهة من Google Fonts (Amiri وAmiri Quran وTajawal ونستعليق Noto للشعار، رخصة OFL) ويكتب fonts/ui.css بمسارات محلية
# الاستخدام: python -I tools/fetch_ui_fonts.py
import os, re, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fonts")
OUT = os.path.join(ROOT, "ui")
os.makedirs(OUT, exist_ok=True)
CSS_URL = "https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Amiri+Quran&family=Tajawal:wght@400;500;700&family=Noto+Nastaliq+Urdu:wght@700&display=swap"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30).read()

css = get(CSS_URL).decode("utf-8")
n = 0
def local(m):
    global n
    url = m.group(1)
    name = re.sub(r"[^A-Za-z0-9._-]", "_", url.split("/s/")[-1])
    data = get(url)
    assert data[:4] == b"wOF2", url
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(data)
    n += 1
    return f"url(ui/{name})"
css = re.sub(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", local, css)
with open(os.path.join(ROOT, "ui.css"), "w", encoding="utf-8") as f:
    f.write("/* خطوط الواجهة محليًا (Google Fonts، رخصة SIL Open Font License) */\n" + css)
print("fonts:", n)
