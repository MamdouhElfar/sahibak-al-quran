// خريطة المصحف
// • لكل آية حالة: bit1 = حفظ، bit2 = فهم (3 = كلاهما) + يوم آخر مراجعة للمحفوظ
// • سجل القراءة اليومي: { رقم اليوم: [أرقام الصفحات] } + الورد اليومي + موضع الوقوف + بداية الختمة
const TOTAL = 6236, PAGES_N = 604;
const KEY = 'quranMap.v1';
const DWELL = 15;                 // ثوانٍ يجب أن تبقى الصفحة مفتوحة لتُحسب مقروءة
const ar = n => n.toLocaleString('ar-EG');
const $ = id => document.getElementById(id);

// ---------- فهرسة الآيات ----------
const start = [];
let acc = 0;
SURAS.forEach((s, k) => { start[k + 1] = acc; acc += s[1]; });
const gi = (s, a) => start[s] + a - 1;
const suraOf = new Uint8Array(TOTAL);
SURAS.forEach((s, k) => suraOf.fill(k + 1, start[k + 1], start[k + 1] + s[1]));
const ayahOf = i => i - start[suraOf[i]] + 1;

function bounds(list) {
  const st = list.map(([s, a]) => gi(s, a));
  return st.map((f, k) => [f, (st[k + 1] ?? TOTAL) - 1]);
}
// حدود الصفحات من طبعة المدينة 1441 إن توفرت (تختلف عن ترقيم Tanzil في ٢٥ صفحة)
const pageB = bounds(typeof M1441_STARTS !== 'undefined' ? M1441_STARTS : PAGES), juzB = bounds(JUZ);
const pageOf = new Uint16Array(TOTAL), juzOf = new Uint8Array(TOTAL);
pageB.forEach(([f, t], k) => pageOf.fill(k + 1, f, t + 1));
juzB.forEach(([f, t], k) => juzOf.fill(k + 1, f, t + 1));

// ---------- صيغ العدد بالفصحى ----------
const plural = (n, one, two, few, many) => n === 1 ? one : n === 2 ? two : `${ar(n)} ${n >= 3 && n <= 10 ? few : many}`;
const ayat = n => n === 0 ? 'لا آيات' : plural(n, 'آية واحدة', 'آيتان', 'آيات', 'آية');
const safahat = n => n === 0 ? 'لا صفحات' : plural(n, 'صفحة واحدة', 'صفحتان', 'صفحات', 'صفحة');
const ayyamN = n => plural(n, 'يوم واحد', 'يومان', 'أيام', 'يومًا');
const ayyam = n => n <= 0 ? 'اليوم' : n === 1 ? 'أمس' : n === 2 ? 'قبل يومين' : `قبل ${ar(n)} ${n <= 10 ? 'أيام' : 'يومًا'}`;
const pct = (x, n) => ar(+(x / n * 100).toFixed(1)) + '٪';
const span = (f, t) => {
  const a = suraOf[f], b = suraOf[t];
  return a === b ? `سورة ${SURAS[a - 1][0]}` : `${SURAS[a - 1][0]} ← ${SURAS[b - 1][0]}`;
};

const GROUPS = {
  suras: SURAS.map((s, k) => ({
    title: `سورة ${s[0]}`, meta: `${ayat(s[1])} · ${s[2] === 'م' ? 'مكية' : 'مدنية'}`,
    from: start[k + 1], to: start[k + 1] + s[1] - 1 })),
  pages: pageB.map(([f, t], k) => ({ title: `صفحة ${ar(k + 1)}`, meta: `${span(f, t)} · الجزء ${ar(juzOf[f])}`, from: f, to: t })),
  juz: juzB.map(([f, t], k) => ({ title: `الجزء ${ar(k + 1)}`, meta: span(f, t), from: f, to: t })),
};

// ---------- الحالة والتخزين ----------
const today = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / 864e5);
const state = new Uint8Array(TOTAL);
const rev = new Int32Array(TOTAL);
let cycle = 14, readLog = {}, wird = 5, lastPage = 1, khatmaStart = today(), fontSize = 26;
let backupDay = 0, backupSnooze = 0;   // يوم آخر نسخة احتياطية، ويوم تأجيل التذكير
// ورد الحفظ والمراجعة
let hifzLog = {};   // { رقم اليوم: [أرقام الآيات التي حُفظت جديدًا فيه] }
let revLog = {};    // { رقم اليوم: عدد الآيات التي رُوجعت فيه }
let hGoal = 5;      // آيات الحفظ الجديد يوميًا
let hDir = 'b';     // 'b': من الناس إلى البقرة (جزء عمّ أولًا)، 'f': من الفاتحة إلى الناس

// ---------- التحقق من صحة البيانات (للتحميل والاسترجاع) ----------
const CYCLES = [3, 7, 14, 30, 60], WIRDS = [1, 2, 3, 4, 5, 10, 20, 40], HGOALS = [1, 2, 3, 5, 7, 10, 15, 20];
const cleanDir = v => v === 'b' || v === 'f' ? v : null;
const int = (v, min, max) => { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return Number.isInteger(n) && n >= min && n <= max ? n : null; };
const day = v => int(v, 1, today() + 1);          // +1: نسخة من جهاز في منطقة زمنية متقدّمة
const oneOf = list => v => { const n = int(v, 0, 1e9); return list.includes(n) ? n : null; };
const cleanState = s => typeof s === 'string' && s.length === TOTAL && /^[0-3]+$/.test(s) ? s : null;
// يوم مراجعة في المستقبل (ساعة الجهاز كانت متقدّمة) يُعدّ اليوم بدل رفض السجل كله
const cleanRev = r => Array.isArray(r) && r.length === TOTAL && r.every(d => int(d, 0, 1e7) !== null)
  ? r.map(d => Math.min(d, today())) : null;
function cleanLog(o) {   // يُسقط الأيام أو الصفحات غير الصالحة ويُبقي الباقي
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  for (const k in o) {
    if (day(k) === null || !Array.isArray(o[k])) continue;
    const ps = [...new Set(o[k].map(p => int(p, 1, PAGES_N)).filter(p => p !== null))];
    if (ps.length) out[+k] = ps;
  }
  return out;
}
function cleanHLog(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  for (const k in o) {
    if (day(k) === null || !Array.isArray(o[k])) continue;
    const ids = [...new Set(o[k].map(i => int(i, 0, TOTAL - 1)).filter(i => i !== null))];
    if (ids.length) out[+k] = ids;
  }
  return out;
}
function cleanRLog(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  for (const k in o) { const n = int(o[k], 1, 1e6); if (day(k) !== null && n) out[+k] = n; }
  return out;
}

// ---------- نسخة سطح المكتب: ملف بيانات في AppData بجانب localStorage ----------
// إن فُقد تخزين النافذة (أول تشغيل بعد إعادة تثبيت مثلًا) تُستعاد البيانات من الملف؛ وكل حفظ يُكتب في الملف أيضًا
const DESK = window.qmDesktop || null;
if (DESK) {
  try {
    const file = DESK.readData();
    if (file && file.keys && localStorage.getItem(KEY) === null)
      for (const [k, v] of Object.entries(file.keys)) if (k.startsWith('quranMap') && typeof v === 'string') localStorage.setItem(k, v);
  } catch (e) { DESK.logError('restore: ' + e); }
  addEventListener('error', e => DESK.logError(`${e.message} @${e.filename}:${e.lineno}`));
}
function deskSnapshot() {
  const keys = {};
  try { Object.keys(localStorage).forEach(k => { if (k.startsWith('quranMap') && !k.includes('.rescue')) keys[k] = localStorage.getItem(k); }); } catch (e) {}
  return JSON.stringify({ app: 'quran-map', v: 1, saved: new Date().toISOString(), keys });
}
let deskT = null;
function deskSave() {
  if (!DESK) return;
  clearTimeout(deskT);
  deskT = setTimeout(() => { deskT = null; DESK.writeData(deskSnapshot()); }, 400);
}
if (DESK) addEventListener('beforeunload', () => { if (deskT) { clearTimeout(deskT); DESK.writeDataSync(deskSnapshot()); } });

// ---------- التحميل: كل مفتاح مستقل، فلا يُسقط التالفُ منها الباقي ----------
function load() {
  const bad = {};
  const read = (k, parse, clean) => {
    let raw;
    try { raw = localStorage.getItem(KEY + k); } catch (e) { return null; }
    if (raw === null) return null;
    let v = null;
    try { v = clean(parse(raw)); } catch (e) {}
    if (v === null) bad[k || 'state'] = raw;
    return v;
  };
  const str = x => x, json = JSON.parse;
  const s = read('', str, cleanState);
  state.fill(0); if (s) for (let i = 0; i < TOTAL; i++) state[i] = +s[i];
  const r = read('.rev', json, cleanRev);
  rev.fill(0); if (r) r.forEach((d, i) => rev[i] = d);
  cycle = read('.cycle', str, oneOf(CYCLES)) ?? 14;
  readLog = read('.read', json, cleanLog) ?? {};
  wird = read('.wird', str, oneOf(WIRDS)) ?? 5;
  lastPage = read('.last', str, v => int(v, 1, PAGES_N)) ?? 1;
  khatmaStart = read('.khatma', str, day) ?? today();
  fontSize = read('.fs', str, v => int(v, 18, 40)) ?? 26;
  const day0 = v => int(v, 0, today() + 1);   // ٠ = لم يحدث بعد
  backupDay = read('.bk', str, day0) ?? 0;
  backupSnooze = read('.bkLater', str, day0) ?? 0;
  hifzLog = read('.hlog', json, cleanHLog) ?? {};
  revLog = read('.rlog', json, cleanRLog) ?? {};
  hGoal = read('.hgoal', str, oneOf(HGOALS)) ?? 5;
  hDir = read('.hdir', str, cleanDir) ?? 'b';
  const t = today();
  for (let i = 0; i < TOTAL; i++) if ((state[i] & 1) && !rev[i]) rev[i] = t;
  // القيم التالفة تُحفظ كما هي قبل أن يكتب فوقها أول حفظ، لإمكان إنقاذها يدويًا
  if (Object.keys(bad).length) {
    try { localStorage.setItem(`${KEY}.rescue.${Date.now()}`, JSON.stringify(bad)); } catch (e) {}
    console.warn('خريطة المصحف: وُجدت بيانات تالفة وحُفظت نسختها الأصلية', Object.keys(bad));
  }
}
load();

let persistAsked = false, saveFailWarned = false;
function save() {
  try {
    localStorage.setItem(KEY, state.join(''));
    localStorage.setItem(KEY + '.rev', JSON.stringify([...rev]));
    localStorage.setItem(KEY + '.cycle', cycle);
    localStorage.setItem(KEY + '.read', JSON.stringify(readLog));
    localStorage.setItem(KEY + '.wird', wird);
    localStorage.setItem(KEY + '.last', lastPage);
    localStorage.setItem(KEY + '.khatma', khatmaStart);
    localStorage.setItem(KEY + '.fs', fontSize);
    localStorage.setItem(KEY + '.bk', backupDay);
    localStorage.setItem(KEY + '.bkLater', backupSnooze);
    localStorage.setItem(KEY + '.hlog', JSON.stringify(hifzLog));
    localStorage.setItem(KEY + '.rlog', JSON.stringify(revLog));
    localStorage.setItem(KEY + '.hgoal', hGoal);
    localStorage.setItem(KEY + '.hdir', hDir);
    deskSave();
  } catch (e) {
    if (saveFailWarned) return;
    saveFailWarned = true;
    alert('تعذّر حفظ بياناتك في هذا المتصفح (قد تكون مساحة التخزين ممتلئة أو محظورة). احفظ نسخة احتياطية الآن من أسفل صفحة الخريطة.');
  }
  // اطلب من المتصفح ألّا يمسح بيانات التطبيق تلقائيًا عند امتلاء الجهاز
  if (!persistAsked && navigator.storage?.persist) {
    persistAsked = true;
    navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
  }
}
const hasData = () => state.some(x => x) || Object.keys(readLog).length > 0 || Object.keys(revLog).length > 0;

