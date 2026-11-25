// صاحبُك القرآن (كان اسمه «خريطة المصحف»)
// • لكل آية حالة: bit1 = حفظ، bit2 = قرأ تفسيرها (3 = كلاهما) + يوم آخر مراجعة للمحفوظ
// • سجل القراءة اليومي: { رقم اليوم: [أرقام الصفحات] } + الورد اليومي + موضع الوقوف + بداية الختمة
const TOTAL = 6236, PAGES_N = 604;
const KEY = 'quranMap.v1';
const DWELLS = [5, 10, 15, 20, 30, 45, 60];   // ثوانٍ تبقى فيها الصفحة مفتوحة لتُحسب مقروءة (من الإعدادات)
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
// يوم قراءة تفسير الآية (للعلامة bit2): يبهت لونها تدريجيًا خلال سنة، دعوةً إلى تجديد قراءته لا واجبًا
const tfd = new Int32Array(TOTAL);
const TF_FADE = 365;
const tfAge = i => (state[i] & 2) && tfd[i] ? today() - tfd[i] : 0;
const tfFade = i => Math.min(1, tfAge(i) / TF_FADE);   // ٠ حديث … ١ مضت عليه سنة
let cycle = 14, readLog = {}, wird = 5, lastPage = 1, khatmaStart = today(), fontSize = 26;
let khatmaPre = 0;   // صفحات قُرئت من الختمة الحالية قبل بدء التتبّع (١ … khatmaPre)
let dwell = 15;
let backupDay = 0, backupSnooze = 0;   // يوم آخر نسخة احتياطية، ويوم تأجيل التذكير
// ورد الحفظ والمراجعة
let hifzLog = {};   // { رقم اليوم: [أرقام الآيات التي حُفظت جديدًا فيه] }
let revLog = {};    // { رقم اليوم: عدد الآيات التي رُوجعت فيه }
let hGoal = 5;      // آيات الحفظ الجديد يوميًا (إن كان المقدار بالآيات)
let hUnit = 'a';    // وحدة الحفظ الجديد: 'a' بالآيات، 'p' بالصفحات
let hGoalP = 1;     // الحفظ الجديد بالصفحات: بأنصاف الصفحات (١ = نصف صفحة)
let hDir = 'b';     // 'b': من الناس إلى البقرة (جزء عمّ أولًا)، 'f': من الفاتحة إلى الناس
// المرجعيات: cats [{id, name}]، items [{i: الآية، c: التصنيف، note، t: اليوم}]
let refs = { cats: [], items: [] };
// موضع الورد داخل الصفحة: إن انتهى ورد عند نهاية سورة في وسط صفحة، فهذه أول آية من السورة التالية (وإلا -١: أول الصفحة)
let lastAyah = -1;
let readMode = 'timer';   // احتساب الصفحة المقروءة: 'timer' تلقائيًا بعد مدة، 'manual' بزر تحت كل صفحة
// موعد مراجعة خاص لكل آية محفوظة: ٠ = حسب الإعداد العام، وإلا فهرس في RCYC
const RCYC = [0, 3, 7, 14, 30, 60, 90];
const ivl = new Uint8Array(TOTAL);
const cyc = i => ivl[i] ? RCYC[ivl[i]] : cycle;
// المنبهات: قائمة يضيفها المستخدم، لكل منبه نوع ووقت وأيام
// kind: read | hifz | rev (تظهر إن لم يكتمل الورد) | sura (سورة بعينها) | note (تذكير بنص تكتبه)
const REM_KINDS = { read: '📖 ورد القراءة', hifz: '🧠 ورد الحفظ', rev: '🔁 ورد المراجعة', sura: '📗 قراءة سورة', note: '⏰ تذكير' };
let remind = [];

