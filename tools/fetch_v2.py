import json, sys, time, urllib.request
out = sys.argv[1]
U = "https://api.quran.com/api/v4/verses/by_page/{}?words=true&word_fields=code_v2,line_v2,v2_page&per_page=50&mushaf=1&translations=&fields=verse_key"
res = {}
for p in range(1, 605):
    for attempt in range(4):
        try:
            req = urllib.request.Request(U.format(p), headers={"User-Agent": "quran-map-local/1.0"})
            d = json.load(urllib.request.urlopen(req, timeout=30))
            break
        except Exception as e:
            time.sleep(2 + attempt * 3)
    else:
        print("FAILED", p); sys.exit(1)
    assert d["pagination"]["total_pages"] == 1, p
    res[p] = [[v["verse_key"], [[w["char_type_name"], w["code_v2"], w["line_v2"], w["v2_page"]] for w in v["words"]]] for v in d["verses"]]
    if p % 50 == 0: print(p, flush=True)
    time.sleep(0.15)
json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False)
print("done")