const isDue = i => (state[i] & 1) && today() - rev[i] >= cycle;

function count(from, to) {
  let h = 0, f = 0, b = 0, d = 0, oldest = Infinity, latest = 0;
  for (let i = from; i <= to; i++) {
    const s = state[i];
    if (s & 1) { h++; if (isDue(i)) d++; oldest = Math.min(oldest, rev[i]); latest = Math.max(latest, rev[i]); }
    if (s & 2) f++;
    if (s === 3) b++;
  }
  return { h, f, b, d, n: to - from + 1, oldest, latest };
}

// ---------- سجل القراءة ----------
const readOn = d => readLog[d] || [];
const readCount = d => readOn(d).length;
function markRead(p, d = today()) {
  const arr = readLog[d] || (readLog[d] = []);
  if (!arr.includes(p)) { arr.push(p); return true; }
  return false;
}
function khatmaPages() {
  const s = new Set();
  for (const d in readLog) if (+d >= khatmaStart) readLog[d].forEach(p => s.add(p));
  return s;
}
// ---------- مقاييس الورد الثلاثة ----------
const hifzCount = d => (hifzLog[d] || []).length;
const revCount = d => revLog[d] || 0;
function revQuota() {   // ما يلزم مراجعته يوميًا ليُراجَع المحفوظ كله مرة في كل دورة
  let h = 0;
  for (let i = 0; i < TOTAL; i++) h += state[i] & 1;
  return h ? Math.ceil(h / cycle) : 0;
}
const METRICS = {
  read: { n: readCount, goal: () => wird, unit: safahat, name: 'القراءة' },
  hifz: { n: hifzCount, goal: () => hGoal, unit: ayat, name: 'الحفظ' },
  rev:  { n: revCount, goal: revQuota, unit: ayat, name: 'المراجعة' },
};
function streakOf(m, goal = m.goal()) {
  if (!goal) return 0;
  let d = today(), n = 0;
  if (m.n(d) < goal) d--;           // اليوم لم يكتمل بعد؛ السلسلة ما زالت قائمة من أمس
  while (m.n(d) >= goal) { n++; d--; }
  return n;
}
const streak = () => streakOf(METRICS.read);

// ---------- موضع الحفظ ومقدار اليوم ----------
// ترتيب الحفظ: السور تنازليًا أو تصاعديًا، والآيات داخل السورة تصاعديًا دائمًا
function* hifzOrder() {
  for (let k = 0; k < 114; k++) {
    const s = hDir === 'b' ? 114 - k : k + 1;
    for (let i = start[s], e = i + SURAS[s - 1][1]; i < e; i++) yield i;
  }
}
function nextHifz(n) {     // أول n آيات لم تُحفظ بعد بترتيب الحفظ
  const out = [];
  if (n <= 0) return out;
  for (const i of hifzOrder()) if (!(state[i] & 1)) { out.push(i); if (out.length >= n) break; }
  return out;
}
// يصف مجموعة آيات بنطاقات متصلة: «الملك ٢٨–٣٠ · القلم ١–٢»
function describeAyat(ids) {
  const parts = [];
  let a = null, b = null;
  const flush = () => {
    if (a === null) return;
    const s = SURAS[suraOf[a] - 1][0];
    parts.push(a === b ? `${s} ${ar(ayahOf(a))}` : `${s} ${ar(ayahOf(a))}–${ar(ayahOf(b))}`);
  };
  ids.forEach(i => {
    if (a !== null && i === b + 1 && suraOf[i] === suraOf[a]) b = i;
    else { flush(); a = b = i; }
  });
  flush();
  return parts.length > 3 ? parts.slice(0, 3).join(' · ') + ' …' : parts.join(' · ');
}
// الصفحات التي فيها أقدم الآيات المستحقة للمراجعة، بقدر ما بقي من مقدار اليوم
function reviewPortion() {
  const left = revQuota() - revCount(today());
  if (left <= 0) return [];
  const due = [];
  for (let i = 0; i < TOTAL; i++) if (isDue(i)) due.push(i);
  due.sort((x, y) => rev[x] - rev[y] || x - y);
  const pages = new Set();
  let n = 0;
  for (const i of due) {
    if (pages.has(pageOf[i])) continue;
    pages.add(pageOf[i]);
    const [f, t] = pageB[pageOf[i] - 1];
    for (let j = f; j <= t; j++) if (isDue(j)) n++;
    if (n >= left) break;
  }
  return [...pages].sort((x, y) => x - y);
}
function describePages(ps) {
  const parts = [];
  for (let k = 0; k < ps.length; k++) {
    let e = k;
    while (e + 1 < ps.length && ps[e + 1] === ps[e] + 1) e++;
    parts.push(k === e ? ar(ps[k]) : `${ar(ps[k])}–${ar(ps[e])}`);
    k = e;
  }
  const s = parts.length > 4 ? parts.slice(0, 4).join('، ') + ' …' : parts.join('، ');
  return `${ps.length === 1 ? 'صفحة' : 'الصفحات'} ${s}`;
}
const pageAyat = ps => ps.flatMap(p => { const [f, t] = pageB[p - 1], r = []; for (let i = f; i <= t; i++) r.push(i); return r; });
function duration(d) {
  if (d <= 60) return ayyamN(d);
  if (d <= 730) return plural(Math.round(d / 30), 'شهر واحد', 'شهران', 'أشهر', 'شهرًا');
  return `${ar(+(d / 365).toFixed(1))} سنة`;
}

// ======================================================================
//  الرئيسية
// ======================================================================
const SEGS = [   // ترتيب الحلقة مقصود: الأحمر ليس بجوار الأخضر (متحقق لعمى الألوان)
  { key: 'both', label: 'حفظ وفهم', c: 'var(--c-both)' },
  { key: 'fahm', label: 'فهم فقط', c: 'var(--c-fahm)' },
  { key: 'hifz', label: 'حفظ فقط', c: 'var(--c-hifz)' },
  { key: 'due',  label: 'محفوظ ويحتاج إلى مراجعة', c: 'var(--c-due)' },
  { key: 'none', label: 'لم يبدأ بعد', c: 'var(--c-none)' },
];
function dashboard() {
  const v = { both: 0, fahm: 0, hifz: 0, due: 0, none: 0 };
  for (let i = 0; i < TOTAL; i++) {
    const s = state[i];
    if (s & 1) v[isDue(i) ? 'due' : s === 3 ? 'both' : 'hifz']++;
    else v[s === 2 ? 'fahm' : 'none']++;
  }
  const R = 92, SW = 30, C = 2 * Math.PI * R, cx = 130, cy = 130;
  const live = SEGS.filter(s => v[s.key] > 0);
  const gap = live.length > 1 ? 1.6 : 0;
  let off = 0, arcs = '', labels = '';
  live.forEach(s => {
    const len = v[s.key] / TOTAL * C, dash = Math.max(len - gap, 0.6);
    arcs += `<circle class="seg-arc" data-k="${s.key}" cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${s.c}" stroke-width="${SW}"
      stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cy})"/>`;
    if (v[s.key] / TOTAL >= 0.04) {
      const a = (off + len / 2) / C * 2 * Math.PI - Math.PI / 2, rr = R + SW / 2 + 16;
      labels += `<text x="${cx + rr * Math.cos(a)}" y="${cy + rr * Math.sin(a) + 4}" text-anchor="middle" font-size="12" font-weight="700">${pct(v[s.key], TOTAL)}</text>`;
    }
    off += len;
  });
  $('donut').innerHTML = arcs + labels +
    `<text x="${cx}" y="${cy - 14}" text-anchor="middle" font-size="22" style="font-family:Amiri;fill:var(--accent)" font-weight="700">القرآن الكريم</text>` +
    `<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="26" font-weight="700">${pct(v.both, TOTAL)}</text>` +
    `<text x="${cx}" y="${cy + 38}" text-anchor="middle" font-size="12" style="fill:var(--muted)">حفظ وفهم</text>`;
  $('plegend').innerHTML = SEGS.map(s =>
    `<tr><td><i class="sw" style="background:${s.c}"></i> ${s.label}</td><td>${ayat(v[s.key])}</td><td>${pct(v[s.key], TOTAL)}</td></tr>`).join('');

  const all = count(0, TOTAL - 1);
  $('kpis').innerHTML =
    `<div class="kpi"><div class="v">${pct(all.h, TOTAL)}</div><div class="l"><i class="sw" style="background:var(--hifz)"></i> حفظ · ${ayat(all.h)}</div></div>` +
    `<div class="kpi"><div class="v">${pct(all.f, TOTAL)}</div><div class="l"><i class="sw" style="background:var(--fahm)"></i> فهم · ${ayat(all.f)}</div></div>` +
    `<div class="kpi"><div class="v">${pct(all.b, TOTAL)}</div><div class="l"><i class="sw" style="background:var(--both)"></i> كلاهما · ${ayat(all.b)}</div></div>`;
  const act = $('act'), gapDays = today() - all.latest;
  if (!all.h) { act.className = 'act'; act.innerHTML = 'لم تسجّل أي محفوظ بعد — ابدأ من الخريطة 🌱'; }
  else {
    act.className = 'act' + (gapDays >= cycle ? ' late' : '');
    act.innerHTML = `آخر حفظ أو مراجعة: <b>${ayyam(gapDays)}</b>`;
  }

  planCard();
}

// ---------- خطة اليوم: القراءة والحفظ والمراجعة ----------
let hifzToday = [], revToday = [];
function planRow(id, m, goal, detail, done) {
  const el = $(id), n = m.n(today());
  el.querySelector('.pv').innerHTML = goal ? `<b>${ar(n)}</b> / ${m.unit(goal)}` : '';
  el.querySelector('.prog span').style.width = (goal ? Math.min(1, n / goal) * 100 : 0) + '%';
  el.querySelector('.pd').innerHTML = detail;
  el.classList.toggle('done', !!done);
}
function planCard() {
  const t = today(), all = count(0, TOTAL - 1);

  // القراءة
  const rn = readCount(t), rs = streak();
  planRow('planRead', METRICS.read, wird,
    (rn >= wird ? '<span class="done-msg">أتممتَ ورد القراءة ✓</span>' : `بقي ${safahat(wird - rn)}`) +
    (rs ? ` · الأيام المتتالية: ${ar(rs)}` : ''));
  $('hContinue').textContent = `متابعة القراءة من صفحة ${ar(lastPage)}`;

  // الحفظ الجديد
  const hn = hifzCount(t), hs = streakOf(METRICS.hifz), left = TOTAL - all.h;
  hifzToday = nextHifz(hGoal - hn);
  let hd;
  if (!left) hd = '<span class="done-msg">🎉 أتممتَ حفظ القرآن الكريم، تقبّل الله منك</span>';
  else if (!hifzToday.length) {
    const nx = nextHifz(1)[0];
    hd = `<span class="done-msg">أتممتَ ورد الحفظ ✓</span> · غدًا من ${describeAyat([nx])}`;
  } else hd = `ورد اليوم: <span class="tgt">${describeAyat(hifzToday)}</span>`;
  if (left) hd += `<br>بهذا المقدار تُتمّ حفظ القرآن خلال ${duration(Math.ceil(left / hGoal))} تقريبًا` + (hs ? ` · الأيام المتتالية: ${ar(hs)}` : '');
  planRow('planHifz', METRICS.hifz, hGoal, hd, !hifzToday.length);

  // المراجعة
  const q = revQuota(), vn = revCount(t);
  revToday = reviewPortion();
  let vd;
  if (!all.h) vd = 'سجّل محفوظك من الخريطة ليظهر هنا ورد المراجعة اليومي.';
  else if (!revToday.length) vd = vn >= q ? '<span class="done-msg">أتممتَ ورد المراجعة ✓</span>' : '<span class="done-msg">لا مراجعة مستحقة اليوم ✓</span>';
  else vd = `ورد اليوم: <span class="tgt">${describePages(revToday)}</span>`;
  if (all.h) vd += `<br>مراجعة ${ayat(all.h)} كل ${ayyamN(cycle)} = ${ayat(q)} يوميًا`;
  planRow('planRev', METRICS.rev, q, vd, !revToday.length);
}
$('hHifzOpen').onclick = () => hifzToday.length && openReader(pageOf[hifzToday[0]], 'hifz');
$('hHifzDone').onclick = () => {
  if (!hifzToday.length) return;
  applyAct(hifzToday.filter(i => !(state[i] & 1)), 1); save(); refreshAll();
};
$('hRevOpen').onclick = () => revToday.length && openReader(revToday[0], 'rev');
$('hRevDone').onclick = () => {
  if (!revToday.length) return;
  applyReview(pageAyat(revToday)); save(); refreshAll();
};

