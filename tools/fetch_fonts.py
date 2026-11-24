# ينزّل خطوط صفحات مصحف المدينة (QPC V2، طبعة 1441) إلى fonts/qcf ليعمل التطبيق دون اتصال
# الاستخدام: python -I tools/fetch_fonts.py
import os, sys, time, urllib.request

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fonts", "qcf")
os.makedirs(OUT, exist_ok=True)
URL = "https://static.qurancdn.com/fonts/quran/hafs/v2/woff2/p{}.woff2"
for p in range(1, 605):
    dest = os.path.join(OUT, f"p{p}.woff2")
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        continue
    for attempt in range(4):
        try:
            req = urllib.request.Request(URL.format(p), headers={"User-Agent": "quran-map-local/1.0"})
            data = urllib.request.urlopen(req, timeout=30).read()
            if data[:4] != b"wOF2":
                raise ValueError("not a woff2 file")
            with open(dest, "wb") as f:
                f.write(data)
            break
        except Exception:
            time.sleep(2 + attempt * 3)
    else:
        sys.exit(f"FAILED page {p}")
    if p % 100 == 0:
        print(p, flush=True)
    time.sleep(0.1)
print("done")
