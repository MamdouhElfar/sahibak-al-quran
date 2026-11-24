# يحوّل بيانات Quran.com (تخطيط مصحف المدينة 1441) إلى ملف مضغوط للتطبيق، ويتحقق منه
import json, re, sys
src, data_js, out = sys.argv[1], sys.argv[2], sys.argv[3]
raw = json.load(open(src, encoding="utf-8"))
txt = open(data_js, encoding="utf-8").read()
SURAS = json.loads(re.search(r"SURAS\s*=\s*(\[.*?\]);", txt, re.S).group(1).replace("'", '"'))
PAGES = json.loads(re.search(r"PAGES\s*=\s*(\[.*?\]);", txt, re.S).group(1))
start = {}; acc = 0
for k, s in enumerate(SURAS): start[k + 1] = acc; acc += s[1]
gi = lambda key: start[int(key.split(":")[0])] + int(key.split(":")[1]) - 1
# التجميع حسب صفحة الخط (v2_page) لا حسب ترقيم الواجهة، فهي صفحة طبعة 1441 الفعلية
byp = {}
seen = set()
for p0 in range(1, 605):
    for key, words in raw[str(p0)]:
        if key in seen: continue
        seen.add(key)
        for w in words: byp.setdefault(w[3], {}).setdefault(key, []).append(w)
split = [k for k in seen if len({w[3] for pg in byp.values() for w in pg.get(k, [])}) > 1]
print("verses split across pages:", split)
def order(key): return gi(key)
raw = {str(p): sorted(([k, ws] for k, ws in byp[p].items()), key=lambda kv: order(kv[0])) for p in byp}
starts = []
pages, mism, report = [None], [], {}
for p in range(1, 605):
    verses = raw[str(p)]
    first = verses[0][0]
    starts.append(list(map(int, first.split(":"))))
    s, a = map(int, first.split(":"))
    if [s, a] != PAGES[p - 1]: mism.append((p, first, PAGES[p - 1]))
    lines = {}
    for key, words in verses:
        g = gi(key)
        for typ, code, ln, vp in words:
            assert vp == p, (p, key)
            seg = lines.setdefault(ln, [])
            if seg and seg[-1][0] == g: seg[-1][1] += " " + code
            else: seg.append([g, code])
    maxl = 15 if p > 2 else max(lines) 
    # الأسطر الخالية: اسم السورة والبسملة قبل أول آية من السورة
    rows = []
    for ln in range(1, maxl + 1):
        rows.append(lines.get(ln))
    empty = [i + 1 for i, r in enumerate(rows) if r is None]
    # نسب كل سطر خالٍ: إن كان السطر التالي غير الخالي يبدأ بآية 1 من سورة
    out_rows = []
    for i, r in enumerate(rows):
        if r is not None: out_rows.append(r); continue
        # ابحث عن أول سطر غير خالٍ بعده
        j = i
        while j < len(rows) and rows[j] is None: j += 1
        gap_end = j  # فهرس أول سطر غير خالٍ
        k = i
        while k > 0 and rows[k - 1] is None: k -= 1
        gap = gap_end - k; pos = i - k
        if gap_end < len(rows):
            g0 = rows[gap_end][0][0]
        else:
            g0 = None  # فراغ في آخر الصفحة: السورة تبدأ في الصفحة التالية
        if g0 is None:
            nxt = raw[str(p + 1)][0][0]; sn = int(nxt.split(":")[0])
            hasB = sn not in (1, 9)
            # آخر الصفحة: اسم السورة ثم البسملة
            kind = ["h", sn] if pos == 0 else ["b"]
            report.setdefault("tail", []).append((p, gap))
        else:
            # السورة التي يبدأ بها السطر التالي
            key_s = None
            for ss in range(1, 115):
                if start[ss] == g0: key_s = ss
            assert key_s, (p, i + 1, "gap not before a sura start")
            hasB = key_s not in (1, 9)
            need = 2 if hasB else 1
            if gap == need: kind = ["h", key_s] if pos == 0 else ["b"]
            elif gap == 1 and hasB: kind = ["b"]; report.setdefault("bonly", []).append(p)
            else: raise SystemExit(f"unexpected gap p{p} line{i+1} gap{gap}")
        out_rows.append(kind)
    pages.append(out_rows)
total_ayat = len({seg[0] for pg in pages[1:] for r in pg if r and isinstance(r[0], list) for seg in r})
print("mismatched page starts:", len(mism), mism[:10])
print("ayat covered:", total_ayat, "report:", {k: v[:20] for k, v in report.items()})
print("p1:", [r if not isinstance(r[0], list) else len(r) for r in pages[1]], "p2:", [r if not isinstance(r[0], list) else len(r) for r in pages[2]])
open(out, "w", encoding="utf-8").write(
  "// تخطيط مصحف المدينة (طبعة 1441، خط QPC V2) سطرًا بسطر — المصدر: Quran.com API\n"
  "// لكل صفحة: أسطر؛ السطر إما [[رقم الآية، رموز الكلمات مفصولة بمسافة], ...] أو [\"h\", رقم السورة] أو [\"b\"] للبسملة\n"
  "const M1441 = " + json.dumps(pages, ensure_ascii=False, separators=(",", ":")) + ";\n"
  "// أول آية في كل صفحة من طبعة 1441 (تختلف قليلًا عن ترقيم Tanzil)\n"
  "const M1441_STARTS = " + json.dumps(starts, separators=(",", ":")) + ";\n")
print("written")