$('donut').addEventListener('pointermove', e => {
  const a = e.target.closest('.seg-arc');
  if (!a) { tip.style.display = 'none'; return; }
  const k = SEGS.findIndex(x => x.key === a.dataset.k), row = $('plegend').rows[k];
  showTip(e, `${SEGS[k].label}: ${row.cells[1].textContent} (${row.cells[2].textContent})`);
});
$('donut').addEventListener('pointerleave', () => tip.style.display = 'none');

// ---------- المراجعة ----------
function reviewCard() {
  const all = count(0, TOTAL - 1);
  if (!all.h) {
    $('rvSummary').textContent = 'بمجرد أن تسجّل محفوظك ستظهر هنا المواضع التي تحتاج إلى مراجعة.';
    $('rvList').innerHTML = '';
    return;
  }
  const t = today(), groups = GROUPS.suras, due = [];   // ثابتة على السور، لا تتبع عرض الخريطة
  groups.forEach((g, k) => {
    let d = 0, oldest = Infinity;
    for (let i = g.from; i <= g.to; i++) if (isDue(i)) { d++; oldest = Math.min(oldest, rev[i]); }
    if (d) due.push({ k, d, oldest });
  });
  due.sort((a, b) => a.oldest - b.oldest || a.k - b.k);
  $('rvSummary').innerHTML = all.d
    ? `<b class="red">${ayat(all.d)}</b> تحتاج إلى مراجعة (${pct(all.d, all.h)} من محفوظك) · آخر مراجعة: ${ayyam(t - all.latest)}`
    : `محفوظك كله مُراجَع ✓ · آخر مراجعة: ${ayyam(t - all.latest)}`;
  const MAX = 8;
  if (due.length) {
    $('rvList').innerHTML = due.slice(0, MAX).map(x => {
      const g = groups[x.k], name = g.title.replace('سورة ', '');
      return `<button class="chip" data-g="${x.k}"><b>${name}</b><span>${ayat(x.d)} · ${ayyam(t - x.oldest)}</span></button>`;
    }).join('') + (due.length > MAX ? `<span class="more">و${plural(due.length - MAX, 'سورة واحدة', 'سورتان', 'سور', 'سورة')} أخرى</span>` : '');
  } else {
    let next = Infinity;
    for (let i = 0; i < TOTAL; i++) if (state[i] & 1) next = Math.min(next, rev[i] + cycle);
    const dd = next - t;
    $('rvList').innerHTML = `<span class="more">أقرب مراجعة ${dd <= 1 ? 'غدًا' : `بعد ${ayyamN(dd)}`} بإذن الله</span>`;
  }
}
$('rvList').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (c) openGroup('suras', +c.dataset.g, true);
});
// اللوحة تعتمد على عرض الخريطة، فنضبطه أولًا
function openGroup(v, k, selectDue = false) {
  if (view !== v) { view = v; try { localStorage.setItem(KEY + '.view', view); } catch (e) {} renderMap(); }
  openSheet(k, selectDue);
}
$('cycle').value = cycle;
$('cycle').addEventListener('change', e => { cycle = +e.target.value; save(); refreshAll(); });

// ======================================================================
//  المصحف
// ======================================================================
let page = lastPage, readTimer = null, readLeft = 0;
// وضع المصحف: 'read' قراءة الورد، 'hifz' و'rev' جلسة حفظ أو مراجعة لا تُحسب في القراءة ولا تحرّك موضعها
let readerMode = 'read';
const BASMALA = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ';

$('rSura').innerHTML = '<option value="">انتقل إلى سورة…</option>' + SURAS.map((s, k) => `<option value="${k + 1}">${ar(k + 1)}. ${s[0]}</option>`).join('');
$('rJuz').innerHTML = '<option value="">الجزء…</option>' + JUZ.map((_, k) => `<option value="${k + 1}">الجزء ${ar(k + 1)}</option>`).join('');
$('rSura').onchange = e => { if (e.target.value) openReader(pageOf[start[+e.target.value]]); e.target.value = ''; };
$('rJuz').onchange = e => { if (e.target.value) openReader(pageOf[juzB[+e.target.value - 1][0]]); e.target.value = ''; };
$('rPage').onchange = e => openReader(Math.min(PAGES_N, Math.max(1, +e.target.value || 1)));
document.documentElement.style.setProperty('--qfs', fontSize + 'px');
const setFs = d => {
  fontSize = Math.min(40, Math.max(18, fontSize + d));
  document.documentElement.style.setProperty('--qfs', fontSize + 'px'); save();
  if (book) { sizeBook(); window.dispatchEvent(new Event('resize')); }
};
$('fsUp').onclick = () => setFs(2);
$('fsDown').onclick = () => setFs(-2);

// ---------- رسم مصحف المدينة (طبعة 1441) سطرًا بسطر بخطوط مجمع الملك فهد (QPC V2) ----------
// لكل صفحة خط خاص يُحمَّل من مجلد التطبيق عند فتحها؛ وإن تعذّر التحميل يُعرض النص العادي
const HAS_M = typeof M1441 !== 'undefined';
const QCF_URL = p => `fonts/qcf/p${p}.woff2`;   // مضمّنة في التطبيق (tools/fetch_fonts.py)
const qcfLoads = {};
function loadQcf(p) {
  if (!(p >= 1 && p <= PAGES_N)) return Promise.resolve(false);
  return qcfLoads[p] ||= new FontFace(`qcf${p}`, `url(${QCF_URL(p)})`, { display: 'block' }).load()
    .then(f => { document.fonts.add(f); return true; })
    .catch(() => { delete qcfLoads[p]; return false; });   // يُعاد المحاولة لاحقًا
}
// البسملة برسمها في الفاتحة (الصفحة الأولى) دون رقم الآية
const BASM_GLYPHS = HAS_M ? M1441[1].find(r => Array.isArray(r[0]) && r[0][0] === 0)[0][1].split(' ').slice(0, -1) : [];

function ayahCls(i, hifzSet) {
  return isDue(i) ? ' due' : readerMode === 'hifz' && hifzSet.has(i) ? ' h1' : '';
}
function mushafHtml(p, hifzSet) {
  return M1441[p].map(r => {
    if (r[0] === 'h') return `<div class="ml mh"><span>سورة ${SURAS[r[1] - 1][0]}</span></div>`;
    if (r[0] === 'b') return `<div class="ml mb" style="font-family:qcf1">${BASM_GLYPHS.map(g => `<span>${g}</span>`).join('')}</div>`;
    return '<div class="ml">' + r.map(([i, w]) => {
      const c = ayahCls(i, hifzSet);
      return w.split(' ').map(g => `<span class="w${c}" data-i="${i}">${g}</span>`).join('');
    }).join('') + '</div>';
  }).join('');
}
function plainHtml(f, t, hifzSet) {   // احتياطي: نص عادي إن لم يتوفر خط الصفحة
  let html = '';
  for (let i = f; i <= t; i++) {
    const s = suraOf[i], a = ayahOf(i);
    if (a === 1) {
      html += `<div class="sura-h">سورة ${SURAS[s - 1][0]}</div>`;
      if (s !== 1 && s !== 9) html += `<span class="basm">${BASMALA}</span>`;
    }
    html += `<span class="ay${ayahCls(i, hifzSet)}" data-i="${i}">${AYAT[i]}</span> <span class="anum">۝${ar(a)}</span> `;
  }
  return html;
}
// حجم الخط يتبع عرض الصفحة؛ ويُصغَّر إن تجاوز سطرٌ العرض
const QCF_RATIO = 16.4;   // مقيس: أعرض سطر في الصفحات ≈ ١٦٫٣ ضعف حجم الخط
function fitMushaf() {
  const el = $('mtext');
  if (!el.classList.contains('qcf')) return;
  const W = el.clientWidth;
  let fs = W / QCF_RATIO;
  el.style.fontSize = fs + 'px';
  const widest = Math.max(...[...el.querySelectorAll('.ml:not(.mh)')].map(l =>
    [...l.children].reduce((s, c) => s + c.getBoundingClientRect().width, 0)));
  if (widest > W) el.style.fontSize = fs * W / widest * 0.98 + 'px';
}
new ResizeObserver(() => fitMushaf()).observe($('mtext'));

let drawSeq = 0;
async function drawText(p) {
  const seq = ++drawSeq, el = $('mtext'), [f, t] = pageB[p - 1], hifzSet = new Set(hifzToday);
  let ok = false;
  if (HAS_M) {
    if (!qcfLoads[p]) el.classList.add('loading');
    ok = (await Promise.all([loadQcf(p), loadQcf(1)])).every(Boolean);
    if (seq !== drawSeq) return;        // انتقل المستخدم إلى صفحة أخرى أثناء التحميل
  }
  el.classList.remove('loading');
  el.classList.toggle('qcf', ok);
  el.classList.toggle('opening', ok && p <= 2);
  el.style.fontFamily = ok ? `qcf${p}` : '';
  el.style.fontSize = '';
  el.innerHTML = ok ? mushafHtml(p, hifzSet) : plainHtml(f, t, hifzSet);
  fitMushaf();
  [p + 1, p - 1].forEach(loadQcf);      // تحميل مسبق للصفحتين المجاورتين
}
// تظليل الآية كلها عند المرور على أي كلمة منها
$('mtext').addEventListener('pointerover', e => {
  const w = e.target.closest('.w');
  $('mtext').querySelectorAll('.w.hov').forEach(x => x.classList.remove('hov'));
  if (w) $('mtext').querySelectorAll(`.w[data-i="${w.dataset.i}"]`).forEach(x => x.classList.add('hov'));
});
$('mtext').addEventListener('pointerleave', () => $('mtext').querySelectorAll('.w.hov').forEach(x => x.classList.remove('hov')));

