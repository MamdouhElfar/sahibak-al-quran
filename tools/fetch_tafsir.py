# ينزّل تفسيرًا كاملًا من Quran.com API ويكتبه ملفًا يُضمَّن في التطبيق (نصًا خالصًا بلا وسوم HTML)
# الاستخدام: python -I tools/fetch_tafsir.py 16 TAFSIR_MUYASSAR tafsir-muyassar.js
import html, json, re, sys, time, urllib.request

tid, var, out = sys.argv[1], sys.argv[2], sys.argv[3]
SURAS = [7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6]
assert sum(SURAS) == 6236
U = "https://api.quran.com/api/v4/tafsirs/{}/by_chapter/{}?per_page=50&page={}"

def get(url):
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "quran-map-local/1.0"})
            return json.load(urllib.request.urlopen(req, timeout=30))
        except Exception:
            time.sleep(2 + attempt * 3)
    raise SystemExit("FAILED " + url)

def clean(t):
    t = re.sub(r"<\s*(br|/p|/h\d|/div)\s*/?>", "\n", t or "", flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", "", t))
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", t)).strip()

texts = []
for s, n in enumerate(SURAS, 1):
    got, page = {}, 1
    while page:
        d = get(U.format(tid, s, page))
        for x in d["tafsirs"]:
            got[int(x["verse_key"].split(":")[1])] = clean(x["text"])
        page = d["pagination"]["next_page"]
        time.sleep(0.12)
    texts += [got.get(a, "") for a in range(1, n + 1)]
    if s % 10 == 0: print(s, flush=True)
empty = sum(1 for t in texts if not t)
with open(out, "w", encoding="utf-8") as f:
    f.write(f"// تفسير (المعرّف {tid}) من Quran.com API — نص خالص، عنصر لكل آية بترتيب المصحف\n")
    f.write(f"const {var} = " + json.dumps(texts, ensure_ascii=False, separators=(",", ":")) + ";\n")
print("done", len(texts), "empty:", empty)