// ---------- التحقق من صحة البيانات (للتحميل والاسترجاع) ----------
const CYCLES = [3, 7, 14, 30, 60], WIRDS = [1, 2, 3, 4, 5, 10, 20, 40], HGOALS = [1, 2, 3, 5, 7, 10, 15, 20], HGOALPS = [1, 2, 3, 4, 6, 8];
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
function cleanRefs(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.cats) || !Array.isArray(o.items)) return null;
  const cats = o.cats.filter(c => c && int(c.id, 1, 1e9) !== null && typeof c.name === 'string' && c.name.trim())
    .map(c => ({ id: c.id, name: c.name.trim().slice(0, 40) }));
  const ids = new Set(cats.map(c => c.id));
  const items = o.items.filter(x => x && int(x.i, 0, TOTAL - 1) !== null && ids.has(x.c))
    .map(x => ({ i: x.i, c: x.c, note: typeof x.note === 'string' ? x.note.slice(0, 1000) : '', t: int(x.t, 0, 1e7) ?? today() }));
  return { cats, items };
}
const okTime = t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
function cleanRemind(o) {
  if (!o || typeof o !== 'object') return null;
  // الصيغة القديمة (حتى ١٫٧): { read: {on, time}, hifz: …, rev: … } تتحول إلى قائمة
  if (!Array.isArray(o)) {
    const def = { read: '20:00', hifz: '06:00', rev: '17:00' };
    return Object.keys(def).filter(k => o[k]).map((k, n) => ({ id: n + 1, kind: k, on: o[k].on === true, time: okTime(o[k].time) ? o[k].time : def[k], days: [], sura: 18, text: '' }));
  }
  const seen = new Set();
  return o.filter(r => r && REM_KINDS[r.kind] && int(r.id, 1, 1e9) !== null && !seen.has(r.id) && seen.add(r.id)).slice(0, 30).map(r => ({
    id: r.id, kind: r.kind, on: r.on !== false, time: okTime(r.time) ? r.time : '08:00',
    days: Array.isArray(r.days) ? [...new Set(r.days.filter(d => int(d, 0, 6) !== null))].sort() : [],
    sura: int(r.sura, 1, 114) ?? 18, text: typeof r.text === 'string' ? r.text.slice(0, 80) : '',
  }));
}
const cleanIvl = s => typeof s === 'string' && s.length === TOTAL && /^[0-6]+$/.test(s) ? s : null;
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
  const td = read('.tfd', json, cleanRev);
  tfd.fill(0); if (td) td.forEach((d, i) => tfd[i] = d);
  const r = read('.rev', json, cleanRev);
  rev.fill(0); if (r) r.forEach((d, i) => rev[i] = d);
  cycle = read('.cycle', str, oneOf(CYCLES)) ?? 14;
  readLog = read('.read', json, cleanLog) ?? {};
  wird = read('.wird', str, oneOf(WIRDS)) ?? 5;
  lastPage = read('.last', str, v => int(v, 1, PAGES_N)) ?? 1;
  khatmaStart = read('.khatma', str, day) ?? today();
  khatmaPre = read('.kpre', str, v => int(v, 0, PAGES_N)) ?? 0;
  fontSize = read('.fs', str, v => int(v, 18, 40)) ?? 26;
  const day0 = v => int(v, 0, today() + 1);   // ٠ = لم يحدث بعد
  backupDay = read('.bk', str, day0) ?? 0;
  backupSnooze = read('.bkLater', str, day0) ?? 0;
  hifzLog = read('.hlog', json, cleanHLog) ?? {};
  revLog = read('.rlog', json, cleanRLog) ?? {};
  hGoal = read('.hgoal', str, oneOf(HGOALS)) ?? 5;
  hDir = read('.hdir', str, cleanDir) ?? 'b';
  dwell = read('.dwell', str, oneOf(DWELLS)) ?? 15;
  refs = read('.refs', json, cleanRefs) ?? { cats: [], items: [] };
  remind = read('.remind', json, cleanRemind) ?? [];
  hUnit = read('.hunit', str, v => v === 'a' || v === 'p' ? v : null) ?? 'a';
  hGoalP = read('.hgoalp', str, oneOf(HGOALPS)) ?? 1;
  readMode = read('.rmode', str, v => v === 'timer' || v === 'manual' ? v : null) ?? 'timer';
  lastAyah = read('.lastAyah', str, v => int(v, -1, TOTAL - 1)) ?? -1;
  if (lastAyah >= 0 && pageOf[lastAyah] !== lastPage) lastAyah = -1;   // لا يصح إلا داخل صفحة الورد
  const iv = read('.ivl', str, cleanIvl);
  ivl.fill(0); if (iv) for (let i = 0; i < TOTAL; i++) ivl[i] = +iv[i];
  const t = today();
  for (let i = 0; i < TOTAL; i++) {
    if ((state[i] & 1) && !rev[i]) rev[i] = t;
    if ((state[i] & 2) && !tfd[i]) tfd[i] = t;   // ما سُجّل قبل حفظ التاريخ يُعدّ من اليوم
  }
  // القيم التالفة تُحفظ كما هي قبل أن يكتب فوقها أول حفظ، لإمكان إنقاذها يدويًا
  if (Object.keys(bad).length) {
    try { localStorage.setItem(`${KEY}.rescue.${Date.now()}`, JSON.stringify(bad)); } catch (e) {}
    console.warn('صاحبُك القرآن: وُجدت بيانات تالفة وحُفظت نسختها الأصلية', Object.keys(bad));
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
    localStorage.setItem(KEY + '.kpre', khatmaPre);
    localStorage.setItem(KEY + '.fs', fontSize);
    localStorage.setItem(KEY + '.bk', backupDay);
    localStorage.setItem(KEY + '.bkLater', backupSnooze);
    localStorage.setItem(KEY + '.hlog', JSON.stringify(hifzLog));
    localStorage.setItem(KEY + '.rlog', JSON.stringify(revLog));
    localStorage.setItem(KEY + '.hgoal', hGoal);
    localStorage.setItem(KEY + '.hdir', hDir);
    localStorage.setItem(KEY + '.dwell', dwell);
    localStorage.setItem(KEY + '.refs', JSON.stringify(refs));
    localStorage.setItem(KEY + '.remind', JSON.stringify(remind));
    localStorage.setItem(KEY + '.hunit', hUnit);
    localStorage.setItem(KEY + '.hgoalp', hGoalP);
    localStorage.setItem(KEY + '.rmode', readMode);
    localStorage.setItem(KEY + '.lastAyah', lastAyah);
    localStorage.setItem(KEY + '.ivl', ivl.join(''));
    localStorage.setItem(KEY + '.tfd', JSON.stringify([...tfd]));
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
const hasData = () => state.some(x => x) || Object.keys(readLog).length > 0 || Object.keys(revLog).length > 0 || refs.items.length > 0;

const isDue = i => (state[i] & 1) && today() - rev[i] >= cyc(i);
const hasCustomIvl = () => { for (let i = 0; i < TOTAL; i++) if ((state[i] & 1) && ivl[i]) return true; return false; };
const ivlName = k => !k ? `حسب الإعداد العام (${cycleName(cycle)})` : cycleName(RCYC[k]);
const cycleName = d => ({ 3: 'كل ٣ أيام', 7: 'كل أسبوع', 14: 'كل أسبوعين', 30: 'كل شهر', 60: 'كل شهرين', 90: 'كل ٣ أشهر' }[d] || `كل ${ayyamN(d)}`);

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
  for (let p = 1; p <= khatmaPre; p++) s.add(p);
  for (const d in readLog) if (+d >= khatmaStart) readLog[d].forEach(p => s.add(p));
  return s;
}
// ---------- مقاييس الورد الثلاثة ----------
const hifzCount = d => (hifzLog[d] || []).length;
const revCount = d => revLog[d] || 0;
function revQuota() {   // ما يلزم مراجعته يوميًا ليُراجَع كل محفوظ مرة في موعده (العام أو الخاص به)
  let q = 0;
  for (let i = 0; i < TOTAL; i++) if (state[i] & 1) q += 1 / cyc(i);
  return q ? Math.ceil(q - 1e-9) : 0;
}
// نصيب كل آية من صفحتها (بطول نصها)، لحساب الحفظ بالصفحات
const share = new Float32Array(TOTAL);
pageB.forEach(([f, t]) => {
  let L = 0; for (let i = f; i <= t; i++) L += AYAT[i].length;
  for (let i = f; i <= t; i++) share[i] = AYAT[i].length / L;
});
const pagesOf = ids => (ids || []).reduce((s, i) => s + share[i], 0);
// «نصف صفحة»، «صفحة ونصف»، «١٫٣ صفحة» …
function pagesTxt(x) {
  const r = Math.round(x * 10) / 10;
  if (r === 0) return 'لا شيء';
  if (r === 0.5) return 'نصف صفحة';
  if (r === 1.5) return 'صفحة ونصف';
  if (Number.isInteger(r)) return safahat(r);
  return `${ar(r)} صفحة`;
}
const hByPage = () => hUnit === 'p';
const HIFZ_TOL = 0.1;   // بالصفحات: يكتمل الورد إن بقي منه أقل من عُشر صفحة (حدود الآيات لا تطابق المقدار تمامًا)
const METRICS = {
  read: { n: readCount, goal: () => wird, unit: safahat, name: 'القراءة' },
  hifz: { n: d => hByPage() ? pagesOf(hifzLog[d]) : hifzCount(d), goal: () => hByPage() ? hGoalP / 2 : hGoal,
          unit: v => hByPage() ? pagesTxt(v) : ayat(v), name: 'الحفظ', tol: () => hByPage() ? HIFZ_TOL : 0 },
  rev:  { n: revCount, goal: revQuota, unit: ayat, name: 'المراجعة' },
};
const met = (m, n, goal = m.goal()) => goal > 0 && n >= goal - (m.tol ? m.tol() : 0) - 1e-9;
function streakOf(m, goal = m.goal()) {
  if (!goal) return 0;
  let d = today(), n = 0;
  if (!met(m, m.n(d), goal)) d--;           // اليوم لم يكتمل بعد؛ السلسلة ما زالت قائمة من أمس
  while (met(m, m.n(d), goal)) { n++; d--; }
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
// بالصفحات: آيات متتالية يقارب مجموع أنصبتها ما بقي (تقف عند أقرب حدّ آية إلى المقدار)
function nextHifzPages(rem) {
  const out = [];
  if (rem <= HIFZ_TOL) return out;
  let sum = 0;
  for (const i of hifzOrder()) {
    if (state[i] & 1) continue;
    if (out.length && Math.abs(sum + share[i] - rem) >= Math.abs(sum - rem)) break;
    out.push(i); sum += share[i];
  }
  return out;
}
// ورد الحفظ الباقي اليوم بحسب الوحدة المختارة
const hifzPortion = () => {
  const m = METRICS.hifz, left = m.goal() - m.n(today());
  return hByPage() ? nextHifzPages(left) : nextHifz(left);
};
// ما بقي من القرآن لم يُحفظ، بوحدة الحفظ المختارة
function hifzLeft() {
  let a = 0, p = 0;
  for (let i = 0; i < TOTAL; i++) if (!(state[i] & 1)) { a++; p += share[i]; }
  return hByPage() ? p : a;
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
  { key: 'both', label: 'حفظ وتفسير', c: 'var(--c-both)' },
  { key: 'fahm', label: 'تفسير فقط', c: 'var(--c-fahm)' },
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
    `<text x="${cx}" y="${cy + 38}" text-anchor="middle" font-size="12" style="fill:var(--muted)">حفظ وتفسير</text>`;
  $('plegend').innerHTML = SEGS.map(s =>
    `<tr><td><i class="sw" style="background:${s.c}"></i> ${s.label}</td><td>${ayat(v[s.key])}</td><td>${pct(v[s.key], TOTAL)}</td></tr>`).join('');

  const all = count(0, TOTAL - 1);
  $('kpis').innerHTML =
    `<div class="kpi"><div class="v">${pct(all.h, TOTAL)}</div><div class="l"><i class="sw" style="background:var(--hifz)"></i> حفظ · ${ayat(all.h)}</div></div>` +
    `<div class="kpi"><div class="v">${pct(all.f, TOTAL)}</div><div class="l"><i class="sw" style="background:var(--fahm)"></i> تفسير · ${ayat(all.f)}</div></div>` +
    `<div class="kpi"><div class="v">${pct(all.b, TOTAL)}</div><div class="l"><i class="sw" style="background:var(--both)"></i> كلاهما · ${ayat(all.b)}</div></div>`;
  const act = $('act'), gapDays = today() - all.latest;
  if (!all.h) { act.className = 'act'; act.innerHTML = 'لم تسجّل أي محفوظ بعد — ابدأ من الخريطة 🌱'; }
  else {
    act.className = 'act' + (gapDays >= cycle ? ' late' : '');
    act.innerHTML = `آخر حفظ أو مراجعة: <b>${ayyam(gapDays)}</b>`;
  }

  planCard();
  heroRow();
}

// ---------- رأس الرئيسية: التاريخ الهجري، وما أتممت اليوم، والأيام المتتالية ----------
let hijriFmt = null;
try { hijriFmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) {}
function heroRow() {
  $('heroDate').textContent = hijriFmt ? hijriFmt.format(new Date()) : new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
  const t = today(), all = count(0, TOTAL - 1);
  const done = [readCount(t) >= wird, !hifzToday.length, !all.h || !revToday.length];
  const n = done.filter(Boolean).length;
  $('heroSum').textContent = n === 3 ? 'أتممتَ أورادك الثلاثة اليوم ✓ تقبّل الله منك'
    : `أتممتَ ${['لا شيء من', 'وِردًا واحدًا من', 'وِردَين من'][n]} أورادك الثلاثة اليوم`;
  $('heroStreaks').innerHTML = '<span class="muted hstl">الأيام المتتالية:</span>' + [['📖 القراءة', streak()], ['🧠 الحفظ', streakOf(METRICS.hifz)], ['🔁 المراجعة', streakOf(METRICS.rev)]]
    .map(([l, v]) => `<div class="hst" title="أيام متتالية أتممتَ فيها هذا الورد"><b>${ar(v)}</b><span>${l}</span></div>`).join('');
}

// ---------- خطة اليوم: القراءة والحفظ والمراجعة ----------
let hifzToday = [], revToday = [];
const numTxt = n => ar(Number.isInteger(n) ? n : Math.round(n * 10) / 10);
const revRule = h => hasCustomIvl() ? `مراجعة ${ayat(h)} كلٌّ في موعده` : `مراجعة ${ayat(h)} ${cycleName(cycle)}`;
// موضع ورد القراءة: «صفحة ٤٣٥»، أو «سورة فاطر (ص ٤٣٤)» إن انتهى الورد السابق عند نهاية سورة
const wirdPosTxt = () => lastAyah >= 0 ? `${posName(lastAyah)} (ص ${ar(lastPage)})` : `صفحة ${ar(lastPage)}`;
// «سورة فاطر» إن بدأ الورد بأول سورة، وإلا «فاطر ١٢»
const posName = i => ayahOf(i) === 1 ? `سورة ${SURAS[suraOf[i] - 1][0]}` : `${SURAS[suraOf[i] - 1][0]} ${ar(ayahOf(i))}`;
// «نهاية سورة سبإ» أو «الآية ١١ من سورة فاطر» (الآية التي قبل موضع الورد)
const stopName = i => ayahOf(i) === 1 ? `نهاية سورة ${SURAS[suraOf[i] - 2][0]}` : `الآية ${ar(ayahOf(i - 1))} من سورة ${SURAS[suraOf[i - 1] - 1][0]}`;
function planRow(id, m, goal, detail, done) {
  const el = $(id), n = m.n(today());
  el.querySelector('.pv').innerHTML = goal ? `<b>${numTxt(n)}</b> / ${m.unit(goal)}` : '';
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
  $('hContinue').textContent = `متابعة القراءة من ${wirdPosTxt()}`;

  // الحفظ الجديد
  const hs = streakOf(METRICS.hifz), left = TOTAL - all.h, hg = METRICS.hifz.goal();
  hifzToday = hifzPortion();
  let hd;
  if (!left) hd = '<span class="done-msg">🎉 أتممتَ حفظ القرآن الكريم، تقبّل الله منك</span>';
  else if (!hifzToday.length) {
    const nx = nextHifz(1)[0];
    hd = `<span class="done-msg">أتممتَ ورد الحفظ ✓</span> · غدًا من ${describeAyat([nx])}`;
  } else hd = `ورد اليوم: <span class="tgt">${describeAyat(hifzToday)}</span>`;
  if (left) hd += `<br>بهذا المقدار تُتمّ حفظ القرآن خلال ${duration(Math.ceil(hifzLeft() / hg))} تقريبًا` + (hs ? ` · الأيام المتتالية: ${ar(hs)}` : '');
  planRow('planHifz', METRICS.hifz, hg, hd, !hifzToday.length);

  // المراجعة
  const q = revQuota(), vn = revCount(t);
  revToday = reviewPortion();
  let vd;
  if (!all.h) vd = 'سجّل محفوظك من الخريطة ليظهر هنا ورد المراجعة اليومي.';
  else if (!revToday.length) vd = vn >= q ? '<span class="done-msg">أتممتَ ورد المراجعة ✓</span>' : '<span class="done-msg">لا مراجعة مستحقة اليوم ✓</span>';
  else vd = `ورد اليوم: <span class="tgt">${describePages(revToday)}</span>`;
  if (all.h) vd += `<br>${revRule(all.h)} = ${ayat(q)} يوميًا`;
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
  $('review').hidden = !all.d;   // لا تظهر البطاقة إلا إن كان هناك ما يحتاج إلى مراجعة
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
    for (let i = 0; i < TOTAL; i++) if (state[i] & 1) next = Math.min(next, rev[i] + cyc(i));
    const dd = next - t;
    $('rvList').innerHTML = `<span class="more">أقرب مراجعة ${dd <= 1 ? 'غدًا' : `بعد ${ayyamN(dd)}`} بإذن الله</span>`;
  }
}
$('rvList').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (c) openGroup('suras', +c.dataset.g, true);
});
// اللوحة تعتمد على عرض الخريطة، فنضبطه أولًا
function openGroup(v, k, selectDue = false) { openSheet(k, selectDue, v); }
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
// شكل المصحف من الإعدادات: m1441 (صفحات مطابقة للمطبوع) أو plain (نص متصل بخط أميري)
let mStyle = 'm1441';
try { mStyle = localStorage.getItem(KEY + '.mstyle') === 'plain' ? 'plain' : 'm1441'; } catch (e) {}
const useQcf = () => HAS_M && mStyle === 'm1441';
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
  // ما قبل موضع الورد في صفحته قُرئ في الورد السابق، فيُخفَّف لونه حتى تُقرأ الصفحة
  const pre = readerMode === 'read' && lastAyah >= 0 && i < lastAyah && pageOf[i] === lastPage && !readOn(today()).includes(lastPage) ? ' pre' : '';
  return (isDue(i) ? ' due' : readerMode === 'hifz' && hifzSet.has(i) ? ' h1' : '') + pre;
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
  if (useQcf()) {
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
const wantBook = () => FLIP && useQcf() && wideEnough();   // الكتاب المزدوج لطبعة المدينة على الشاشات العريضة
const wideEnough = () => $('reader').clientWidth - ($('reader').classList.contains('tf-open') ? 408 : 0) >= 680;
// بعد تغيّر المساحة المتاحة (لوحة التفسير): بدّل الوضع إن لزم، وإلا أعِد حساب مقاس الكتاب
function relayoutReader() {
  if (screen === 'reader' && FLIP && wantBook() !== bookOn) renderPage();
  else window.dispatchEvent(new Event('resize'));
}
// فتح لوحة التفسير أو إغلاقها: تتغير المساحة فورًا، ثم تنتقل الصفحة بحركة ناعمة من مكانها القديم إلى الجديد
// (نقيس موضعها قبل التغيير وبعده، ونبدأ الحركة من الفرق بينهما)
function slideReader(change) {
  const el = bookOn ? $('book') : $('mpage'), wasBook = bookOn;
  const a = screen === 'reader' ? el.getBoundingClientRect() : null;
  change();
  if (!a || !a.width || bookOn !== wasBook || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const b = el.getBoundingClientRect();
  if (!b.width || (Math.abs(a.left - b.left) < 1 && Math.abs(a.width - b.width) < 1)) return;
  el.style.transition = 'none';
  el.style.transformOrigin = '0 0';
  el.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width})`;
  void el.offsetWidth;
  el.style.transition = 'transform .34s cubic-bezier(.2,.8,.3,1)';
  el.style.transform = '';
  $('reader').classList.add('sliding');   // لا قصّ أثناء الحركة
  clearTimeout(el._slideT);
  el._slideT = setTimeout(() => { el.style.transition = el.style.transformOrigin = ''; $('reader').classList.remove('sliding'); }, 380);
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
  noteVisit();
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
  $('book').style.maxWidth = $('rstat').style.maxWidth = Math.round(2 * h * 520 / 820) + 'px';   // أزرار القراءة تحت كل صفحة
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
    showPageCorners: false, disableFlipByClick: true, clickEventForward: true, startPage: idxOf(page),
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
  $('wirdChip').textContent = `📖 موضع الورد: ${lastAyah >= 0 ? `${posName(lastAyah).replace('سورة ', '')} · ` : ''}ص ${ar(lastPage)}`;
  $('wirdChip').classList.toggle('here', vis.includes(lastPage));
  $('recentBtn').disabled = !recent.length;
}

// ---------- آخر ما قرأت: آخر ثلاثة مواضع قرأتها خارج الورد (بقيت عليها ١٠ ثوانٍ فأكثر) ----------
// [{p: الصفحة، t: وقت الزيارة}] الأحدث أولًا؛ تُعرض في قائمة من زر «آخر ما قرأت» وفي قسم المرجعيات
const RECENT_N = 3;   // آخر ثلاثة مواضع فقط
let recent = [];
try {
  recent = (JSON.parse(localStorage.getItem(KEY + '.recent')) || [])
    .map(x => typeof x === 'number' ? { p: x, t: 0 } : x)
    .filter(x => x && int(x.p, 1, PAGES_N) && typeof x.t === 'number').slice(0, RECENT_N);
} catch (e) {}
let recentT = null;
const nearWird = p => p >= lastPage - 2 && p <= lastPage + 1;
function noteVisit() {
  clearTimeout(recentT);
  const p = page;
  recentT = setTimeout(() => {
    if (screen !== 'reader' || page !== p || nearWird(p)) return;
    recent = [{ p, t: Date.now() }, ...recent.filter(x => Math.abs(x.p - p) > 1)].slice(0, RECENT_N);
    try { localStorage.setItem(KEY + '.recent', JSON.stringify(recent)); } catch (e) {}
    deskSave(); updateReaderBar();
    if (screen === 'refs') refsScreen();
  }, 10000);   // عشر ثوانٍ على الصفحة = قراءة لا مرور
}
// «قبل ٥ دقائق»، «قبل ٣ ساعات»، «أمس» …
function agoTxt(ms) {
  if (!ms) return '';
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 2) return 'الآن';
  if (m < 60) return `قبل ${plural(m, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة')}`;
  const h = Math.floor(m / 60);
  if (h < 24 && new Date(ms).getDate() === new Date().getDate()) return `قبل ${plural(h, 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}`;
  const d = today() - Math.floor((ms - new Date(ms).getTimezoneOffset() * 6e4) / 864e5);
  return ayyam(d);
}
const pageSura = p => SURAS[suraOf[pageB[p - 1][0]] - 1][0];
function recentPop() {
  const pop = $('recentPop');
  pop.innerHTML = '<div class="ph2">🕘 آخر ما قرأت</div>' + recent.map(x =>
    `<button class="ri2" data-p="${x.p}"><b>${pageSura(x.p)}</b><span>ص ${ar(x.p)} · الجزء ${ar(juzOf[pageB[x.p - 1][0]])}</span><em>${agoTxt(x.t)}</em></button>`).join('') +
    '<button class="lnk" data-goto2="refs">عرضها في المرجعيات</button>';
  pop.hidden = false;
}
$('recentBtn').onclick = e => { e.stopPropagation(); $('recentPop').hidden ? recentPop() : ($('recentPop').hidden = true); };
$('recentPop').addEventListener('click', e => {
  const b = e.target.closest('[data-p]');
  $('recentPop').hidden = true;
  if (b) openReader(+b.dataset.p);
  else if (e.target.closest('[data-goto2]')) { rcSel = -1; showScreen('refs'); }
});
document.addEventListener('mousedown', e => { if (!$('recentPop').hidden && !e.target.closest('#recentPop,#recentBtn')) $('recentPop').hidden = true; });
$('wirdChip').onclick = () => openReader(lastPage);

// التبديل بين الكتاب والصفحة الواحدة
function setBookMode(on) {
  bookOn = on;
  $('reader').classList.toggle('flip', on);
}
function renderPage() {
  if (screen === 'reader' && wantBook()) {
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
  noteVisit();
}
// إعادة رسم الصفحات الظاهرة (بعد تغيّر موضع الورد داخل الصفحة)
function repaintPages() {
  if (bookOn) { paintVer++; visiblePages().forEach(fillPage); }
  else drawText(page);
}

// آيات الصفحات الظاهرة (صفحة أو صفحتان متتاليتان)
function visibleAyat() {
  const vis = visiblePages(), ids = [];
  for (let i = pageB[Math.min(...vis) - 1][0]; i <= pageB[Math.max(...vis) - 1][1]; i++) ids.push(i);
  return ids;
}
function refreshPageActions() {
  $('mpToday').textContent = `اليوم: ${safahat(readCount(today()))}`;
}

// ---------- احتساب صفحات ورد القراءة ----------
// الورد يمضي من موضعه فقط (lastPage): تُحسب صفحته تلقائيًا بعد مدة (dwell) أو بزر «قرأتُ هذه الصفحة» تحتها،
// فيتقدّم الموضع صفحة؛ وفي العرض المزدوج اليمنى ثم اليسرى. والتصفّح في غير موضع الورد لا يُحسب ولا يحرّك الموضع.
// وإن انتهى الورد عند نهاية سورة في وسط صفحة، يبدأ الورد التالي من أول السورة بعدها (lastAyah)
const stoppedToday = () => lastAyah >= 0 && readOn(today()).includes(lastPage);
function wirdTodo(vis) {
  if (readerMode !== 'read' || !vis.includes(lastPage) || stoppedToday()) return [];
  return vis.filter(p => p === lastPage || p === lastPage + 1);
}
// بدايات السور في وسط الصفحة (بعد موضع الورد إن كان فيها): يمكن إنهاء الورد عند نهاية السورة التي قبلها
function surahStops(p) {
  const [f, t] = pageB[p - 1], out = [];
  for (let i = f + 1; i <= t; i++) if (ayahOf(i) === 1 && !(p === lastPage && i <= lastAyah)) out.push(i);
  return out;
}
const prevSura = i => SURAS[suraOf[i] - 2][0];
// «انتهى وردي عند هذه الآية» (من القائمة بالزر الأيمن): متاح للآيات حول موضع الورد فقط، لا في التصفّح البعيد
const canEndAt = i => readerMode === 'read' && i < TOTAL - 1 && pageOf[i] >= lastPage - 1 && pageOf[i] <= lastPage + 1 && !(lastAyah >= 0 && i < lastAyah && !stoppedToday());
function endWirdAt(i) {
  const p = pageOf[i], nx = i + 1;
  for (let q = Math.min(lastPage, p); q <= p; q++) if (q >= lastPage || q === p) markRead(q);   // صفحات الورد حتى هذه الآية
  lastPage = pageOf[nx];
  lastAyah = pageB[lastPage - 1][0] === nx ? -1 : nx;   // آخر آية في الصفحة = حدّ صفحة عادي
  afterReadChange(true);
}
function readCell(p, todo) {
  const done = readOn(today()).includes(p);
  let main, extra = '';
  if (stoppedToday() && p === lastPage) {
    main = `<span class="ok">✓ انتهى ورد اليوم عند ${stopName(lastAyah)}</span>`;
    extra = '<button class="lnk" data-rd="unstop">بل أتممتُ الصفحة كلها</button>';
  } else if (todo.includes(p)) {
    main = readMode === 'manual'
      ? `<button class="btn pri" data-rd="read" data-p="${p}">✓ قرأتُ هذه الصفحة</button>`
      : `<span class="rs" data-p="${p}">${p === todo[0] ? '' : 'تُحسب بعد الصفحة اليمنى'}</span>`;
  } else if (done) {
    main = '<span class="ok">✓ قُرئت اليوم ضمن الورد</span>';
    if (readMode === 'manual' && p === lastPage - 1 && lastAyah < 0) extra = `<button class="lnk" data-rd="undo" data-p="${p}">تراجع</button>`;
  } else main = '<span>تصفّح حر · لا يُحسب في ورد القراءة</span>';
  const canStop = todo.includes(p) || (done && p === lastPage - 1 && lastAyah < 0) || (stoppedToday() && p === lastPage);
  const stops = canStop ? surahStops(p) : [];
  if (stops.length) extra += `<span class="rstops">${stoppedToday() && p === lastPage ? 'أو بعد' : 'أنهيتُ وردي بعد'} سورة: ` +
    stops.map(i => `<button class="rchip" data-rd="stop" data-p="${p}" data-i="${i}">${prevSura(i)}</button>`).join('') + '</span>';
  return `<div class="rcell"><div class="rmain">${main}</div>${extra ? `<div class="rextra">${extra}</div>` : ''}</div>`;
}
function drawReadCtl(todo) {
  const vis = visiblePages(), today_ = `<span class="rtoday">اليوم: ${safahat(readCount(today()))}</span>`;
  let html;
  if (readerMode !== 'read') html = `<div class="rcell"><span>${readerMode === 'rev' ? '🔁 جلسة مراجعة' : '🧠 جلسة حفظ'} · لا تُحسب في ورد القراءة</span></div>`;
  else html = vis.map(p => readCell(p, todo)).join(bookOn ? today_ : '');
  if (bookOn) { $('rstat').innerHTML = readerMode !== 'read' || vis.length < 2 ? html + today_ : html; $('readSt').innerHTML = ''; }
  else { $('readSt').innerHTML = html; $('rstat').innerHTML = ''; }
}
const readCtlText = () => (bookOn ? $('rstat') : $('readSt')).textContent;
function afterReadChange(repaint) {
  save(); dashboard(); updateReaderBar(); refreshPageActions();
  if (repaint) repaintPages();
  startReadTimer();
}
function readPage(p) {
  markRead(p);
  let rp = false;
  if (p === lastPage) { lastPage = Math.min(PAGES_N, p + 1); rp = lastAyah >= 0; lastAyah = -1; }   // يتقدّم موضع الورد
  afterReadChange(rp);
}
function startReadTimer() {
  clearInterval(readTimer); readTimer = null;
  const todo = wirdTodo(visiblePages());
  drawReadCtl(todo);
  if (readMode !== 'timer' || !todo.length || screen !== 'reader' || document.hidden) return;
  readLeft = dwell;
  const tick = () => {
    if (readLeft <= 0) { readPage(todo[0]); return; }   // يُعاد التشغيل للصفحة التالية إن بقيت
    const el = document.querySelector(`.rs[data-p="${todo[0]}"]`);
    if (el) el.textContent = `تُسجَّل في ورد القراءة بعد ${ar(readLeft)} ث`;
    readLeft--;
  };
  tick();
  readTimer = setInterval(tick, 1000);
}
// أزرار تحت الصفحات: قرأتُها، تراجع، انتهى الورد عند نهاية سورة
function onReadCtl(e) {
  const b = e.target.closest('[data-rd]'); if (!b) return;
  const p = +b.dataset.p, t = today();
  switch (b.dataset.rd) {
    case 'read': {   // قراءة اليسرى قبل اليمنى تعني قراءتهما معًا
      const vis = visiblePages();
      wirdTodo(vis).filter(q => q <= p).forEach(q => { markRead(q); if (q === lastPage) { lastPage = Math.min(PAGES_N, q + 1); } });
      const rp = lastAyah >= 0; lastAyah = -1;
      afterReadChange(rp); break;
    }
    case 'undo':
      if (readLog[t]) { readLog[t] = readLog[t].filter(q => q !== p); if (!readLog[t].length) delete readLog[t]; }
      lastPage = p; lastAyah = -1;
      afterReadChange(false); break;
    case 'stop': {
      const i = +b.dataset.i;
      for (let q = Math.min(lastPage, p); q <= p; q++) if (q >= lastPage || q === p) markRead(q);
      lastPage = p; lastAyah = i;
      afterReadChange(true); break;
    }
    case 'unstop':
      lastPage = Math.min(PAGES_N, lastPage + 1); lastAyah = -1;
      afterReadChange(true); break;
  }
}
$('rstat').addEventListener('click', onReadCtl);
$('readSt').addEventListener('click', onReadCtl);
document.addEventListener('visibilitychange', () => { if (screen === 'reader') startReadTimer(); });

function openReader(p, mode = 'read') {
  readerMode = mode; page = p;
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
  rzT = setTimeout(() => { if (wantBook() !== bookOn) renderPage(); }, 150);
});
$('pgNext').onclick = () => turn(1);
$('pgPrev').onclick = () => turn(-1);

// ---------- لا تنثني الصفحة إلا بضغط مستمر أو سحب ----------
// الضغطة القصيرة على كلمة تفتح تفسيرها فقط. نحجب ضغطة الفأرة عن مكتبة التقليب، ثم نمرّرها إليها
// إن استمر الضغط ٣٠٠ م.ث أو تحرّكت الفأرة ١٤ بكسل (نيّة سحب الورقة)
const HOLD_MS = 300, DRAG_PX = 14;
let press = null;
function startFold() {
  if (!press || press.started) return;
  press.started = true; clearTimeout(press.timer);
  press.target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: press.x, clientY: press.y, button: 0, buttons: 1 }));
}
document.addEventListener('mousedown', e => {
  if (!bookOn || !e.isTrusted || !e.target.closest('#book')) return;
  e.stopPropagation();
  if (e.button !== 0) return;   // الزر الأيمن للقائمة السريعة فقط، لا يثني الصفحة
  press = { x: e.clientX, y: e.clientY, target: e.target, started: false };
  press.timer = setTimeout(startFold, HOLD_MS);
}, true);
document.addEventListener('mousemove', e => {
  if (press && !press.started && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_PX) startFold();
}, true);
document.addEventListener('mouseup', () => { if (press) { clearTimeout(press.timer); setTimeout(() => { press = null; }, 0); } }, true);
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
  planCard();   // يحسب مقدار الحفظ والمراجعة اليوم (hifzToday وrevToday)
  const t = today(), n = readCount(t), p = Math.min(1, n / wird);
  $('wToday').innerHTML =
    `<div class="wbig">${ar(n)} <small>من ${safahat(wird)}</small></div>` +
    `<div class="prog"><span style="width:${p * 100}%"></span></div>` +
    `<div style="font-size:14px">${n >= wird ? '<span class="done-msg">أتممتَ وردك اليوم ✓ تقبّل الله منك</span>' : `بقي ${safahat(wird - n)} لإتمام الورد`}</div>`;
  $('wPlan').textContent = `بهذا الورد تختم القرآن كل ${ayyamN(Math.ceil(PAGES_N / wird))} تقريبًا.`;
  $('wContinue').textContent = `متابعة القراءة من ${wirdPosTxt()}`;

  // الختمة: المدة المتوقعة بوردك المختار؛ ومعها معدلك الفعلي منذ بدء الختمة (آخر ٧ أيام منها) بعد ثلاثة أيام على الأقل
  const kp = khatmaPages().size, left = PAGES_N - kp;
  const kDays = Math.max(1, Math.min(7, t - khatmaStart + 1));
  let kRead = 0; for (let k = 0; k < kDays; k++) kRead += readCount(t - k);
  const avg = kRead / kDays;
  $('wKhatma').innerHTML =
    `<div class="wbig">${pct(kp, PAGES_N)} <small>${ar(kp)} من ${ar(PAGES_N)} صفحة · بقي ${safahat(left)}</small></div>` +
    `<div class="prog"><span style="width:${kp / PAGES_N * 100}%;background:var(--both)"></span></div>` +
    `<div style="font-size:14px">${left === 0 ? '<span class="done-msg">🎉 أتممتَ الختمة، تقبّل الله منك</span>'
      : `بوردك (${safahat(wird)} يوميًا) تُتمّ الختمة خلال ${ayyamN(Math.ceil(left / wird))} تقريبًا` +
        (kDays >= 3 && avg > 0 ? ` · وبمعدلك الفعلي (${ar(+avg.toFixed(1))} يوميًا) خلال ${ayyamN(Math.ceil(left / avg))}` : '')}</div>` +
    `<div class="muted" style="font-size:12px;margin-top:4px">بدأت هذه الختمة ${ayyam(t - khatmaStart)}</div>`;

  // ورد الحفظ: الموضع والمقدار والمدة المتوقعة
  const all = count(0, TOTAL - 1), HM = METRICS.hifz, hn = HM.n(t), hg = HM.goal(), nx = nextHifz(1)[0];
  const hLeft = TOTAL - all.h, hLeftU = hifzLeft();
  // معدل الأسبوع لا يُعتمد إلا بعد ثلاثة أيام حفظ على الأقل، وإلا فالورد المختار
  const last7h = [...Array(7)].map((_, k) => HM.n(t - k));
  const h7 = last7h.filter(Boolean).length >= 3 ? last7h.reduce((a, b) => a + b, 0) / 7 : 0;
  $('wHifz').innerHTML = hLeft
    ? `<div class="wbig">${numTxt(hn)} <small>من ${HM.unit(hg)} اليوم</small></div>` +
      `<div class="prog"><span style="width:${Math.min(1, hn / hg) * 100}%;background:var(--hifz)"></span></div>` +
      `<div style="font-size:14px">موضعك في الحفظ: <b style="font-family:Amiri,serif;font-size:16px">${describeAyat([nx])}</b></div>` +
      `<div class="muted" style="font-size:13px;margin-top:4px">بقي ${hByPage() ? pagesTxt(hLeftU) : ayat(hLeft)} · ` +
      (h7 > 0 ? `بمعدلك في آخر أسبوع تُتمّ الحفظ خلال ${duration(Math.ceil(hLeftU / h7))}` : `بهذا الورد تُتمّ الحفظ خلال ${duration(Math.ceil(hLeftU / hg))}`) + ' تقريبًا</div>' +
      `<div class="wportion">${hifzToday.length ? `ورد اليوم: <span class="tgt">${describeAyat(hifzToday)}</span>` : '<span class="done-msg">أتممتَ ورد الحفظ اليوم ✓</span>'}</div>`
    : '<div class="done-msg">🎉 أتممتَ حفظ القرآن الكريم، تقبّل الله منك</div>';
  $('wHifzOpen').disabled = $('wHifzDone').disabled = !hifzToday.length;

  // ورد المراجعة
  const q = revQuota(), vn = revCount(t);
  $('wRev').innerHTML = all.h
    ? `<div class="wbig">${ar(vn)} <small>من ${ayat(q)} اليوم</small></div>` +
      `<div class="prog"><span style="width:${Math.min(1, vn / q) * 100}%;background:var(--both)"></span></div>` +
      `<div style="font-size:14px">${all.d ? `<b class="red">${ayat(all.d)}</b> مستحقة للمراجعة الآن` : 'لا مراجعة مستحقة الآن ✓'}</div>` +
      `<div class="muted" style="font-size:13px;margin-top:4px">${hasCustomIvl()
        ? `مقدار المراجعة اليومي من محفوظك (${ayat(all.h)})، كلٌّ بموعد مراجعته: العام (${cycleName(cycle)}) أو الخاص الذي حدّدته له`
        : `مقدار المراجعة اليومي = محفوظك (${ayat(all.h)}) ÷ ${ayyamN(cycle)}`}</div>` +
      (revToday.length ? `<div class="wportion">ورد اليوم: <span class="tgt">${describePages(revToday)}</span></div>` : '')
    : '<div class="muted" style="font-size:14px">سجّل محفوظك من الخريطة ليُحسب ورد المراجعة اليومي تلقائيًا.</div>';
  $('wRevOpen').disabled = $('wRevDone').disabled = !revToday.length;

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
  const m = METRICS[metric], goal = m.goal(), t = today();
  let L = KPI_TXT[metric];
  if (metric === 'hifz' && hByPage()) L = [L[0], 'متوسط الصفحات المحفوظة يوميًا (آخر ٧ أيام)', 'صفحة حفظتها في آخر ٣٠ يومًا', L[3]];
  const days = [...Array(30)].map((_, k) => t - 29 + k), counts = days.map(m.n);
  const total = counts.reduce((a, b) => a + b, 0), nMet = goal ? counts.filter(c => met(m, c, goal)).length : 0;
  const avg7 = counts.slice(-7).reduce((a, b) => a + b, 0) / 7;
  $('wKpis').innerHTML =
    `<div class="kpi"><div class="v">${ar(streakOf(m, goal))}</div><div class="l">${L[0]}</div></div>` +
    `<div class="kpi"><div class="v">${ar(+avg7.toFixed(1))}</div><div class="l">${L[1]}</div></div>` +
    `<div class="kpi"><div class="v">${numTxt(total)}</div><div class="l">${L[2]}</div></div>` +
    `<div class="kpi"><div class="v">${ar(nMet)}/${ar(30)}</div><div class="l">${L[3]}</div></div>`;
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
  const step = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].find(s => max * 1.15 / s <= 6 && (s >= 1 || !Number.isInteger(goal))) || 5000;
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
      bars += `<path d="M${x},${y(0)} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + w - r} Q${x + w},${yy} ${x + w},${yy + r} V${y(0)} Z" fill="${met(METRICS[metric], c, goal) ? 'var(--accent)' : 'var(--bar-low)'}"/>`;
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
  showTip(e, `${dayLabel(d)}: ${c ? m.unit(c) : 'لا شيء'}${met(m, c, goal) ? ' ✓' : ''}`);
});
$('chart').addEventListener('pointerleave', () => tip.style.display = 'none');