// ---------- المصحف كتابًا يُقلَّب (StPageFlip) ----------
// المكتبة مصمّمة للكتب من اليسار إلى اليمين، فنعكس الترتيب: الفهرس ٠ = صفحة ٦٠٤ … الفهرس ٦٠٣ = صفحة ١
// وفي العرض المزدوج تقع الصفحة الفردية يمينًا والزوجية يسارًا كالمصحف المطبوع
const FLIP = HAS_M && typeof St !== 'undefined' && !!St.PageFlip;
const idxOf = p => PAGES_N - p, pageAt = i => PAGES_N - i;
// تُستخدم المكتبة في العرض المزدوج فقط (الشاشات العريضة)؛ فالتقليب للخلف لا يعمل فيها في وضع الصفحة الواحدة.
// وعلى الشاشات الضيقة صفحة واحدة بحركة تقليب بسيطة وسحب بالإصبع في الاتجاهين
let book = null, bookEls = [], bookOn = false;
const wideEnough = () => $('reader').clientWidth - ($('reader').classList.contains('tf-open') ? 408 : 0) >= 680;
// بعد تغيّر المساحة المتاحة (لوحة التفسير): بدّل الوضع إن لزم، وإلا أعِد حساب مقاس الكتاب
function relayoutReader() {
  if (screen === 'reader' && FLIP && wideEnough() !== bookOn) renderPage();
  else window.dispatchEvent(new Event('resize'));
}
const filled = new Map();   // رقم الصفحة ← نسخة الرسم التي رُسمت بها
let paintVer = 0;           // يزيد عند تغيّر الحالة فيُعاد رسم الصفحات

function visiblePages() {
  if (!bookOn) return [page];
  let i = book.getCurrentPageIndex();
  if (book.getOrientation() === 'landscape') {
    i -= i % 2;
    return [pageAt(i + 1), pageAt(i)].filter(p => p >= 1 && p <= PAGES_N);   // اليمنى أولًا
  }
  return [pageAt(i)];
}
function fillPage(p) {
  if (p < 1 || p > PAGES_N || filled.get(p) === paintVer) return;
  filled.set(p, paintVer);
  const el = bookEls[idxOf(p)], [f] = pageB[p - 1], hifzSet = new Set(hifzToday);
  el.innerHTML = `<div class="fpi"><div class="mph"><span>سورة ${SURAS[suraOf[f] - 1][0]}</span><span>الجزء ${ar(juzOf[f])}</span></div>` +
    `<div class="mtext qcf${p <= 2 ? ' opening' : ''} loading" style="font-family:qcf${p}"></div><div class="fpn">${ar(p)}</div></div>`;
  const mt = el.querySelector('.mtext'), ver = paintVer;
  Promise.all([loadQcf(p), loadQcf(1)]).then(([a, b]) => {
    if (filled.get(p) !== ver || el.querySelector('.mtext') !== mt) return;
    mt.classList.remove('loading');
    if (a && b) mt.innerHTML = mushafHtml(p, hifzSet);
    else {   // احتياطي: نص عادي إن تعذّر تحميل خط الصفحة
      mt.classList.remove('qcf', 'opening'); mt.classList.add('plain'); mt.style.fontFamily = '';
      mt.innerHTML = plainHtml(pageB[p - 1][0], pageB[p - 1][1], hifzSet);
    }
  });
}
// حجم الخط من أبعاد الصفحة: ١٥ سطرًا بارتفاع ١٫٦٢ em، وأعرض سطر ≈ QCF_RATIO em
function fitBook() {
  const el = bookEls[idxOf(page)];
  if (!el || !el.clientWidth) return;
  const W = el.clientWidth * 0.92, H = el.clientHeight - 70;
  $('book').style.setProperty('--pfs', Math.min(W / QCF_RATIO, H / (15 * 1.62 + 0.4)) + 'px');
}
function onFlip() {
  if (!bookOn) return;
  const vis = visiblePages(), i = idxOf(vis[0]);
  page = vis[0];
  if (readerMode === 'read') { lastPage = page; save(); }
  for (let k = i - 4; k <= i + 5; k++) if (k >= 0 && k < PAGES_N) fillPage(pageAt(k));
  [Math.min(...vis) - 1, Math.max(...vis) + 1].forEach(loadQcf);
  fitBook();
  updateReaderBar();
  refreshPageActions();
  startReadTimer();
}
// عرض الكتاب بحيث تتسع الصفحة كاملةً لارتفاع النافذة (نسبة الصفحة ٥٢٠:٨٢٠)
function sizeBook() {
  const h = Math.max(420, innerHeight - 200) * fontSize / 26;   // أ− وأ+ تصغّر الكتاب وتكبّره
  $('book').style.maxWidth = Math.round(2 * h * 520 / 820) + 'px';
}
function initBook() {
  const host = $('book');
  host.innerHTML = Array.from({ length: PAGES_N }, () => '<div class="fp"></div>').join('');
  bookEls = [...host.children];
  setBookMode(true);
  book = new St.PageFlip(host, {
    width: 520, height: 820, size: 'stretch', minWidth: 240, maxWidth: 900, minHeight: 380,
    maxHeight: 2400, usePortrait: false, showCover: false,
    drawShadow: true, maxShadowOpacity: 0.35, flippingTime: 750, mobileScrollSupport: true,
    showPageCorners: true, disableFlipByClick: true, clickEventForward: true, startPage: idxOf(page),
  });
  book.loadFromHTML(bookEls);
  sizeBook();                                   // بعد التهيئة، فالمكتبة تضع max-width خاصًا بها
  window.dispatchEvent(new Event('resize'));    // لتعيد المكتبة حساب المقاس
  book.on('flip', onFlip);
  book.on('changeOrientation', () => { filled.clear(); onFlip(); });
  new ResizeObserver(() => fitBook()).observe(host);
}
function updateReaderBar() {
  const vis = visiblePages();
  $('rPage').value = page;
  $('pgPrev').disabled = Math.min(...vis) === 1;
  $('pgNext').disabled = Math.max(...vis) === PAGES_N;
  $('pactLbl').textContent = vis.length > 1 ? 'هاتان الصفحتان:' : 'هذه الصفحة:';
}

// التبديل بين الكتاب والصفحة الواحدة، مع نقل حالة القراءة إلى مكانها
function setBookMode(on) {
  bookOn = on;
  $('reader').classList.toggle('flip', on);
  if (on) $('rstat').append($('readSt'), $('mpToday'));          // تحت الكتاب
  else { $('mpNum').before($('readSt')); $('mpNum').after($('mpToday')); }   // في تذييل الصفحة
}
function renderPage() {
  if (FLIP && screen === 'reader' && wideEnough()) {
    if (!book) initBook();
    else {
      if (!bookOn) setBookMode(true);
      window.dispatchEvent(new Event('resize'));   // ربما كانت الشاشة مخفية أو بعرض آخر فلم يُحسب مقاسها
      if (!visiblePages().includes(page)) book.turnToPage(idxOf(page));
    }
    paintVer++;
    onFlip();
    return;
  }
  if (bookOn) setBookMode(false);
  const [f] = pageB[page - 1];
  drawText(page);
  $('mpSura').textContent = `سورة ${SURAS[suraOf[f] - 1][0]}`;
  $('mpJuz').textContent = `الجزء ${ar(juzOf[f])}`;
  $('mpNum').textContent = ar(page);
  updateReaderBar();
  refreshPageActions();
  startReadTimer();
}

// آيات الصفحات الظاهرة (صفحة أو صفحتان متتاليتان)
function visibleAyat() {
  const vis = visiblePages(), ids = [];
  for (let i = pageB[Math.min(...vis) - 1][0]; i <= pageB[Math.max(...vis) - 1][1]; i++) ids.push(i);
  return ids;
}
function refreshPageActions() {
  const ids = visibleAyat(), c = count(ids[0], ids[ids.length - 1]);
  document.querySelector('[data-pact="1"]').lastChild.textContent = c.h === c.n ? 'إلغاء الحفظ' : 'حفظ';
  document.querySelector('[data-pact="2"]').lastChild.textContent = c.f === c.n ? 'إلغاء الفهم' : 'فهم';
  $('pRev').disabled = !c.h;
  $('mpToday').textContent = `اليوم: ${safahat(readCount(today()))}`;
}

// تُحسب كل صفحة ظاهرة مقروءةً بعد بقائها ١٥ ثانية؛ وفي العرض المزدوج تُحسب اليمنى ثم اليسرى
function startReadTimer() {
  clearInterval(readTimer); readTimer = null;
  const st = $('readSt');
  if (readerMode !== 'read') {
    st.className = 'readst';
    st.textContent = readerMode === 'rev' ? '🔁 جلسة مراجعة · لا تُحسب في ورد القراءة' : '🧠 جلسة حفظ · لا تُحسب في ورد القراءة';
    return;
  }
  const two = visiblePages().length > 1;
  const todo = visiblePages().filter(p => !readOn(today()).includes(p));
  const done = () => { st.className = 'readst ok'; st.textContent = two ? '✓ قُرئتا اليوم' : '✓ قُرئت اليوم'; };
  if (!todo.length) { done(); return; }
  if (screen !== 'reader' || document.hidden) { st.className = 'readst'; st.textContent = ''; return; }
  readLeft = DWELL;
  const tick = () => {
    if (readLeft <= 0) {
      markRead(todo.shift()); save();
      refreshPageActions(); dashboard();
      if (!todo.length) { clearInterval(readTimer); readTimer = null; done(); return; }
      readLeft = DWELL;
    }
    st.className = 'readst';
    const which = !two ? 'القراءة' : todo.length > 1 ? 'الصفحة اليمنى' : 'الصفحة اليسرى';
    st.textContent = `تُسجَّل ${which} بعد ${ar(readLeft)} ث`;
    readLeft--;
  };
  tick();
  readTimer = setInterval(tick, 1000);
}
document.addEventListener('visibilitychange', () => { if (screen === 'reader') startReadTimer(); });

function openReader(p, mode = 'read') {
  readerMode = mode; page = p;
  if (mode === 'read') { lastPage = p; save(); }
  if (screen !== 'reader') showScreen('reader'); else { renderPage(); scrollTo(0, 0); }
}
// d = +١ الصفحة التالية في المصحف (تُقلَّب من اليسار)، و-١ السابقة
function turn(d) {
  if (bookOn) {
    const vis = visiblePages();
    if (d > 0 ? Math.max(...vis) >= PAGES_N : Math.min(...vis) <= 1) return;
    if (d > 0) book.flipPrev('bottom'); else book.flipNext('bottom');
    return;
  }
  const p = page + d;
  if (p < 1 || p > PAGES_N) return;
  page = p;
  if (readerMode === 'read') { lastPage = p; save(); }
  renderPage();
  // حركة تقليب: التالية تنفتح من حافتها اليمنى كورقة المصحف، والسابقة من اليسرى
  const mp = $('mpage');
  mp.classList.remove('turn-next', 'turn-prev'); void mp.offsetWidth;
  mp.classList.add(d > 0 ? 'turn-next' : 'turn-prev');
  scrollTo({ top: 0, behavior: 'smooth' });
}
// عند تغيّر عرض النافذة قد يلزم الانتقال بين الكتاب والصفحة الواحدة
let rzT = null;
addEventListener('resize', e => {
  if (!e.isTrusted || screen !== 'reader' || !FLIP) return;
  if (book) sizeBook();   // يسبق معالج المكتبة لأنه سُجّل قبلها
  clearTimeout(rzT);
  rzT = setTimeout(() => { if (wideEnough() !== bookOn) renderPage(); }, 150);
});
$('pgNext').onclick = () => turn(1);
$('pgPrev').onclick = () => turn(-1);
// السحب باللمس في العرض البسيط: من اليسار إلى اليمين = الصفحة التالية (كتقليب المصحف)
let tx = null;
$('mpage').addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
$('mpage').addEventListener('touchend', e => {
  if (tx === null) return;
  const dx = e.changedTouches[0].clientX - tx; tx = null;
  if (Math.abs(dx) > 60) turn(dx > 0 ? 1 : -1);
});
document.addEventListener('keydown', e => {
  if (screen !== 'reader' || cur >= 0 || e.target.matches('input,select')) return;
  if (e.key === 'ArrowLeft') turn(1);
  else if (e.key === 'ArrowRight') turn(-1);
});
// تظليل الآية كلها عند المرور على كلماتها داخل الكتاب
$('book').addEventListener('pointerover', e => {
  const w = e.target.closest('.w');
  $('book').querySelectorAll('.w.hov').forEach(x => x.classList.remove('hov'));
  if (w) w.closest('.mtext').querySelectorAll(`.w[data-i="${w.dataset.i}"]`).forEach(x => x.classList.add('hov'));
});

document.querySelectorAll('[data-pact]').forEach(b => b.onclick = () => {
  applyAct(visibleAyat(), +b.dataset.pact); save(); refreshAll(); renderPage();
});
$('pRev').onclick = () => { applyReview(visibleAyat()); save(); refreshAll(); renderPage(); };
$('pOpen').onclick = () => openGroup('pages', page - 1);
['hContinue', 'wContinue'].forEach(id => $(id).onclick = () => openReader(lastPage));

// ======================================================================
//  متابعة الورد
// ======================================================================
$('wirdSel').value = wird;
$('hGoalSel').value = hGoal;
$('hDirSel').value = hDir;
$('wirdSel').onchange = e => { wird = +e.target.value; save(); refreshAll(); };

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const dayDate = d => new Date(d * 864e5);   // UTC بالضبط عند منتصف ليل اليوم المحلي
const dayLabel = d => { const x = dayDate(d); return `${DAYS[x.getUTCDay()]} ${ar(x.getUTCDate())}/${ar(x.getUTCMonth() + 1)}`; };

function wirdScreen() {
  const t = today(), n = readCount(t), p = Math.min(1, n / wird);
  $('wToday').innerHTML =
    `<div class="wbig">${ar(n)} <small>من ${safahat(wird)}</small></div>` +
    `<div class="prog"><span style="width:${p * 100}%"></span></div>` +
    `<div style="font-size:14px">${n >= wird ? '<span class="done-msg">أتممتَ وردك اليوم ✓ تقبّل الله منك</span>' : `بقي ${safahat(wird - n)} لإتمام الورد`}</div>`;
  $('wPlan').textContent = `بهذا الورد تختم القرآن كل ${ayyamN(Math.ceil(PAGES_N / wird))} تقريبًا.`;
  $('wContinue').textContent = `متابعة القراءة من صفحة ${ar(lastPage)}`;

  // الختمة
  const kp = khatmaPages().size, last7 = [...Array(7)].reduce((s, _, k) => s + readCount(t - k), 0) / 7;
  const rate = last7 > 0 ? last7 : wird, left = PAGES_N - kp;
  $('wKhatma').innerHTML =
    `<div class="wbig">${pct(kp, PAGES_N)} <small>${ar(kp)} من ${ar(PAGES_N)} صفحة</small></div>` +
    `<div class="prog"><span style="width:${kp / PAGES_N * 100}%;background:var(--both)"></span></div>` +
    `<div style="font-size:14px">${left === 0 ? '<span class="done-msg">🎉 أتممتَ الختمة، تقبّل الله منك</span>'
      : `${last7 > 0 ? 'بمعدلك الحالي' : 'بوردك الحالي'} تُتمّ الختمة خلال ${ayyamN(Math.ceil(left / rate))} تقريبًا`}</div>` +
    `<div class="muted" style="font-size:12px;margin-top:4px">بدأت هذه الختمة ${ayyam(t - khatmaStart)}</div>`;

  // ورد الحفظ: الموضع والمقدار والمدة المتوقعة
  const all = count(0, TOTAL - 1), hn = hifzCount(t), hLeft = TOTAL - all.h, nx = nextHifz(1)[0];
  // معدل الأسبوع لا يُعتمد إلا بعد ثلاثة أيام حفظ على الأقل، وإلا فالورد المختار
  const last7h = [...Array(7)].map((_, k) => hifzCount(t - k));
  const h7 = last7h.filter(Boolean).length >= 3 ? last7h.reduce((a, b) => a + b, 0) / 7 : 0;
  $('wHifz').innerHTML = hLeft
    ? `<div class="wbig">${ar(hn)} <small>من ${ayat(hGoal)} اليوم</small></div>` +
      `<div class="prog"><span style="width:${Math.min(1, hn / hGoal) * 100}%;background:var(--hifz)"></span></div>` +
      `<div style="font-size:14px">موضعك في الحفظ: <b style="font-family:Amiri,serif;font-size:16px">${describeAyat([nx])}</b></div>` +
      `<div class="muted" style="font-size:13px;margin-top:4px">بقي ${ayat(hLeft)} · ` +
      (h7 > 0 ? `بمعدلك في آخر أسبوع تُتمّ الحفظ خلال ${duration(Math.ceil(hLeft / h7))}` : `بهذا الورد تُتمّ الحفظ خلال ${duration(Math.ceil(hLeft / hGoal))}`) + ' تقريبًا</div>'
    : '<div class="done-msg">🎉 أتممتَ حفظ القرآن الكريم، تقبّل الله منك</div>';

  // ورد المراجعة
  const q = revQuota(), vn = revCount(t);
  $('wRev').innerHTML = all.h
    ? `<div class="wbig">${ar(vn)} <small>من ${ayat(q)} اليوم</small></div>` +
      `<div class="prog"><span style="width:${Math.min(1, vn / q) * 100}%;background:var(--both)"></span></div>` +
      `<div style="font-size:14px">${all.d ? `<b class="red">${ayat(all.d)}</b> مستحقة للمراجعة الآن` : 'لا مراجعة مستحقة الآن ✓'}</div>` +
      `<div class="muted" style="font-size:13px;margin-top:4px">مقدار المراجعة اليومي = محفوظك (${ayat(all.h)}) ÷ ${ayyamN(cycle)}</div>`
    : '<div class="muted" style="font-size:14px">سجّل محفوظك من الخريطة ليُحسب ورد المراجعة اليومي تلقائيًا.</div>';

  metricPanel();
}

// ---------- آخر ٣٠ يومًا لكل ورد ----------
let metric = 'read';
const KPI_TXT = {
  read: ['أيام متتالية أتممت فيها ورد القراءة', 'متوسط الصفحات يوميًا (آخر ٧ أيام)', 'صفحة قرأتها في آخر ٣٠ يومًا', 'يومًا أتممت فيه ورد القراءة'],
  hifz: ['أيام متتالية أتممت فيها ورد الحفظ', 'متوسط الآيات المحفوظة يوميًا (آخر ٧ أيام)', 'آية حفظتها في آخر ٣٠ يومًا', 'يومًا أتممت فيه ورد الحفظ'],
  rev:  ['أيام متتالية أتممت فيها ورد المراجعة', 'متوسط الآيات المُراجَعة يوميًا (آخر ٧ أيام)', 'آية راجعتها في آخر ٣٠ يومًا', 'يومًا أتممت فيه ورد المراجعة'],
};
function metricPanel() {
  const m = METRICS[metric], goal = m.goal(), t = today(), L = KPI_TXT[metric];
  const days = [...Array(30)].map((_, k) => t - 29 + k), counts = days.map(m.n);
  const total = counts.reduce((a, b) => a + b, 0), met = goal ? counts.filter(c => c >= goal).length : 0;
  const avg7 = counts.slice(-7).reduce((a, b) => a + b, 0) / 7;
  $('wKpis').innerHTML =
    `<div class="kpi"><div class="v">${ar(streakOf(m, goal))}</div><div class="l">${L[0]}</div></div>` +
    `<div class="kpi"><div class="v">${ar(+avg7.toFixed(1))}</div><div class="l">${L[1]}</div></div>` +
    `<div class="kpi"><div class="v">${ar(total)}</div><div class="l">${L[2]}</div></div>` +
    `<div class="kpi"><div class="v">${ar(met)}/${ar(30)}</div><div class="l">${L[3]}</div></div>`;
  document.querySelectorAll('#metricSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === metric));
  drawChart(days, counts, goal);
}
$('metricSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  metric = b.dataset.m; metricPanel();
});
$('hGoalSel').onchange = e => { hGoal = +e.target.value; save(); refreshAll(); };
$('hDirSel').onchange = e => { hDir = e.target.value; save(); refreshAll(); };

// رسم أعمدة: الزمن من اليمين (الأقدم) إلى اليسار (اليوم)، وخط متقطع لمقدار الورد
function drawChart(days, counts, goal) {
  const W = 640, H = 230, padR = 40, padL = 8, padT = 12, padB = 26;
  const max = Math.max(goal, ...counts, 1);
  // خطوة «لطيفة» للمحور بحيث لا تزيد الخطوط على ستة
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].find(s => max * 1.15 / s <= 6) || 5000;
  const top = Math.ceil(max * 1.15 / step) * step;
  const iw = W - padR - padL, ih = H - padT - padB, bw = iw / days.length;
  const y = v => padT + ih - v / top * ih;
  const xOf = k => W - padR - (k + 1) * bw;      // k=0 الأقدم على اليمين
  let g = '';
  for (let v = 0; v <= top; v += step) {
    g += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>` +
         `<text x="${W - padR + 6}" y="${y(v) + 4}" text-anchor="start">${ar(v)}</text>`;
  }
  let bars = '', hits = '';
  counts.forEach((c, k) => {
    const x = xOf(k) + 2, w = Math.max(2, bw - 4);
    if (c > 0) {
      const h = Math.max(3, y(0) - y(c)), r = Math.min(4, w / 2, h);
      const yy = y(0) - h;   // عمود بحافة علوية مستديرة وقاعدة مستقيمة على خط الصفر
      bars += `<path d="M${x},${y(0)} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + w - r} Q${x + w},${yy} ${x + w},${yy + r} V${y(0)} Z" fill="${goal && c >= goal ? 'var(--accent)' : 'var(--bar-low)'}"/>`;
    }
    hits += `<rect class="hit" data-k="${k}" x="${xOf(k)}" y="${padT}" width="${bw}" height="${ih}"/>`;
    if (k % 5 === 4 || k === counts.length - 1) {
      const dt = dayDate(days[k]);
      g += `<text x="${xOf(k) + bw / 2}" y="${H - 8}" text-anchor="middle">${k === counts.length - 1 ? 'اليوم' : `${ar(dt.getUTCDate())}/${ar(dt.getUTCMonth() + 1)}`}</text>`;
    }
  });
  const wy = y(goal);
  const line = goal ? `<line x1="${padL}" x2="${W - padR}" y1="${wy}" y2="${wy}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="5 4" opacity=".7"/>` : '';
  $('chart').innerHTML = g + bars + line + hits;
  $('chart').dataset.days = JSON.stringify(days);
}
$('chart').addEventListener('pointermove', e => {
  const h = e.target.closest('.hit');
  if (!h) { tip.style.display = 'none'; return; }
  const m = METRICS[metric], goal = m.goal();
  const d = JSON.parse($('chart').dataset.days)[+h.dataset.k], c = m.n(d);
  showTip(e, `${dayLabel(d)}: ${c ? m.unit(c) : 'لا شيء'}${goal && c >= goal ? ' ✓' : ''}`);
});
$('chart').addEventListener('pointerleave', () => tip.style.display = 'none');