// أزرار الحفظ والمراجعة في شاشة الورد = أزرار «خطة اليوم» نفسها
$('wHifzOpen').onclick = () => $('hHifzOpen').click();
$('wHifzDone').onclick = () => $('hHifzDone').click();
$('wRevOpen').onclick = () => $('hRevOpen').click();
$('wRevDone').onclick = () => $('hRevDone').click();

// تسجيل حفظ يدوي: آيات من سورة تُعدّ حفظًا جديدًا اليوم
const suraOpts = SURAS.map((x, k) => `<option value="${k + 1}">${ar(k + 1)}. ${x[0]}</option>`).join('');
$('hlSura').innerHTML = suraOpts;
$('rlSura').innerHTML += suraOpts;
$('hlSura').onchange = () => { const n = SURAS[+$('hlSura').value - 1][1]; $('hlFrom').max = $('hlTo').max = n; $('hlFrom').value = 1; $('hlTo').value = n; };
$('hlSura').onchange();
$('hlLog').onclick = () => {
  const s = +$('hlSura').value, n = SURAS[s - 1][1];
  const a = int($('hlFrom').value, 1, n), b = int($('hlTo').value || $('hlFrom').value, 1, n);
  if (!a || !b) { $('hlMsg').textContent = `أدخل أرقام آيات بين ١ و${ar(n)}`; return; }
  const ids = [];
  for (let i = start[s] + Math.min(a, b) - 1; i <= start[s] + Math.max(a, b) - 1; i++) if (!(state[i] & 1)) ids.push(i);
  if (!ids.length) { $('hlMsg').textContent = 'هذه الآيات محفوظة من قبل'; return; }
  applyAct(ids, 1); save(); refreshAll();
  $('hlMsg').textContent = `سُجّلت ${ayat(ids.length)} حفظًا جديدًا اليوم ✓`;
};
// تسجيل مراجعة يدوية: سورة أو نطاق صفحات
$('rlSura').onchange = () => {
  const s = +$('rlSura').value; if (!s) return;
  $('rlFrom').value = pageOf[start[s]]; $('rlTo').value = pageOf[start[s] + SURAS[s - 1][1] - 1];
};
$('rlFrom').oninput = $('rlTo').oninput = () => { $('rlSura').value = ''; };   // كتابة الصفحات تلغي اختيار السورة
$('rlLog').onclick = () => {
  const s = +$('rlSura').value;
  let ids = [];
  if (s) { for (let i = start[s]; i < start[s] + SURAS[s - 1][1]; i++) ids.push(i); }
  else {
    const a = int($('rlFrom').value, 1, PAGES_N), b = int($('rlTo').value || $('rlFrom').value, 1, PAGES_N);
    if (!a || !b) { $('rlMsg').textContent = 'اختر سورة أو أدخل أرقام صفحات بين ١ و٦٠٤'; return; }
    const ps = []; for (let p = Math.min(a, b); p <= Math.max(a, b); p++) ps.push(p);
    ids = pageAyat(ps);
  }
  const n = applyReview(ids); save(); refreshAll();
  $('rlMsg').textContent = n ? `سُجّلت مراجعة ${ayat(n)} ✓` : 'لا محفوظ هنا لم يُراجَع اليوم';
};