$('mLog').onclick = () => {
  const a = +$('mFrom').value, b = +$('mTo').value || a;
  if (!a || a < 1 || a > PAGES_N || b < 1 || b > PAGES_N) { $('mMsg').textContent = 'أدخل أرقام صفحات بين ١ و٦٠٤'; return; }
  const [lo, hi] = a < b ? [a, b] : [b, a], d = today() - +$('mDay').value;
  let added = 0;
  for (let p = lo; p <= hi; p++) if (markRead(p, d)) added++;
  if (hi >= lastPage) lastPage = Math.min(PAGES_N, hi + 1);
  save(); refreshAll();
  $('mMsg').textContent = added ? `سُجّلت ${safahat(added)} ✓` : 'هذه الصفحات مسجّلة من قبل';
};
$('newKhatma').onclick = () => {
  if (!confirm('ستبدأ ختمة جديدة من اليوم، ويبقى سجل قراءتك السابق محفوظًا. هل تريد المتابعة؟')) return;
  khatmaStart = today(); lastPage = 1; save(); refreshAll();
};

// ======================================================================
//  الخريطة
// ======================================================================
let view = 'suras';
try { view = localStorage.getItem(KEY + '.view') || 'suras'; } catch (e) {}
if (!GROUPS[view]) view = 'suras';
const mapEl = $('map');
let blkEls = [];

function tile(k) {
  if (view === 'suras') {
    const s = SURAS[k];
    return `<button class="t" data-g="${k}"><span class="no">${ar(k + 1)}</span><span class="nm">${s[0]}</span><span class="mt">${ayat(s[1])}</span></button>`;
  }
  if (view === 'juz') {
    return `<button class="t" data-g="${k}"><span class="nm">${ar(k + 1)}</span><span class="mt">${GROUPS.juz[k].meta.replace('سورة ', '')}</span></button>`;
  }
  return `<button class="t" data-g="${k}">${ar(k + 1)}</button>`;
}
function renderMap() {
  const groups = GROUPS[view];
  let html = '';
  if (view === 'pages') {
    const rows = [];
    groups.forEach((g, k) => (rows[juzOf[g.from]] ||= []).push(tile(k)));
    html = rows.map((r, j) => r ? `<div class="prow"><span class="jl">${ar(j)}</span><div class="ps">${r.join('')}</div></div>` : '').join('');
  } else html = groups.map((_, k) => tile(k)).join('');
  mapEl.className = view + (picking ? ' picking' : '');
  mapEl.innerHTML = html;
  blkEls = [...mapEl.querySelectorAll('.t')];
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  refreshAll();
}
// تمتلئ البطاقة من الأسفل: ذهبي (حفظ وفهم) ← أزرق (حفظ) ← أحمر (يحتاج إلى مراجعة) ← أخضر (فهم)
function paintBlock(k) {
  const g = GROUPS[view][k];
  let gold = 0, blue = 0, red = 0, green = 0;
  for (let i = g.from; i <= g.to; i++) {
    const s = state[i];
    if (s & 1) { if (isDue(i)) red++; else if (s === 3) gold++; else blue++; }
    else if (s === 2) green++;
  }
  const n = g.to - g.from + 1, p1 = gold / n * 100, p2 = p1 + blue / n * 100, p3 = p2 + red / n * 100, p4 = p3 + green / n * 100;
  blkEls[k].style.background = p4 === 0 ? '' :
    `linear-gradient(to top, var(--tb) 0 ${p1}%, var(--th) ${p1}% ${p2}%, var(--tr) ${p2}% ${p3}%, var(--tf) ${p3}% ${p4}%, var(--tile) ${p4}%)`;
  blkEls[k].classList.toggle('full', gold === n);
}
$('views').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  view = b.dataset.v;
  try { localStorage.setItem(KEY + '.view', view); } catch (e) {}
  picked.clear();
  renderMap();
});

// ---------- التحديد المتعدد ----------
let picking = false, picked = new Set(), pickAnchor = -1, pdrag = null, lastPtr = 'mouse';
const UNITS = { suras: ['سورة واحدة', 'سورتان', 'سور', 'سورة', 'السور'], pages: ['صفحة واحدة', 'صفحتان', 'صفحات', 'صفحة', 'الصفحات'], juz: ['جزء واحد', 'جزآن', 'أجزاء', 'جزءًا', 'الأجزاء'] };
const units = n => { const u = UNITS[view]; return plural(n, u[0], u[1], u[2], u[3]); };

function setPicking(on) {
  picking = on;
  if (!on) picked.clear();
  $('pickBtn').classList.toggle('on', on);
  $('pickBtn').textContent = on ? '✓ إنهاء التحديد' : '☑ تحديد متعدد';
  mapEl.classList.toggle('picking', on);
  $('bulk').classList.toggle('on', on);
  document.body.classList.toggle('bulk-on', on);
  refreshBulk();
}
$('pickBtn').onclick = () => setPicking(!picking);

function pickedAyat() {
  const ids = [];
  picked.forEach(k => { const g = GROUPS[view][k]; for (let i = g.from; i <= g.to; i++) ids.push(i); });
  return ids;
}
function refreshBulk() {
  blkEls.forEach((el, k) => el.classList.toggle('picked', picked.has(k)));
  if (!picking) return;
  const ids = pickedAyat(), n = picked.size;
  $('bCnt').textContent = n ? `المحدد: ${units(n)} (${ayat(ids.length)})`
    : `اضغط على ${UNITS[view][4]} التي تريد تسجيلها، أو اسحب عليها بالفأرة، أو اكتب نطاقًا من رقم إلى رقم`;
  document.querySelectorAll('[data-bact]').forEach(b => b.disabled = !n);
  const all = bit => ids.length && ids.every(i => state[i] & bit);
  document.querySelector('[data-bact="1"]').lastChild.textContent = all(1) ? 'إلغاء الحفظ' : 'حفظ';
  document.querySelector('[data-bact="2"]').lastChild.textContent = all(2) ? 'إلغاء الفهم' : 'فهم';
  $('bRev').disabled = !ids.some(i => state[i] & 1);
  $('bClear').disabled = !n;
  const max = GROUPS[view].length;
  $('bFrom').max = $('bTo').max = max;
  $('bFrom').placeholder = '١'; $('bTo').placeholder = ar(max);
}
function pickRange(a, b, adding) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  for (let k = lo; k <= hi; k++) adding ? picked.add(k) : picked.delete(k);
}
mapEl.addEventListener('pointerdown', e => {
  lastPtr = e.pointerType;
  const t = e.target.closest('.t');
  if (!picking || !t || e.pointerType !== 'mouse') return;
  e.preventDefault();
  const k = +t.dataset.g;
  if (e.shiftKey && pickAnchor >= 0) { pickRange(pickAnchor, k, true); refreshBulk(); return; }
  pdrag = { start: k, adding: !picked.has(k), base: new Set(picked) };
  pickAnchor = k;
  picked = new Set(pdrag.base); pickRange(k, k, pdrag.adding); refreshBulk();
});
window.addEventListener('pointermove', e => {
  if (!pdrag) return;
  const t = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.t');
  if (!t) return;
  picked = new Set(pdrag.base); pickRange(pdrag.start, +t.dataset.g, pdrag.adding); refreshBulk();
});
window.addEventListener('pointerup', () => pdrag = null);
mapEl.addEventListener('click', e => {
  const b = e.target.closest('.t'); if (!b) return;
  const k = +b.dataset.g;
  if (!picking) { openSheet(k); return; }
  if (lastPtr === 'mouse') return;
  picked.has(k) ? picked.delete(k) : picked.add(k);
  pickAnchor = k; refreshBulk();
});
$('bRange').onclick = () => {
  const max = GROUPS[view].length;
  const a = Math.max(1, Math.min(max, +$('bFrom').value || 1)), b = Math.max(1, Math.min(max, +$('bTo').value || a));
  pickRange(a - 1, b - 1, true); refreshBulk();
};
$('bClear').onclick = () => { picked.clear(); refreshBulk(); };
document.querySelectorAll('[data-bact]').forEach(b => b.addEventListener('click', () => {
  applyAct(pickedAyat(), +b.dataset.bact); picked.clear(); save(); refreshAll();
}));
$('bRev').onclick = () => { applyReview(pickedAyat()); picked.clear(); save(); refreshAll(); };

// ---------- تطبيق التسجيل (مشترك) ----------
function applyAct(ids, act) {
  let op;
  if (act === 0) op = () => 0;
  else if (act === 3) op = () => 3;
  else op = ids.every(i => state[i] & act) ? v => v & ~act : v => v | act;
  // ما يُسجَّل من الخريطة محفوظٌ سابق؛ وما يُسجَّل من الرئيسية أو المصحف حفظٌ جديد يُحسب في ورد اليوم
  const t = today(), fresh = screen !== 'mapScreen';
  const todayH = new Set(hifzLog[t] || []);
  ids.forEach(i => {
    const was = state[i] & 1;
    state[i] = op(state[i]);
    if (!(state[i] & 1)) { rev[i] = 0; todayH.delete(i); }
    else if (!was) { rev[i] = t; if (fresh) todayH.add(i); }
  });
  if (todayH.size) hifzLog[t] = [...todayH]; else delete hifzLog[t];
}
// تُحسب الآية مرة واحدة في اليوم، ولا يُعدّ الحفظ الجديد مراجعة
function applyReview(ids) {
  const t = today();
  let n = 0;
  ids.forEach(i => { if ((state[i] & 1) && rev[i] !== t) { rev[i] = t; n++; } });
  if (n) revLog[t] = (revLog[t] || 0) + n;
  return n;
}

// ---------- التلميح ----------
const tip = $('tip');
function showTip(e, text) {
  if (e.pointerType === 'touch') return;
  tip.textContent = text;
  tip.style.display = 'block';
  tip.style.left = Math.max(8, Math.min(e.clientX - tip.offsetWidth / 2, innerWidth - tip.offsetWidth - 8)) + 'px';
  tip.style.top = (e.clientY + 18) + 'px';
}
mapEl.addEventListener('pointermove', e => {
  const b = e.target.closest('.t');
  if (!b) { tip.style.display = 'none'; return; }
  const g = GROUPS[view][+b.dataset.g], c = count(g.from, g.to);
  showTip(e, `${g.title} · حفظ ${pct(c.h, c.n)} · فهم ${pct(c.f, c.n)}` + (c.d ? ` · ${ayat(c.d)} تحتاج إلى مراجعة` : ''));
});
mapEl.addEventListener('pointerleave', () => tip.style.display = 'none');

// ======================================================================
//  لوحة الآيات
// ======================================================================
const sheet = $('sheet'), body = $('sBody');
let cur = -1, aEls = [], sel = new Set(), anchor = -1;

function openSheet(k, selectDue = false) {
  cur = k; sel.clear(); anchor = -1;
  const g = GROUPS[view][k];
  $('sTitle').textContent = g.title;
  $('sMeta').textContent = g.meta;
  let html = '', last = 0;
  for (let i = g.from; i <= g.to; i++) {
    if (suraOf[i] !== last && GROUPS[view] !== GROUPS.suras) {
      html += (last ? '</div>' : '') + `<div class="sname">سورة ${SURAS[suraOf[i] - 1][0]}</div><div class="ayat">`;
    } else if (!last) html += '<div class="ayat">';
    last = suraOf[i];
    html += `<span class="a" data-i="${i}">${ar(ayahOf(i))}</span>`;
    if (selectDue && isDue(i)) sel.add(i);
  }
  body.innerHTML = html + '</div>';
  aEls = [];
  body.querySelectorAll('.a').forEach(el => aEls[+el.dataset.i] = el);
  body.scrollTop = 0;
  $('prev').disabled = k === 0;
  $('next').disabled = k === GROUPS[view].length - 1;
  sheet.classList.add('open');
  tip.style.display = 'none';
  refreshSheet();
}
function closeSheet() {
  sheet.classList.remove('open'); cur = -1;
  if (screen === 'reader') renderPage();
}
function refreshSheet() {
  if (cur < 0) return;
  const g = GROUPS[view][cur], c = count(g.from, g.to), t = today();
  $('gStats').innerHTML =
    `<span><i class="sw" style="background:var(--hifz)"></i> حفظ ${ar(c.h)} / ${ar(c.n)}</span>` +
    `<span><i class="sw" style="background:var(--fahm)"></i> فهم ${ar(c.f)} / ${ar(c.n)}</span>` +
    `<span><i class="sw" style="background:var(--both)"></i> كلاهما ${ar(c.b)} / ${ar(c.n)}</span>` +
    (c.h ? `<span class="${c.d ? 'red' : ''}">🔁 ${c.d ? `${ayat(c.d)} تحتاج إلى مراجعة` : 'مُراجَعة'} · آخر مراجعة: ${ayyam(t - c.latest)}</span>` : '');
  for (let i = g.from; i <= g.to; i++) {
    const el = aEls[i];
    el.className = `a s${state[i]}${isDue(i) ? ' due' : ''}${sel.has(i) ? ' sel' : ''}`;
    el.title = `${SURAS[suraOf[i] - 1][0]} ${ar(ayahOf(i))}` + ((state[i] & 1) ? ` · آخر مراجعة: ${ayyam(t - rev[i])}` : '');
  }
  const n = sel.size, ids = [...sel];
  $('cnt').textContent = n ? `المحدد: ${ayat(n)}` : 'حدّد آيات لتسجيلها';
  const all = bit => n && ids.every(i => state[i] & bit);
  document.querySelectorAll('[data-act]').forEach(b => b.disabled = !n);
  document.querySelector('[data-act="1"]').lastChild.textContent = all(1) ? 'إلغاء الحفظ' : 'حفظ';
  document.querySelector('[data-act="2"]').lastChild.textContent = all(2) ? 'إلغاء الفهم' : 'فهم';
  $('revBtn').disabled = !ids.some(i => state[i] & 1);
  const tf = $('tafsir'), one = n === 1 ? ids[0] : -1;
  tf.style.display = one < 0 ? 'none' : '';
  if (one >= 0) tf.href = `https://quran.com/ar/${suraOf[one]}:${ayahOf(one)}/tafsirs/ar-tafsir-muyassar`;
  $('selAll').textContent = n === c.n ? 'إلغاء التحديد' : 'تحديد الكل';
}

let drag = null;
body.addEventListener('pointerdown', e => {
  const a = e.target.closest('.a'); if (!a) return;
  e.preventDefault();
  const i = +a.dataset.i;
  if (e.shiftKey && anchor >= 0) { rangeSel(anchor, i, true); refreshSheet(); return; }
  drag = { start: i, adding: !sel.has(i), base: new Set(sel) };
  anchor = i;
  dragTo(i);
});
function rangeSel(a, b, adding) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  for (let i = lo; i <= hi; i++) adding ? sel.add(i) : sel.delete(i);
}
function dragTo(i) { sel = new Set(drag.base); rangeSel(drag.start, i, drag.adding); refreshSheet(); }
window.addEventListener('pointermove', e => {
  if (!drag) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (el && el.classList.contains('a')) dragTo(+el.dataset.i);
});
window.addEventListener('pointerup', () => drag = null);

function afterChange() { sel.clear(); save(); refreshAll(); refreshSheet(); }
document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => { applyAct([...sel], +b.dataset.act); afterChange(); }));
$('revBtn').onclick = () => { applyReview([...sel]); afterChange(); };
$('selAll').onclick = () => {
  const g = GROUPS[view][cur];
  if (sel.size === g.to - g.from + 1) sel.clear();
  else for (let i = g.from; i <= g.to; i++) sel.add(i);
  refreshSheet();
};
$('toReader').onclick = () => {
  const g = GROUPS[view][cur], first = sel.size ? Math.min(...sel) : g.from;
  sheet.classList.remove('open'); cur = -1;
  openReader(pageOf[first]);
};
$('close').onclick = closeSheet;
$('prev').onclick = () => cur > 0 && openSheet(cur - 1);
$('next').onclick = () => cur < GROUPS[view].length - 1 && openSheet(cur + 1);
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
document.addEventListener('keydown', e => {
  if (cur < 0) return;
  if (e.key === 'Escape') closeSheet();
  else if (e.key === 'ArrowRight') $('prev').click();
  else if (e.key === 'ArrowLeft') $('next').click();
});

// ======================================================================
//  التفسير: اضغط على أي آية في المصحف ليظهر تفسيرها
// ======================================================================
// الميسر مضمَّن في التطبيق؛ وبقية التفاسير تُنزَّل من Quran.com لكل سورة أو كاملة وتُحفظ في IndexedDB
const TAFASIR = [
  { id: 16, name: 'التفسير الميسر', builtin: true },
  { id: 91, name: 'تفسير السعدي' },
  { id: 14, name: 'تفسير ابن كثير' },
  { id: 15, name: 'تفسير الطبري' },
  { id: 90, name: 'تفسير القرطبي' },
  { id: 94, name: 'تفسير البغوي' },
  { id: 93, name: 'التفسير الوسيط' },
];
const tfName = id => TAFASIR.find(t => t.id === id)?.name || '';
let tfId = 16, tfAyah = -1;
try { tfId = +localStorage.getItem(KEY + '.tf') || 16; } catch (e) {}
if (!TAFASIR.some(t => t.id === tfId)) tfId = 16;

// مخزن بسيط فوق IndexedDB: المفتاح «رقم التفسير:رقم السورة» والقيمة مصفوفة نصوص آياتها
const tfDb = (() => {
  let p = null;
  const open = () => p ||= new Promise((res, rej) => {
    const r = indexedDB.open('quranMap', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('tafsir');
    r.onsuccess = () => res(r.result);
    r.onerror = () => { p = null; rej(r.error); };
  });
  const run = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const t = db.transaction('tafsir', mode), req = fn(t.objectStore('tafsir'));
    t.oncomplete = () => res(req.result);
    t.onerror = () => rej(t.error);
  }));
  return {
    get: k => run('readonly', s => s.get(k)),
    put: (k, v) => run('readwrite', s => s.put(v, k)),
    del: k => run('readwrite', s => s.delete(k)),
    keys: () => run('readonly', s => s.getAllKeys()),
  };
})();
const tfHave = new Set();   // «رقم:سورة» المنزَّلة
const tfReady = tfDb.keys().then(ks => ks.forEach(k => tfHave.add(k))).catch(() => {});

// الميسر يُحمَّل عند أول حاجة إليه (نحو ٢ ميجا)
let muyassarP = null;
const loadMuyassar = () => muyassarP ||= new Promise((res, rej) => {
  if (typeof TAFSIR_MUYASSAR !== 'undefined') return res();
  const s = document.createElement('script');
  s.src = 'tafsir-muyassar.js';
  s.onload = () => res();
  s.onerror = () => { muyassarP = null; rej(); };
  document.head.append(s);
});

// يحوّل HTML القادم من الخادم إلى نص خالص (DOMParser لا ينفّذ أي سكربت)
function cleanTafsir(h) {
  const d = new DOMParser().parseFromString(`<body>${h || ''}</body>`, 'text/html');
  d.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
  d.querySelectorAll('p,div,h1,h2,h3,h4,h5,li').forEach(e => e.append('\n'));
  return d.body.textContent.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
const escHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// نص تفسير الآية؛ وإن فسّرها المفسّر ضمن مجموعة آيات يُعاد تفسير أول المجموعة
async function tafsirOf(id, i) {
  const s = suraOf[i], a = ayahOf(i);
  let arr;
  if (id === 16) { await loadMuyassar(); arr = TAFSIR_MUYASSAR.slice(start[s], start[s] + SURAS[s - 1][1]); }
  else arr = await tfDb.get(`${id}:${s}`);
  if (!arr) return null;
  let k = a - 1;
  while (k > 0 && !arr[k]) k--;
  return { text: arr[k] || '', from: k + 1, a };
}

async function fetchSura(id, s) {
  const texts = Array(SURAS[s - 1][1]).fill('');
  for (let page = 1; page;) {
    const r = await fetch(`https://api.quran.com/api/v4/tafsirs/${id}/by_chapter/${s}?per_page=50&page=${page}`);
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    d.tafsirs.forEach(x => { texts[+x.verse_key.split(':')[1] - 1] = cleanTafsir(x.text); });
    page = d.pagination.next_page;
  }
  await tfDb.put(`${id}:${s}`, texts);
  tfHave.add(`${id}:${s}`);
}

// ---------- اللوحة ----------
const tfStyle = document.createElement('style');
document.head.append(tfStyle);
function openTafsir(i) {
  tfAyah = i;
  tfStyle.textContent = `.w[data-i="${i}"]{background:color-mix(in srgb,var(--both) 32%,transparent)!important}`;
  if ($('tafsir').hidden) {
    $('tafsir').hidden = false;
    $('reader').classList.add('tf-open');
    relayoutReader();   // ليُعاد حساب مقاس الكتاب بجوار اللوحة
  }
  drawTafsir();
}
function closeTafsir() {
  $('tafsir').hidden = true;
  $('reader').classList.remove('tf-open');
  tfStyle.textContent = '';
  tfAyah = -1;
  relayoutReader();
}
let tfSeq = 0;
async function drawTafsir() {
  const i = tfAyah, seq = ++tfSeq;
  if (i < 0) return;
  const s = suraOf[i], a = ayahOf(i);
  $('tfRef').textContent = `${SURAS[s - 1][0]} · الآية ${ar(a)}`;
  $('tfAyah').textContent = AYAT[i];
  $('tfPrev').disabled = i === 0;
  $('tfNext').disabled = i === TOTAL - 1;
  $('tfSel').innerHTML = TAFASIR.filter(t => t.builtin || [...tfHave].some(k => k.startsWith(t.id + ':')))
    .map(t => `<option value="${t.id}"${t.id === tfId ? ' selected' : ''}>${t.name}</option>`).join('');
  if (!$('tfSel').value) $('tfSel').value = tfId = 16;
  const fahm = (state[i] & 2) !== 0;
  $('tfFahm').textContent = fahm ? 'إلغاء «فهمتُها»' : 'فهمتُ هذه الآية ✓';
  $('tfFahm').classList.toggle('pri', !fahm);
  $('tfState').textContent = fahm ? '✓ مسجّلة في «فهم»' : '';
  const body = $('tfBody');
  body.innerHTML = '<span class="muted">جارٍ التحميل…</span>';
  let r = null;
  try { r = await tafsirOf(tfId, i); } catch (e) {}
  if (seq !== tfSeq) return;
  if (!r && tfId === 16) { body.innerHTML = '<span class="red">تعذّر تحميل ملف التفسير الميسر.</span>'; return; }
  if (!r) {
    body.innerHTML = `<div class="muted">تفسير هذه السورة غير منزَّل من «${escHtml(tfName(tfId))}».</div>` +
      `<button class="btn" id="tfGetHere" style="margin-top:8px">تحميل تفسير سورة ${SURAS[s - 1][0]}</button>`;
    $('tfGetHere').onclick = async () => {
      body.innerHTML = '<span class="muted">جارٍ التنزيل…</span>';
      try { await fetchSura(tfId, s); } catch (e) { body.innerHTML = '<span class="red">تعذّر التنزيل؛ تحقّق من الاتصال بالإنترنت.</span>'; return; }
      drawTafsir();
    };
    return;
  }
  const note = r.from !== r.a ? `<div class="tfnote">تفسير هذه الآية ضمن تفسير الآيات من ${ar(r.from)}</div>` : '';
  body.innerHTML = note + (r.text
    ? `<div class="tftxt">${escHtml(r.text)
        .replace(/\(([^()\n]{1,90})\)/g, '<span class="tq">($1)</span>')
        .replace(/\{([^{}\n]{1,120})\}/g, '<span class="tq">﴿$1﴾</span>')}</div>`
    : '<span class="muted">لا يوجد نص لهذه الآية في هذا التفسير.</span>');
  body.scrollTop = 0;
}
$('tfClose').onclick = closeTafsir;
$('tfPrev').onclick = () => { if (tfAyah > 0) openTafsir(tfAyah - 1); };
$('tfNext').onclick = () => { if (tfAyah < TOTAL - 1) openTafsir(tfAyah + 1); };
$('tfSel').onchange = e => {
  tfId = +e.target.value;
  try { localStorage.setItem(KEY + '.tf', tfId); } catch (err) {}
  drawTafsir();
};
$('tfFahm').onclick = () => {
  if (tfAyah < 0) return;
  applyAct([tfAyah], 2); save(); refreshAll(); refreshPageActions(); drawTafsir();
};
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('tafsir').hidden && cur < 0) closeTafsir(); });