$('mLog').onclick = () => {
  const a = +$('mFrom').value, b = +$('mTo').value || a;
  if (!a || a < 1 || a > PAGES_N || b < 1 || b > PAGES_N) { $('mMsg').textContent = 'أدخل أرقام صفحات بين ١ و٦٠٤'; return; }
  const [lo, hi] = a < b ? [a, b] : [b, a], d = today() - +$('mDay').value;
  let added = 0;
  for (let p = lo; p <= hi; p++) if (markRead(p, d)) added++;
  if (hi >= lastPage) { lastPage = Math.min(PAGES_N, hi + 1); lastAyah = -1; }
  save(); refreshAll();
  $('mMsg').textContent = added ? `سُجّلت ${safahat(added)} ✓` : 'هذه الصفحات مسجّلة من قبل';
};
// ---------- ضبط الختمة: موضعك الحالي فيها، أو ختمة جديدة ----------
$('kSura').innerHTML = SURAS.map((x, k) => `<option value="${k + 1}">${ar(k + 1)}. ${x[0]}</option>`).join('');
function kHint() {
  const p = int($('kPage').value, 1, PAGES_N);
  $('kHint').textContent = p ? `تُعدّ الصفحات ١–${ar(Math.max(1, p - 1))} مقروءة في هذه الختمة${p === 1 ? ' (لا شيء)' : ''}، ويبدأ ورد القراءة من صفحة ${ar(p)} (${SURAS[suraOf[pageB[p - 1][0]] - 1][0]}).` : 'أدخل رقم صفحة بين ١ و٦٠٤.';
}
$('kOpen').onclick = () => {
  $('kSet').hidden = !$('kSet').hidden;
  $('kPage').value = lastPage; $('kSura').value = suraOf[pageB[lastPage - 1][0]]; kHint();
};
$('kSura').onchange = e => { $('kPage').value = pageOf[start[+e.target.value]]; kHint(); };
$('kPage').oninput = () => { const p = int($('kPage').value, 1, PAGES_N); if (p) $('kSura').value = suraOf[pageB[p - 1][0]]; kHint(); };
$('kCancel').onclick = () => { $('kSet').hidden = true; };
$('kSave').onclick = () => {
  const p = int($('kPage').value, 1, PAGES_N); if (!p) return;
  lastPage = p; lastAyah = -1; khatmaPre = p - 1; khatmaStart = today();
  $('kSet').hidden = true; save(); refreshAll();
};
$('kNew').onclick = () => {
  if (!confirm('ستبدأ ختمة جديدة من سورة الفاتحة، ويبقى سجل قراءتك السابق محفوظًا. هل تريد المتابعة؟')) return;
  lastPage = 1; lastAyah = -1; khatmaPre = 0; khatmaStart = today();
  $('kSet').hidden = true; save(); refreshAll();
};

// ======================================================================
//  الخريطة
// ======================================================================
let view = 'suras';
try { view = localStorage.getItem(KEY + '.view') || 'suras'; } catch (e) {}
if (!GROUPS[view] || view === 'pages') view = 'suras';   // عرض الصفحات أُزيل من الخريطة (يبقى للوحة صفحة المصحف)
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
// تمتلئ البطاقة من الأسفل: ذهبي (حفظ وتفسير) ← أزرق (حفظ) ← أحمر (يحتاج إلى مراجعة) ← أخضر (تفسير، يبهت إن قَدُم)
function paintBlock(k) {
  const g = GROUPS[view][k];
  let gold = 0, blue = 0, red = 0, green = 0, fade = 0;
  for (let i = g.from; i <= g.to; i++) {
    const s = state[i];
    if (s & 1) { if (isDue(i)) red++; else if (s === 3) gold++; else blue++; }
    else if (s === 2) { green++; fade += tfFade(i); }
  }
  const tfC = green ? `color-mix(in srgb, var(--tf) ${Math.round(100 - 60 * fade / green)}%, var(--tile))` : 'var(--tf)';
  const n = g.to - g.from + 1, p1 = gold / n * 100, p2 = p1 + blue / n * 100, p3 = p2 + red / n * 100, p4 = p3 + green / n * 100;
  blkEls[k].style.background = p4 === 0 ? '' :
    `linear-gradient(to top, var(--tb) 0 ${p1}%, var(--th) ${p1}% ${p2}%, var(--tr) ${p2}% ${p3}%, ${tfC} ${p3}% ${p4}%, var(--tile) ${p4}%)`;
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
  mapEl.classList.toggle('picking', on);
  $('bulk').classList.toggle('on', on);
  document.body.classList.toggle('bulk-on', on);
  refreshBulk();
}
$('bDone').onclick = () => setPicking(false);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && picking && cur < 0) setPicking(false); });

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
  document.querySelector('[data-bact="2"]').lastChild.textContent = all(2) ? 'إلغاء التفسير' : 'قرأتُ التفسير';
  $('bRev').disabled = !ids.some(i => state[i] & 1);
  drawIvlSel($('bIvl'), ids);
  $('bClear').disabled = !n;
  const max = GROUPS[view].length;
  $('bFrom').max = $('bTo').max = max;
  $('bFrom').placeholder = '١'; $('bTo').placeholder = ar(max);
}
function pickRange(a, b, adding) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  for (let k = lo; k <= hi; k++) adding ? picked.add(k) : picked.delete(k);
}
// الضغط المطوّل (٤٥٠ م.ث) على بطاقة يبدأ التحديد المتعدد بها؛ ثم تُضاف البطاقات بالضغط أو السحب
let hold = null, skipClick = false;
const cancelHold = () => { if (hold) { clearTimeout(hold.timer); hold.el.classList.remove('holding'); hold = null; } };
mapEl.addEventListener('pointerdown', e => {
  lastPtr = e.pointerType;
  const t = e.target.closest('.t');
  if (!picking && t && e.button === 0) {
    const k = +t.dataset.g;
    t.classList.add('holding');
    hold = { el: t, x: e.clientX, y: e.clientY, timer: setTimeout(() => {
      cancelHold(); skipClick = true;
      setPicking(true);
      pdrag = { start: k, adding: true, base: new Set() };
      pickAnchor = k; picked.add(k); refreshBulk();
    }, 450) };
    return;
  }
  if (!picking || !t || e.pointerType !== 'mouse') return;
  e.preventDefault();
  const k = +t.dataset.g;
  if (e.shiftKey && pickAnchor >= 0) { pickRange(pickAnchor, k, true); refreshBulk(); return; }
  pdrag = { start: k, adding: !picked.has(k), base: new Set(picked) };
  pickAnchor = k;
  picked = new Set(pdrag.base); pickRange(k, k, pdrag.adding); refreshBulk();
});
window.addEventListener('pointermove', e => {
  if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) cancelHold();
  if (!pdrag) return;
  const t = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.t');
  if (!t) return;
  picked = new Set(pdrag.base); pickRange(pdrag.start, +t.dataset.g, pdrag.adding); refreshBulk();
});
window.addEventListener('pointerup', () => { pdrag = null; cancelHold(); });
mapEl.addEventListener('click', e => {
  const b = e.target.closest('.t'); if (!b) return;
  const k = +b.dataset.g;
  if (skipClick) { skipClick = false; return; }   // نهاية ضغطٍ مطوّل، لا فتح للوحة
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
$('bIvl').onchange = e => { applyIvl(pickedAyat(), +e.target.value); save(); refreshAll(); };

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
    const was = state[i] & 1, was2 = state[i] & 2;
    state[i] = op(state[i]);
    if (!(state[i] & 1)) { rev[i] = 0; ivl[i] = 0; todayH.delete(i); }
    else if (!was) { rev[i] = t; if (fresh) todayH.add(i); }
    if (!(state[i] & 2)) tfd[i] = 0; else if (!was2) tfd[i] = t;
  });
  if (todayH.size) hifzLog[t] = [...todayH]; else delete hifzLog[t];
}
// تُحسب الآية مرة واحدة في اليوم، ولا يُعدّ الحفظ الجديد مراجعة
// موعد المراجعة الخاص: يُطبَّق على المحفوظ من الآيات المحددة فقط
function applyIvl(ids, k) { ids.forEach(i => { if (state[i] & 1) ivl[i] = k; }); }
function drawIvlSel(el, ids) {
  const h = ids.filter(i => state[i] & 1), ks = new Set(h.map(i => ivl[i]));
  el.innerHTML = (ks.size > 1 ? '<option value="" hidden>مواعيد مختلفة</option>' : '') +
    RCYC.map((_, k) => `<option value="${k}">${ivlName(k)}</option>`).join('');
  el.value = ks.size === 1 ? [...ks][0] : '';
  el.disabled = !h.length;
  el.closest('label').title = h.length ? 'موعد مراجعة خاص بالمحفوظ المحدد، بدل الإعداد العام (للمحفوظ القديم الثابت مثلًا)' : 'حدّد آيات محفوظة لتختار موعد مراجعتها';
}
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
  showTip(e, `${g.title} · حفظ ${pct(c.h, c.n)} · تفسير ${pct(c.f, c.n)}` + (c.d ? ` · ${ayat(c.d)} تحتاج إلى مراجعة` : ''));
});
mapEl.addEventListener('pointerleave', () => tip.style.display = 'none');

// ======================================================================
//  لوحة الآيات
// ======================================================================
const sheet = $('sheet'), body = $('sBody');
let cur = -1, aEls = [], sel = new Set(), anchor = -1;
let sView = 'suras';   // مجموعة لوحة الآيات (سور/صفحات/أجزاء)، مستقلة عن عرض الخريطة