// الضغط على كلمة يفتح تفسير آيتها؛ والسحب (لتقليب الصفحة) لا يُعدّ ضغطًا
let downXY = null;
['book', 'mtext'].forEach(id => {
  $(id).addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; }, true);
  $(id).addEventListener('pointerup', e => {
    const w = e.target.closest('.w, .ay');
    if (!w || !downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 6) return;
    openTafsir(+w.dataset.i);
  }, true);
});

// ---------- تنزيل التفاسير ----------
let dlBusy = false;
function tfDlRender() {
  const s = suraOf[tfAyah >= 0 ? tfAyah : pageB[page - 1][0]];
  $('tfDlList').innerHTML = TAFASIR.map(t => {
    if (t.builtin) return `<tr><td><b>${t.name}</b></td><td class="muted">مضمَّن في التطبيق</td><td></td></tr>`;
    const n = SURAS.reduce((c, _, k) => c + tfHave.has(`${t.id}:${k + 1}`), 0);
    const st = n === 114 ? 'منزَّل كاملًا ✓' : n ? `${ar(n)} من ١١٤ سورة` : 'غير منزَّل';
    return `<tr data-id="${t.id}"><td><b>${t.name}</b></td><td class="muted">${st}</td><td class="row">` +
      (tfHave.has(`${t.id}:${s}`) ? '' : `<button class="btn" data-dl="sura">سورة ${SURAS[s - 1][0]}</button>`) +
      (n < 114 ? '<button class="btn" data-dl="all">كاملًا</button>' : '') +
      (n ? '<button class="lnk" data-dl="del">حذف</button>' : '') + '</td></tr>';
  }).join('');
  $('tfDlList').querySelectorAll('button').forEach(b => b.disabled = dlBusy);
}
$('tfMore').onclick = async () => { await tfReady; tfDlRender(); $('tfDlMsg').textContent = ''; $('tfDl').classList.add('open'); };
$('tfDlClose').onclick = () => { $('tfDl').classList.remove('open'); drawTafsir(); };
$('tfDl').addEventListener('click', e => { if (e.target.id === 'tfDl') $('tfDlClose').click(); });
$('tfDlList').addEventListener('click', async e => {
  const b = e.target.closest('[data-dl]'); if (!b || dlBusy) return;
  const id = +b.closest('tr').dataset.id, act = b.dataset.dl, msg = $('tfDlMsg');
  if (act === 'del') {
    if (!confirm(`حذف «${tfName(id)}» المنزَّل من جهازك؟ يمكنك تنزيله مرة أخرى لاحقًا.`)) return;
    for (let k = 1; k <= 114; k++) if (tfHave.has(`${id}:${k}`)) { await tfDb.del(`${id}:${k}`); tfHave.delete(`${id}:${k}`); }
    if (tfId === id) tfId = 16;
    tfDlRender(); return;
  }
  const s = suraOf[tfAyah >= 0 ? tfAyah : pageB[page - 1][0]];
  const list = act === 'sura' ? [s] : [...Array(114)].map((_, k) => k + 1).filter(k => !tfHave.has(`${id}:${k}`));
  dlBusy = true; tfDlRender();
  try {
    for (let k = 0; k < list.length; k++) {
      msg.textContent = `جارٍ تنزيل «${tfName(id)}»: ${ar(k + 1)} من ${ar(list.length)}…`;
      await fetchSura(id, list[k]);
    }
    msg.textContent = `تم تنزيل «${tfName(id)}» ✓`;
    tfId = id;
    try { localStorage.setItem(KEY + '.tf', tfId); } catch (err) {}
  } catch (err) {
    msg.textContent = 'توقّف التنزيل؛ تحقّق من الاتصال بالإنترنت ثم أعد المحاولة (ما نُزِّل محفوظ).';
  }
  dlBusy = false; tfDlRender();
});

// ======================================================================
//  الشاشات
// ======================================================================
let screen = 'home';
try { screen = localStorage.getItem(KEY + '.screen') || 'home'; } catch (e) {}
function showScreen(s) {
  screen = s;
  try { localStorage.setItem(KEY + '.screen', s); } catch (e) {}
  document.querySelectorAll('.screen').forEach(el => el.classList.toggle('on', el.id === s));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  if (s !== 'mapScreen') setPicking(false);
  tip.style.display = 'none';
  if (s === 'reader') renderPage();
  else { clearInterval(readTimer); readTimer = null; }
  if (s === 'wird') wirdScreen();
  if (s === 'home') dashboard();
  scrollTo(0, 0);
}
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  // تبويب المصحف يعود دائمًا إلى موضع القراءة
  if (b.dataset.s === 'reader' && readerMode !== 'read') { readerMode = 'read'; page = lastPage; }
  showScreen(b.dataset.s);
});
document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => showScreen(b.dataset.goto));

function refreshAll() {
  blkEls.forEach((_, k) => paintBlock(k));
  dashboard(); reviewCard(); refreshBulk(); backupCard();
  if (screen === 'wird') wirdScreen();
}

// ======================================================================
//  النسخة الاحتياطية
// ======================================================================
function exportBackup() {
  const data = { app: 'quran-map', v: 4, date: new Date().toISOString(), state: state.join(''), rev: [...rev], cycle, readLog, wird, lastPage, khatmaStart, hifzLog, revLog, hGoal, hDir };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `quran-map-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  backupDay = today(); save(); backupCard();
}
$('exp').onclick = exportBackup;
$('bkNow').onclick = exportBackup;
$('bkLater').onclick = () => { backupSnooze = today(); save(); backupCard(); };

// يُرفض الملف كله إن كان أي حقل فيه غير صالح، فلا يُستورد نصفه
function parseBackup(d) {
  if (!d || d.app !== 'quran-map') return null;
  const s = cleanState(d.state);
  if (!s) return null;
  const opt = (v, clean, def) => v === undefined ? def : clean(v);
  const out = {
    state: s,
    rev: opt(d.rev, cleanRev, []),
    cycle: opt(d.cycle, oneOf(CYCLES), cycle),
    readLog: opt(d.readLog, cleanLog, {}),
    wird: opt(d.wird, oneOf(WIRDS), wird),
    lastPage: opt(d.lastPage, v => int(v, 1, PAGES_N), 1),
    khatmaStart: opt(d.khatmaStart, day, today()),
    hifzLog: opt(d.hifzLog, cleanHLog, {}),
    revLog: opt(d.revLog, cleanRLog, {}),
    hGoal: opt(d.hGoal, oneOf(HGOALS), hGoal),
    hDir: opt(d.hDir, cleanDir, hDir),
  };
  if (Object.values(out).includes(null)) return null;
  out.date = typeof d.date === 'string' ? d.date : null;
  return out;
}
$('imp').onclick = () => $('file').click();
$('file').onchange = async e => {
  const f = e.target, file = f.files[0];
  f.value = '';
  if (!file) return;
  let d = null;
  try { d = parseBackup(JSON.parse(await file.text())); } catch (err) {}
  if (!d) { alert('هذا الملف ليس نسخة صحيحة من خريطة المصحف، ولم يُغيَّر شيء من بياناتك.'); return; }
  let h = 0, fh = 0;
  for (const c of d.state) { if (c & 1) h++; if (c & 2) fh++; }
  const pages = Object.values(d.readLog).reduce((n, p) => n + p.length, 0);
  const when = d.date && !isNaN(new Date(d.date)) ? new Date(d.date).toLocaleDateString('ar-EG') : 'غير معروف';
  if (!confirm(`نسخة بتاريخ ${when}:\n• الحفظ: ${ayat(h)}\n• الفهم: ${ayat(fh)}\n• سجل القراءة: ${safahat(pages)}\n\nسيُستبدل تقدّمك الحالي بهذه النسخة. هل تريد المتابعة؟`)) return;
  const t = today();
  for (let i = 0; i < TOTAL; i++) {
    state[i] = +d.state[i];
    rev[i] = d.rev[i] || 0;
    if ((state[i] & 1) && !rev[i]) rev[i] = t;
  }
  ({ cycle, readLog, wird, lastPage, khatmaStart, hifzLog, revLog, hGoal, hDir } = d);
  save(); syncControls(); renderMap(); refreshAll();
};

// ---------- تذكير النسخة الاحتياطية ----------
function backupCard() {
  const t = today(), since = t - backupDay;
  // نسخة سطح المكتب تحفظ نسخة احتياطية تلقائية كل يوم، فلا حاجة إلى التذكير
  const need = !DESK && hasData() && since >= 7 && t - backupSnooze >= 3;
  $('bkCard').hidden = !need;
  if (DESK) { $('bkInfo').textContent = ''; return; }
  $('bkWhen').textContent = backupDay ? `آخر نسخة احتياطية حفظتها كانت ${ayyam(since)}.` : 'لم تحفظ أي نسخة احتياطية بعد.';
  $('bkInfo').textContent = backupDay ? `(آخر نسخة: ${ayyam(since)})` : '';
}

// ---------- مزامنة النوافذ المفتوحة: نافذة قديمة لا تكتب فوق تغييرات نافذة أحدث ----------
function syncControls() {
  $('cycle').value = cycle; $('wirdSel').value = wird;
  $('hGoalSel').value = hGoal; $('hDirSel').value = hDir;
  document.documentElement.style.setProperty('--qfs', fontSize + 'px');
}
let syncT = null;
window.addEventListener('storage', e => {
  if (e.key !== null && (!e.key.startsWith(KEY) || /\.(screen|view|rescue)/.test(e.key))) return;
  clearTimeout(syncT);
  syncT = setTimeout(() => {
    load(); syncControls(); refreshAll();
    if (screen === 'reader') renderPage();
  }, 80);
});

// ---------- بداية يوم جديد والتطبيق مفتوح ----------
let shownDay = today();
function checkDay() {
  if (today() === shownDay) return;
  shownDay = today();
  refreshAll();
  if (screen === 'reader') renderPage();
}
setInterval(checkDay, 60e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });

// ---------- سطح المكتب: النسخ التلقائية والتحديثات ----------
if (DESK) {
  $('deskBk').hidden = false;
  $('openBk').onclick = () => DESK.openBackups();
  $('appVer').textContent = `الإصدار ${DESK.version}`;
  DESK.onUpdateReady(v => {
    $('updTxt').textContent = `تحديث جديد (${v}) جاهز، ويُثبَّت تلقائيًا عند إغلاق التطبيق.`;
    $('updBar').hidden = false;
  });
  $('updNow').onclick = () => { deskSave(); if (deskT) { clearTimeout(deskT); DESK.writeDataSync(deskSnapshot()); } DESK.installUpdate(); };
}

setPicking(false);
renderMap();
backupCard();
showScreen(['home', 'reader', 'wird', 'mapScreen'].includes(screen) ? screen : 'home');