function openSheet(k, selectDue = false, v = view) {
  sView = v; cur = k; sel.clear(); anchor = -1;
  const g = GROUPS[sView][k];
  $('sTitle').textContent = g.title;
  $('sMeta').textContent = g.meta;
  let html = '', last = 0;
  for (let i = g.from; i <= g.to; i++) {
    if (suraOf[i] !== last && GROUPS[sView] !== GROUPS.suras) {
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
  $('next').disabled = k === GROUPS[sView].length - 1;
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
  const g = GROUPS[sView][cur], c = count(g.from, g.to), t = today();
  $('gStats').innerHTML =
    `<span><i class="sw" style="background:var(--hifz)"></i> حفظ ${ar(c.h)} / ${ar(c.n)}</span>` +
    `<span><i class="sw" style="background:var(--fahm)"></i> تفسير ${ar(c.f)} / ${ar(c.n)}</span>` +
    `<span><i class="sw" style="background:var(--both)"></i> كلاهما ${ar(c.b)} / ${ar(c.n)}</span>` +
    (c.h ? `<span class="${c.d ? 'red' : ''}">🔁 ${c.d ? `${ayat(c.d)} تحتاج إلى مراجعة` : 'مُراجَعة'} · آخر مراجعة: ${ayyam(t - c.latest)}</span>` : '');
  for (let i = g.from; i <= g.to; i++) {
    const el = aEls[i];
    el.className = `a s${state[i]}${isDue(i) ? ' due' : ''}${sel.has(i) ? ' sel' : ''}`;
    el.style.background = state[i] === 2 && tfFade(i) > 0.05 ? `color-mix(in srgb, var(--fahm) ${Math.round(100 - 60 * tfFade(i))}%, var(--none))` : '';
    el.title = `${SURAS[suraOf[i] - 1][0]} ${ar(ayahOf(i))}` + ((state[i] & 1) ? ` · آخر مراجعة: ${ayyam(t - rev[i])}` + (ivl[i] ? ` · تُراجَع ${cycleName(RCYC[ivl[i]])}` : '') : '') +
      ((state[i] & 2) ? ` · قرأتَ تفسيرها ${ayyam(tfAge(i))}` : '');
  }
  const n = sel.size, ids = [...sel];
  $('cnt').textContent = n ? `المحدد: ${ayat(n)}` : 'حدّد آيات لتسجيلها';
  const all = bit => n && ids.every(i => state[i] & bit);
  document.querySelectorAll('[data-act]').forEach(b => b.disabled = !n);
  document.querySelector('[data-act="1"]').lastChild.textContent = all(1) ? 'إلغاء الحفظ' : 'حفظ';
  document.querySelector('[data-act="2"]').lastChild.textContent = all(2) ? 'إلغاء التفسير' : 'قرأتُ التفسير';
  $('revBtn').disabled = !ids.some(i => state[i] & 1);
  drawIvlSel($('sIvl'), ids);
  $('sTafsir').hidden = n !== 1;   // تفسير آية واحدة محددة داخل التطبيق
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
$('sIvl').onchange = e => { applyIvl([...sel], +e.target.value); save(); refreshAll(); refreshSheet(); };
$('selAll').onclick = () => {
  const g = GROUPS[sView][cur];
  if (sel.size === g.to - g.from + 1) sel.clear();
  else for (let i = g.from; i <= g.to; i++) sel.add(i);
  refreshSheet();
};
$('toReader').onclick = () => {
  const g = GROUPS[sView][cur], first = sel.size ? Math.min(...sel) : g.from;
  sheet.classList.remove('open'); cur = -1;
  openReader(pageOf[first]);
};
$('close').onclick = closeSheet;
$('sTafsir').onclick = () => {
  const i = [...sel][0]; if (i === undefined) return;
  sheet.classList.remove('open'); cur = -1;
  openReader(pageOf[i]);
  setTimeout(() => openTafsir(i), 350);
};
$('prev').onclick = () => cur > 0 && openSheet(cur - 1, false, sView);
$('next').onclick = () => cur < GROUPS[sView].length - 1 && openSheet(cur + 1, false, sView);
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
  if (!tfIsOpen()) {
    $('tfPanel').classList.add('open');           // تنزلق اللوحة من اليسار
    $('tfPanel').setAttribute('aria-hidden', 'false');
    slideReader(() => { $('reader').classList.add('tf-open'); relayoutReader(); });   // ليُعاد حساب مقاس الكتاب بجوار اللوحة
  }
  drawTafsir();
}
const tfIsOpen = () => $('tfPanel').classList.contains('open');
function closeTafsir() {
  $('tfPanel').classList.remove('open');
  $('tfPanel').setAttribute('aria-hidden', 'true');
  tfStyle.textContent = '';
  tfAyah = -1;
  slideReader(() => { $('reader').classList.remove('tf-open'); relayoutReader(); });
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
  const fahm = (state[i] & 2) !== 0, age = tfAge(i), old = fahm && age >= TF_FADE;
  $('tfFahm').textContent = !fahm ? 'قرأتُ تفسير هذه الآية ✓' : old ? 'قرأتُه مجددًا ✓' : 'إلغاء «قرأتُ التفسير»';
  $('tfFahm').classList.toggle('pri', !fahm || old);
  $('tfState').textContent = fahm ? `✓ قرأتَ تفسيرها ${ayyam(age)}${old ? ' · لعلّك تجدّد العهد به' : ''}` : '';
  drawTfRefs();
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
  if ((state[tfAyah] & 2) && tfAge(tfAyah) >= TF_FADE) tfd[tfAyah] = today();   // تجديد القراءة
  else applyAct([tfAyah], 2);
  save(); refreshAll(); refreshPageActions(); drawTafsir();
};
document.addEventListener('keydown', e => { if (e.key === 'Escape' && tfIsOpen() && cur < 0) closeTafsir(); });

// الضغط على كلمة يفتح تفسير آيتها؛ والسحب (لتقليب الصفحة) لا يُعدّ ضغطًا
let downXY = null;
['book', 'mtext'].forEach(id => {
  $(id).addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; }, true);
  $(id).addEventListener('pointerup', e => {
    const w = e.target.closest('.w, .ay');
    if (!w || !downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 6) return;
    if (press && press.started) return;   // ضغط مستمر لتقليب الصفحة، لا لفتح التفسير
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
//  المرجعيات: آيات تجمعها في تصنيفات تسمّيها أنت (آيات الرجاء، آيات العذاب، …)
// ======================================================================
// تُضاف من لوحة التفسير (🔖) أو بالزر الأيمن على الآية في المصحف، وتُعرض في قسم «المرجعيات»
const refCats = i => refs.items.filter(x => x.i === i).map(x => x.c);
const catName = id => refs.cats.find(c => c.id === id)?.name || '';
function toggleRef(i, c) {
  const k = refs.items.findIndex(x => x.i === i && x.c === c);
  if (k >= 0) refs.items.splice(k, 1); else refs.items.push({ i, c, note: '', t: today() });
  save();
}
function addCat(name) {
  name = (name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) return null;
  const ex = refs.cats.find(c => c.name === name);
  if (ex) return ex.id;
  const id = Math.max(0, ...refs.cats.map(c => c.id)) + 1;
  refs.cats.push({ id, name });
  save();
  return id;
}
const ayahRef = i => `${SURAS[suraOf[i] - 1][0]} ${ar(ayahOf(i))}`;

// أزرار التصنيفات لآية: المختار مُعلَّم، ومعها حقل «تصنيف جديد» (لا نستخدم prompt فهو غير متاح في التطبيق)
function refChips(i) {
  const on = new Set(refCats(i));
  return refs.cats.map(c => `<button class="rchip${on.has(c.id) ? ' on' : ''}" data-cat="${c.id}">${on.has(c.id) ? '✓ ' : ''}${escHtml(c.name)}</button>`).join('') +
    `<form class="rnew" data-i="${i}"><input maxlength="40" placeholder="+ تصنيف جديد" aria-label="اسم تصنيف جديد"></form>`;
}
// معالج مشترك: الضغط على تصنيف يضيف الآية إليه أو يزيلها، وإدخال اسم جديد ينشئ التصنيف ويضيفها
function bindRefChips(box, getI, after) {
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    toggleRef(getI(), +b.dataset.cat); after();
  });
  box.addEventListener('submit', e => {
    e.preventDefault();
    const inp = e.target.querySelector('input'), id = addCat(inp.value);
    if (id && !refCats(getI()).includes(id)) toggleRef(getI(), id);
    after(true);
  });
}

// ---------- في لوحة التفسير ----------
function drawTfRefs() {
  if (tfAyah < 0) return;
  $('tfRefs').innerHTML = `<div class="rlbl">🔖 أضف إلى المرجعيات</div><div class="rchips">${refChips(tfAyah)}</div>`;
}
bindRefChips($('tfRefs'), () => tfAyah, focusNew => {
  drawTfRefs(); if (screen === 'refs') refsScreen();
  if (focusNew) $('tfRefs').querySelector('.rnew input').focus();
});

// ---------- القائمة السريعة بالزر الأيمن على آية ----------
let ctxI = -1;
function openCtx(i, x, y) {
  ctxI = i;
  const m = $('ctx');
  const h = state[i] & 1, f = state[i] & 2, t = today();
  m.innerHTML = `<div class="ch">${ayahRef(i)}</div>` +
    `<button class="ci" data-act="tafsir">📖 تفسير الآية</button>` +
    `<button class="ci" data-act="copy">📋 نسخ نص الآية</button>` +
    '<div class="csep">هذه الآية</div>' +
    `<button class="ci" data-act="hifz"><i class="sw" style="background:var(--hifz)"></i> ${h ? 'إلغاء الحفظ' : 'حفظتُها'}</button>` +
    (h ? `<button class="ci" data-act="rev"${rev[i] === t ? ' disabled' : ''}>🔁 ${rev[i] === t ? 'رُوجعت اليوم ✓' : 'راجعتُها اليوم'}</button>` : '') +
    `<button class="ci" data-act="fahm"><i class="sw" style="background:var(--fahm)"></i> ${f ? (tfAge(i) >= TF_FADE ? 'قرأتُ تفسيرها مجددًا' : 'إلغاء «قرأتُ التفسير»') : 'قرأتُ تفسيرها'}</button>` +
    (canEndAt(i) ? `<button class="ci" data-act="end">🏁 انتهى وردي عند هذه الآية</button>` : '') +
    '<button class="ci" data-act="page">📋 تفاصيل الصفحة وآياتها</button>' +
    `<div class="csep">🔖 أضف إلى المرجعيات</div><div class="rchips">${refChips(i)}</div>`;
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x - r.width, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}
const closeCtx = () => { $('ctx').hidden = true; ctxI = -1; };
['book', 'mtext'].forEach(id => $(id).addEventListener('contextmenu', e => {
  const w = e.target.closest('.w, .ay'); if (!w) return;
  e.preventDefault();
  openCtx(+w.dataset.i, e.clientX, e.clientY);
}));
// الزر الأيمن على نص محدَّد في لوحة التفسير: نسخ المحدَّد
let ctxText = '';
$('tfPanel').addEventListener('contextmenu', e => {
  const s = String(getSelection() || '').trim();
  if (!s || !e.target.closest('.tfa,.tfb')) return;
  e.preventDefault();
  ctxText = s; ctxI = -1;
  const m = $('ctx');
  m.innerHTML = '<button class="ci" data-act="copySel">📋 نسخ النص المحدَّد</button>';
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(e.clientX, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(e.clientY, innerHeight - r.height - 8)) + 'px';
});
$('ctx').addEventListener('click', e => {
  const a = e.target.closest('[data-act]'); if (!a) return;
  const i = ctxI; closeCtx();
  const act = a.dataset.act, after = () => { save(); refreshAll(); renderPage(); if (tfAyah === i) drawTafsir(); };
  if (act === 'copySel') copyText(ctxText);
  else if (act === 'tafsir') openTafsir(i);
  else if (act === 'copy') copyText(ayahCopyText(i));
  else if (act === 'hifz') { applyAct([i], 1); after(); }
  else if (act === 'rev') { applyReview([i]); after(); }
  else if (act === 'fahm') { if ((state[i] & 2) && tfAge(i) >= TF_FADE) tfd[i] = today(); else applyAct([i], 2); after(); }
  else if (act === 'end') endWirdAt(i);
  else if (act === 'page') openGroup('pages', pageOf[i] - 1);
});
// نص الآية للنسخ: بالرسم العثماني وتشكيله كما هو، بين القوسين المزخرفين، ثم اسم السورة ورقم الآية
const ayahCopyText = i => `﴿${AYAT[i]}﴾ [${SURAS[suraOf[i] - 1][0]}: ${ar(ayahOf(i))}]`;
function copyText(text) {
  const fallback = () => {
    const t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(t); t.select();
    try { document.execCommand('copy'); } catch {}
    t.remove();
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(fallback);
  else fallback();
}
bindRefChips($('ctx'), () => ctxI, focusNew => {
  const i = ctxI, r = $('ctx').getBoundingClientRect();
  if (tfAyah === i) drawTfRefs();
  if (screen === 'refs') refsScreen();
  openCtx(i, r.right, r.top);              // تُعاد القائمة مكانها لترى التغيير
  if (focusNew) $('ctx').querySelector('.rnew input').focus();
});
document.addEventListener('mousedown', e => { if (!$('ctx').hidden && !e.target.closest('#ctx')) closeCtx(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('ctx').hidden) closeCtx(); });
addEventListener('blur', closeCtx);

// ---------- قسم المرجعيات ----------
let rcSel = 0;   // ٠ = كل المرجعيات، -١ = آخر ما قرأت
function refsScreen() {
  if (rcSel > 0 && !refs.cats.some(c => c.id === rcSel)) rcSel = 0;
  const n = id => refs.items.filter(x => !id || x.c === id).length;
  $('rcList').innerHTML = [{ id: 0, name: 'كل المرجعيات' }, ...refs.cats].map(c =>
    `<button class="rc${c.id === rcSel ? ' on' : ''}" data-rc="${c.id}"><span>${escHtml(c.name)}</span><b>${ar(n(c.id))}</b></button>`).join('') +
    `<div class="rcsep"></div><button class="rc${rcSel === -1 ? ' on' : ''}" data-rc="-1"><span>🕘 آخر ما قرأت</span><b>${ar(recent.length)}</b></button>`;
  if (rcSel === -1) { recentList(); return; }
  const cat = refs.cats.find(c => c.id === rcSel);
  $('rcTitle').value = cat ? cat.name : 'كل المرجعيات';
  $('rcTitle').readOnly = !cat;
  $('rcTools').hidden = !cat;
  const list = refs.items.filter(x => !rcSel || x.c === rcSel).sort((a, b) => a.i - b.i || a.c - b.c);
  $('rcCount').textContent = list.length ? ayat(list.length) : '';
  if (!refs.cats.length) {
    $('riList').innerHTML = `<div class="rempty">لا توجد مرجعيات بعد.<br>اضغط على أي آية في المصحف ثم «🔖 أضف إلى المرجعيات» في لوحة التفسير، أو اضغط عليها بالزر الأيمن،
      لتضيفها إلى تصنيف تسمّيه أنت، مثل: آيات الرجاء، آيات العذاب، آيات تستوقفني.</div>`;
    return;
  }
  if (!list.length) { $('riList').innerHTML = '<div class="rempty">لا آيات في هذا التصنيف بعد.</div>'; return; }
  $('riList').innerHTML = list.map(x => `<div class="ri" data-i="${x.i}" data-c="${x.c}">
      <div class="rtxt">${escHtml(AYAT[x.i])} <span class="anum">﴿${ar(ayahOf(x.i))}﴾</span></div>
      <div class="rmeta"><b>${ayahRef(x.i)}</b> · صفحة ${ar(pageOf[x.i])}${rcSel ? '' : ` · <span class="rtag">${escHtml(catName(x.c))}</span>`} · أُضيفت ${ayyam(today() - x.t)}</div>
      <textarea class="rnote" maxlength="1000" placeholder="ما الذي استوقفك في هذه الآية؟ (اختياري)">${escHtml(x.note)}</textarea>
      <div class="row"><button class="btn" data-go="open">افتح في المصحف</button><button class="btn" data-go="tafsir">التفسير</button><button class="lnk" data-go="del">إزالة من التصنيف</button></div>
    </div>`).join('');
}
// آخر ما قرأت: مجمّعة بحسب اليوم، ولكل موضع سورته وجزؤه وأول آية في صفحته
function recentList() {
  $('rcTitle').value = '🕘 آخر ما قرأت'; $('rcTitle').readOnly = true; $('rcTools').hidden = true;
  $('rcCount').textContent = recent.length ? `آخر ${safahat(recent.length)} قرأتها خارج الورد` : '';
  if (!recent.length) { $('riList').innerHTML = '<div class="rempty">لم تقرأ شيئًا خارج وردك بعد.<br>كل صفحة تبقى عليها في المصحف عشر ثوانٍ فأكثر بعيدًا عن موضع الورد تظهر هنا (آخر ثلاثة مواضع).</div>'; return; }
  let html = '', lastG = null;
  recent.forEach(x => {
    const d = x.t ? today() - Math.floor((x.t - new Date(x.t).getTimezoneOffset() * 6e4) / 864e5) : null;
    const g = d === null ? 'من قبل' : d === 0 ? 'اليوم' : d === 1 ? 'أمس' : ayyam(d);
    if (g !== lastG) { html += `<div class="rgrp">${g}</div>`; lastG = g; }
    const f = pageB[x.p - 1][0];
    html += `<div class="ri rvi" data-p="${x.p}">
      <div class="rmeta"><b>${pageSura(x.p)}</b> · صفحة ${ar(x.p)} · الجزء ${ar(juzOf[f])}${x.t ? ` · ${agoTxt(x.t)}` : ''}</div>
      <div class="rtxt rfirst">${escHtml(AYAT[f])} <span class="anum">﴿${ar(ayahOf(f))}﴾</span></div>
      <div class="row"><button class="btn" data-gp="open">افتح في المصحف</button><button class="lnk" data-gp="del">إزالة من القائمة</button></div>
    </div>`;
  });
  $('riList').innerHTML = html + '<div class="row" style="justify-content:center"><button class="lnk" data-gp="clear">مسح القائمة كلها</button></div>';
}
$('riList').addEventListener('click', e => {
  const b = e.target.closest('[data-gp]'); if (!b) return;
  const p = +b.closest('[data-p]')?.dataset.p;
  if (b.dataset.gp === 'open') { openReader(p); return; }
  if (b.dataset.gp === 'del') recent = recent.filter(x => x.p !== p);
  if (b.dataset.gp === 'clear') { if (!confirm('مسح قائمة «آخر ما قرأت» كلها؟')) return; recent = []; }
  try { localStorage.setItem(KEY + '.recent', JSON.stringify(recent)); } catch (err) {}
  deskSave(); refsScreen();
});
$('rcList').addEventListener('click', e => { const b = e.target.closest('[data-rc]'); if (b) { rcSel = +b.dataset.rc; refsScreen(); } });
$('rcNew').addEventListener('submit', e => {
  e.preventDefault();
  const id = addCat($('rcNew').querySelector('input').value);
  $('rcNew').querySelector('input').value = '';
  if (id) { rcSel = id; refsScreen(); }
});
$('rcTitle').addEventListener('change', e => {
  const c = refs.cats.find(c => c.id === rcSel), v = e.target.value.trim().slice(0, 40);
  if (!c || !v || refs.cats.some(o => o.name === v && o.id !== c.id)) { refsScreen(); return; }
  c.name = v; save(); refsScreen();
});
$('rcDel').onclick = () => {
  const c = refs.cats.find(c => c.id === rcSel); if (!c) return;
  const n = refs.items.filter(x => x.c === c.id).length;
  if (!confirm(`حذف التصنيف «${c.name}»${n ? ` وإزالة ${ayat(n)} منه` : ''}؟ لا يمكن التراجع.`)) return;
  refs.cats = refs.cats.filter(o => o.id !== c.id);
  refs.items = refs.items.filter(x => x.c !== c.id);
  rcSel = 0; save(); refsScreen();
};
let noteT = null;
$('riList').addEventListener('input', e => {
  const t = e.target.closest('.rnote'); if (!t) return;
  const card = t.closest('.ri'), x = refs.items.find(o => o.i === +card.dataset.i && o.c === +card.dataset.c);
  if (!x) return;
  x.note = t.value.slice(0, 1000);
  clearTimeout(noteT); noteT = setTimeout(save, 500);
});
$('riList').addEventListener('click', e => {
  const b = e.target.closest('[data-go]'); if (!b) return;
  const card = b.closest('.ri'), i = +card.dataset.i;
  if (!card.dataset.i) return;
  if (b.dataset.go === 'del') { toggleRef(i, +card.dataset.c); refsScreen(); return; }
  openReader(pageOf[i]);
  setTimeout(() => openTafsir(i), 350);
});

// ======================================================================
//  المنبهات (في تطبيق سطح المكتب)
// ======================================================================
// تفحص الواجهة كل نصف دقيقة: إذا حلّ وقت منبّه في يوم من أيامه، تطلب من التطبيق إظهار نافذة التنبيه
// (ومنبّه الورد لا يظهر إن اكتمل الورد). «بعد ١٥ دقيقة» يعيده بعدها؛ وتركه دون اختيار يعيده كذلك حتى ثلاث مرات؛
// و«ليس اليوم» يوقفه لليوم. سجلّ اليوم (remLog) مفاتيحه أرقام المنبهات
let remLog = { day: 0, sent: {}, snooze: {}, auto: {} };
try { const o = JSON.parse(localStorage.getItem(KEY + '.remlog')); if (o && o.day === today()) remLog = { sent: {}, snooze: {}, auto: {}, ...o }; } catch (e) {}
// سجلّ الإصدارات السابقة كان بنوع الورد: يُنقل إلى رقم المنبّه حتى لا يتكرر تنبيه ظهر اليوم
['read', 'hifz', 'rev'].forEach(k => ['sent', 'snooze', 'auto'].forEach(f => {
  if (!(k in remLog[f])) return;
  const r = remind.find(x => x.kind === k);
  if (r) remLog[f][r.id] = remLog[f][k];
  delete remLog[f][k];
}));
const saveRemLog = () => { try { localStorage.setItem(KEY + '.remlog', JSON.stringify(remLog)); } catch (e) {} };
const suraName = s => SURAS[s - 1][0];
function remBody(r) {
  const t = today();
  if (r.kind === 'read') { const n = readCount(t); return n < wird ? `بقي ${safahat(wird - n)} من وردك اليوم، تبدأ من ${wirdPosTxt()}.` : null; }
  if (r.kind === 'hifz') { const ids = hifzPortion(); return ids.length ? `ورد اليوم: ${describeAyat(ids)}.` : null; }
  if (r.kind === 'rev') { const ps = reviewPortion(); return ps.length ? `ورد اليوم: ${describePages(ps)}.` : null; }
  if (r.kind === 'sura') return `حان وقت قراءة سورة ${suraName(r.sura)}.`;
  return r.text || 'تذكير من «صاحبُك القرآن».';
}
const remTitle = r => r.kind === 'sura' ? `📗 سورة ${suraName(r.sura)}` : r.kind === 'note' ? `⏰ ${r.text || 'تذكير'}` : REM_KINDS[r.kind];
function checkReminders() {
  if (!DESK) return;
  const t = today(), now = new Date(), hm = now.getHours() * 60 + now.getMinutes(), wd = now.getDay();
  if (remLog.day !== t) remLog = { day: t, sent: {}, snooze: {}, auto: {} };
  for (const r of remind) {
    if (!r.on || (r.days.length && !r.days.includes(wd))) continue;
    const [h, m] = r.time.split(':').map(Number);
    if (hm < h * 60 + m) continue;
    const snoozed = remLog.snooze[r.id];
    if (remLog.sent[r.id] && !(snoozed && Date.now() >= snoozed)) continue;
    remLog.sent[r.id] = true; delete remLog.snooze[r.id];
    const body = remBody(r);
    if (body) DESK.showReminder({ kind: 'r' + r.id, title: remTitle(r), body });
  }
  saveRemLog();
}
function openForRem(r) {
  dashboard();   // يحسب مقدار الحفظ والمراجعة الحالي
  if (!r) { showScreen('home'); return; }
  if (r.kind === 'hifz' && hifzToday.length) openReader(pageOf[hifzToday[0]], 'hifz');
  else if (r.kind === 'rev' && revToday.length) openReader(revToday[0], 'rev');
  else if (r.kind === 'sura') openReader(pageOf[start[r.sura]]);
  else if (r.kind === 'note') showScreen('home');
  else openReader(lastPage);
}
if (DESK) {
  DESK.onReminderAction(({ kind, action }) => {
    const id = +String(kind).replace(/^r/, ''), r = remind.find(x => x.id === id);
    if (action === 'snooze') remLog.snooze[id] = Date.now() + 15 * 60000;
    if (action === 'auto' && (remLog.auto[id] = (remLog.auto[id] || 0) + 1) <= 3) remLog.snooze[id] = Date.now() + 15 * 60000;
    if (action === 'open') openForRem(r);
    saveRemLog();
  });
  setTimeout(checkReminders, 5000);
  setInterval(checkReminders, 30000);
  $('autoStart').checked = DESK.getAutostart();
  $('autoStart').onchange = e => DESK.setAutostart(e.target.checked);
  $('keepTray').checked = DESK.getKeepInTray();
  $('keepTray').onchange = e => DESK.setKeepInTray(e.target.checked);
}

// ---------- قائمة المنبهات في الإعدادات ----------
const WDAYS = [[6, 'س', 'السبت'], [0, 'ح', 'الأحد'], [1, 'ن', 'الاثنين'], [2, 'ث', 'الثلاثاء'], [3, 'ر', 'الأربعاء'], [4, 'خ', 'الخميس'], [5, 'ج', 'الجمعة']];
const suraOptsAll = SURAS.map((x, k) => `<option value="${k + 1}">${ar(k + 1)}. ${x[0]}</option>`).join('');
function drawRemList() {
  const box = $('remList');
  if (!remind.length) { box.innerHTML = '<div class="remempty">لا منبهات بعد. أضف منبّهًا لورد القراءة أو الحفظ أو المراجعة، أو لسورة بعينها (كالكهف يوم الجمعة)، أو تذكيرًا تكتبه.</div>'; return; }
  box.innerHTML = remind.map(r => `<div class="remi${r.on ? '' : ' off'}" data-id="${r.id}">
      <input type="checkbox" class="tog" data-f="on" ${r.on ? 'checked' : ''} aria-label="تشغيل المنبّه">
      <select data-f="kind" aria-label="نوع المنبّه">${Object.entries(REM_KINDS).map(([k, v]) => `<option value="${k}"${k === r.kind ? ' selected' : ''}>${v}</option>`).join('')}</select>
      ${r.kind === 'sura' ? `<select data-f="sura" aria-label="السورة">${suraOptsAll}</select>` : ''}
      ${r.kind === 'note' ? `<input type="text" data-f="text" maxlength="80" placeholder="نص التذكير، مثل: أذكار المساء" value="${escHtml(r.text)}">` : ''}
      <input type="time" data-f="time" value="${r.time}" aria-label="الوقت">
      <span class="days" aria-label="الأيام">${WDAYS.map(([d, s, n]) => `<button type="button" data-day="${d}" class="${r.days.includes(d) ? 'on' : ''}" title="${n}">${s}</button>`).join('')}<em>${r.days.length ? '' : 'كل يوم'}</em></span>
      <button class="ib" data-f="del" title="حذف المنبّه">✕</button>
    </div>`).join('');
  remind.forEach(r => { if (r.kind === 'sura') box.querySelector(`[data-id="${r.id}"] [data-f="sura"]`).value = r.sura; });
  if (!DESK) box.querySelectorAll('input,select,button').forEach(x => { x.disabled = true; });
}
// أي تعديل في منبّه يُعيد إتاحة تنبيهه اليوم
function remChanged(r, redraw = true) {
  delete remLog.sent[r.id]; delete remLog.snooze[r.id]; delete remLog.auto[r.id]; saveRemLog();
  save(); if (redraw) drawRemList();
}
const remOf = el => remind.find(x => x.id === +el.closest('[data-id]').dataset.id);
$('remList').addEventListener('change', e => {
  const f = e.target.dataset.f; if (!f) return;
  const r = remOf(e.target);
  if (f === 'on') r.on = e.target.checked;
  else if (f === 'kind') r.kind = e.target.value;
  else if (f === 'sura') r.sura = +e.target.value;
  else if (f === 'time' && okTime(e.target.value)) r.time = e.target.value;
  else if (f === 'text') r.text = e.target.value.trim().slice(0, 80);
  remChanged(r, f !== 'text');
});
$('remList').addEventListener('click', e => {
  const b = e.target.closest('[data-day],[data-f="del"]'); if (!b) return;
  const r = remOf(b);
  if (b.dataset.f === 'del') { remind = remind.filter(x => x !== r); save(); drawRemList(); return; }
  const d = +b.dataset.day;
  r.days = r.days.includes(d) ? r.days.filter(x => x !== d) : [...r.days, d].sort();
  if (r.days.length === 7) r.days = [];   // كل الأيام = كل يوم
  remChanged(r);
});
$('remAdd').onclick = () => {
  const used = new Set(remind.map(r => r.kind));
  const kind = ['read', 'hifz', 'rev'].find(k => !used.has(k)) || 'read';
  const id = Math.max(0, ...remind.map(r => r.id)) + 1;
  remind.push({ id, kind, on: true, time: { read: '20:00', hifz: '06:00', rev: '17:00' }[kind], days: [], sura: 18, text: '' });
  remChanged(remind[remind.length - 1]);
  $('remList').lastElementChild.querySelector('input[type=time]').focus();
};

// ======================================================================
//  الشاشات
// ======================================================================
let screen = 'home';
try { screen = localStorage.getItem(KEY + '.screen') || 'home'; } catch (e) {}
let prevScreen = 'home';
function showScreen(s) {
  if (s === 'settings' && screen !== 'settings') prevScreen = screen;
  screen = s;
  document.body.classList.toggle('in-settings', s === 'settings');   // أقسام الإعدادات مكان أقسام التطبيق في الشريط الجانبي
  $('setTabs').hidden = s !== 'settings';
  try { localStorage.setItem(KEY + '.screen', s); } catch (e) {}
  document.querySelectorAll('.screen').forEach(el => el.classList.toggle('on', el.id === s));
  document.querySelectorAll('#tabs button, #tabs2 button').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  if (s !== 'mapScreen') setPicking(false);
  tip.style.display = 'none';
  if (s === 'reader') renderPage();
  else { clearInterval(readTimer); readTimer = null; }
  if (s === 'wird') wirdScreen();
  if (s === 'home') { dashboard(); reviewCard(); }
  if (s === 'refs') refsScreen();
  if (s === 'settings') settingsScreen();
  scrollTo(0, 0);
}
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  // تبويب المصحف يعود دائمًا إلى موضع القراءة
  if (b.dataset.s === 'reader' && readerMode !== 'read') { readerMode = 'read'; page = lastPage; }
  showScreen(b.dataset.s);
});
$('tabs2').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showScreen(b.dataset.s); });
document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => { if (b.dataset.gsec) setSec = b.dataset.gsec; showScreen(b.dataset.goto); });

function refreshAll() {
  blkEls.forEach((_, k) => paintBlock(k));
  dashboard(); reviewCard(); refreshBulk(); backupCard();
  if (screen === 'wird') wirdScreen();
  if (screen === 'refs') refsScreen();
}

// ======================================================================
//  النسخة الاحتياطية
// ======================================================================
function exportBackup() {
  const data = { app: 'quran-map', v: 4, date: new Date().toISOString(), state: state.join(''), rev: [...rev], cycle, readLog, wird, lastPage, khatmaStart, khatmaPre, hifzLog, revLog, hGoal, hDir, refs, lastAyah, ivl: ivl.join(''), hUnit, hGoalP, tfd: [...tfd] };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sahibak-al-quran-${new Date().toISOString().slice(0, 10)}.json`;
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
    khatmaPre: opt(d.khatmaPre, v => int(v, 0, PAGES_N), 0),
    refs: opt(d.refs, cleanRefs, { cats: [], items: [] }),
    hifzLog: opt(d.hifzLog, cleanHLog, {}),
    revLog: opt(d.revLog, cleanRLog, {}),
    hGoal: opt(d.hGoal, oneOf(HGOALS), hGoal),
    hDir: opt(d.hDir, cleanDir, hDir),
    lastAyah: opt(d.lastAyah, v => int(v, -1, TOTAL - 1), -1),
    ivl: opt(d.ivl, cleanIvl, '0'.repeat(TOTAL)),
    hUnit: opt(d.hUnit, v => v === 'a' || v === 'p' ? v : null, hUnit),
    hGoalP: opt(d.hGoalP, oneOf(HGOALPS), hGoalP),
    tfd: opt(d.tfd, cleanRev, []),
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
  if (!d) { alert('هذا الملف ليس نسخة صحيحة من «صاحبُك القرآن»، ولم يُغيَّر شيء من بياناتك.'); return; }
  let h = 0, fh = 0;
  for (const c of d.state) { if (c & 1) h++; if (c & 2) fh++; }
  const pages = Object.values(d.readLog).reduce((n, p) => n + p.length, 0);
  const when = d.date && !isNaN(new Date(d.date)) ? new Date(d.date).toLocaleDateString('ar-EG') : 'غير معروف';
  if (!confirm(`نسخة بتاريخ ${when}:\n• الحفظ: ${ayat(h)}\n• قراءة التفسير: ${ayat(fh)}\n• سجل القراءة: ${safahat(pages)}\n\nسيُستبدل تقدّمك الحالي بهذه النسخة. هل تريد المتابعة؟`)) return;
  const t = today();
  for (let i = 0; i < TOTAL; i++) {
    state[i] = +d.state[i];
    rev[i] = d.rev[i] || 0; ivl[i] = +d.ivl[i]; tfd[i] = d.tfd[i] || 0;
    if ((state[i] & 1) && !rev[i]) rev[i] = t;
    if ((state[i] & 2) && !tfd[i]) tfd[i] = t;
  }
  ({ cycle, readLog, wird, lastPage, lastAyah, khatmaStart, khatmaPre, hifzLog, revLog, hGoal, hDir, refs, hUnit, hGoalP } = d);
  if (lastAyah >= 0 && pageOf[lastAyah] !== lastPage) lastAyah = -1;
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
  $('hUnitSel').value = hUnit; $('hGoalPSel').value = hGoalP;
  $('hGoalSel').hidden = hByPage(); $('hGoalPSel').hidden = !hByPage();
  $('rModeSel').value = readMode; $('dwellSel').value = dwell; $('dwellSel').hidden = readMode !== 'timer';
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
  $('openBk').hidden = false;
  $('openBk').onclick = () => DESK.openBackups();
  $('appVer').textContent = `الإصدار ${DESK.version}`;
  DESK.onUpdateReady(v => {
    $('updTxt').textContent = `تحديث جديد (${v}) جاهز، ويُثبَّت تلقائيًا بصمت حين تُغلق النافذة.`;
    $('updBar').hidden = false;
  });
  $('updNow').onclick = () => { deskSave(); if (deskT) { clearTimeout(deskT); DESK.writeDataSync(deskSnapshot()); } DESK.installUpdate(); };
}

setPicking(false);
renderMap();
backupCard();
// ======================================================================
//  الإعدادات
// ======================================================================
let theme = 'auto';
try { theme = ['light', 'dark'].includes(localStorage.getItem(KEY + '.theme')) ? localStorage.getItem(KEY + '.theme') : 'auto'; } catch (e) {}
function applyTheme() {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
applyTheme();
const UPD_TXT = {
  dev: () => 'نسخة تطوير: التحديث التلقائي يعمل في النسخة المثبّتة فقط.',
  idle: () => 'لم يُبحث عن تحديث بعد.',
  checking: () => 'جارٍ البحث عن تحديث…',
  latest: () => 'لديك أحدث إصدار ✓',
  error: () => 'تعذّر البحث عن تحديث؛ تحقّق من الاتصال بالإنترنت ثم أعد المحاولة.',
  downloading: u => `جارٍ تنزيل الإصدار ${u.version || ''} في الخلفية… ${ar(u.percent || 0)}٪`,
  ready: u => `الإصدار ${u.version} جاهز ✓ ويُثبَّت تلقائيًا حين تُغلق النافذة، أو الآن من الزر فيُعاد فتح التطبيق مباشرة.`,
};
function drawUpd(u) {
  $('updState').textContent = (UPD_TXT[u.status] || UPD_TXT.idle)(u);
  $('updProg').hidden = u.status !== 'downloading';
  $('updProg').firstElementChild.style.width = (u.percent || 0) + '%';
  $('updInstall').hidden = u.status !== 'ready';
  $('updCheck').disabled = ['checking', 'downloading', 'dev'].includes(u.status);
}
// قسم واحد ظاهر من الإعدادات، يُختار من الشريط الجانبي
let setSec = 'sAlarm';
try { setSec = localStorage.getItem(KEY + '.setsec') || 'sAlarm'; } catch (e) {}
function showSec(id) {
  if (!document.querySelector(`.scard#${id}`)) id = 'sAlarm';
  setSec = id;
  try { localStorage.setItem(KEY + '.setsec', id); } catch (e) {}
  document.querySelectorAll('.scard').forEach(c => c.classList.toggle('on', c.id === id));
  document.querySelectorAll('#setTabs [data-sec]').forEach(b => b.classList.toggle('on', b.dataset.sec === id));
  scrollTo(0, 0);
}
$('setTabs').addEventListener('click', e => { const b = e.target.closest('[data-sec]'); if (b) showSec(b.dataset.sec); });
$('setBack').onclick = () => showScreen(prevScreen === 'settings' ? 'home' : prevScreen);
function settingsScreen() {
  showSec(setSec);
  syncControls();
  $('mStyle').value = mStyle;
  $('themeSel').value = theme;
  drawRemList();
  setHints();
  if (DESK) { $('setVer').textContent = `الإصدار ${DESK.version}`; drawUpd(DESK.getUpdate()); }
  else {
    $('setVer').textContent = 'نسخة المتصفح';
    $('updState').textContent = 'التحديثات التلقائية في تطبيق سطح المكتب.';
    $('updCheck').disabled = true;
    $('remCard').querySelectorAll('input,select,button').forEach(i => { i.disabled = true; });
    $('remAdd').disabled = true;
  }
}
// شروح تحت كل إعداد بحسب القيمة المختارة
function setHints() {
  $('wirdHint').textContent = `تختم به القرآن كل ${ayyamN(Math.ceil(PAGES_N / wird))} تقريبًا`;
  $('rModeHint').textContent = readMode === 'timer'
    ? 'تُحسب صفحة الورد مقروءة إذا بقيت مفتوحة هذه المدة'
    : 'يظهر تحت كل صفحة من صفحات الورد زر «قرأتُ هذه الصفحة» تضغطه حين تُتمّها';
  $('hGoalHint').textContent = hByPage()
    ? 'تُقسَّم الصفحة على آياتها بأطوالها، ويقف ورد اليوم عند أقرب نهاية آية للمقدار'
    : 'عدد الآيات الجديدة التي تحفظها كل يوم';
  let n = 0; const by = {};
  for (let i = 0; i < TOTAL; i++) if ((state[i] & 1) && ivl[i]) { n++; by[ivl[i]] = (by[ivl[i]] || 0) + 1; }
  $('ivlInfo').textContent = n ? `مواعيد خاصة: ${Object.entries(by).map(([k, c]) => `${ayat(c)} ${cycleName(RCYC[k])}`).join('، ')}` : '';
}
$('mStyle').onchange = e => {
  mStyle = e.target.value;
  try { localStorage.setItem(KEY + '.mstyle', mStyle); } catch (err) {} deskSave();
};
$('dwellSel').onchange = e => { dwell = +e.target.value; save(); if (screen === 'reader') startReadTimer(); };
$('rModeSel').onchange = e => { readMode = e.target.value; save(); syncControls(); setHints(); };
$('hUnitSel').onchange = e => { hUnit = e.target.value; save(); syncControls(); setHints(); refreshAll(); };
$('hGoalPSel').onchange = e => { hGoalP = +e.target.value; save(); refreshAll(); };
['wirdSel', 'cycle'].forEach(id => $(id).addEventListener('change', () => setHints()));
$('themeSel').onchange = e => {
  theme = e.target.value;
  try { localStorage.setItem(KEY + '.theme', theme); } catch (err) {} deskSave();
  applyTheme();
};
if (DESK) {
  DESK.onUpdateStatus(u => { if (screen === 'settings') drawUpd(u); });
  $('updCheck').onclick = () => { DESK.checkUpdate(); drawUpd({ status: 'checking' }); };
  $('updInstall').onclick = () => $('updNow').click();
}

showScreen(['home', 'reader', 'wird', 'mapScreen', 'refs', 'settings'].includes(screen) ? screen : 'home');
