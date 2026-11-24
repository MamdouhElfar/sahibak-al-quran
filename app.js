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
const pageB = bounds(PAGES), juzB = bounds(JUZ);
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

// ---------- التحقق من صحة البيانات (للتحميل والاسترجاع) ----------
const CYCLES = [3, 7, 14, 30, 60], WIRDS = [1, 2, 3, 4, 5, 10, 20, 40];
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
  backupDay = read('.bk', str, day) ?? 0;
  backupSnooze = read('.bkLater', str, day) ?? 0;
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
const hasData = () => state.some(x => x) || Object.keys(readLog).length > 0;

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
function streak() {
  let d = today(), n = 0;
  if (readCount(d) < wird) d--;           // اليوم لم يكتمل بعد؛ السلسلة ما زالت قائمة من أمس
  while (readCount(d) >= wird) { n++; d--; }
  return n;
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

  // ورد اليوم
  const n = readCount(today()), p = Math.min(1, n / wird);
  $('hWird').innerHTML =
    `<div class="wbig">${ar(n)} <small>من ${safahat(wird)}</small></div>` +
    `<div class="prog"><span style="width:${p * 100}%"></span></div>` +
    `<div style="font-size:14px">${n >= wird ? '<span class="done-msg">أتممتَ وردك اليوم ✓ تقبّل الله منك</span>' : `بقي ${safahat(wird - n)} لإتمام الورد`}` +
    ` · <span class="muted">الأيام المتتالية: ${ar(streak())}</span></div>`;
  $('hContinue').textContent = `متابعة القراءة من صفحة ${ar(lastPage)}`;
}

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
  const t = today(), groups = GROUPS[view], due = [];
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
      const g = groups[x.k], name = groups === GROUPS.suras ? g.title.replace('سورة ', '') : g.title;
      return `<button class="chip" data-g="${x.k}"><b>${name}</b><span>${ayat(x.d)} · ${ayyam(t - x.oldest)}</span></button>`;
    }).join('') + (due.length > MAX ? `<span class="more">و${units(due.length - MAX)} أخرى</span>` : '');
  } else {
    let next = Infinity;
    for (let i = 0; i < TOTAL; i++) if (state[i] & 1) next = Math.min(next, rev[i] + cycle);
    const dd = next - t;
    $('rvList').innerHTML = `<span class="more">أقرب مراجعة ${dd <= 1 ? 'غدًا' : `بعد ${ayyamN(dd)}`} بإذن الله</span>`;
  }
}
$('rvList').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (c) openSheet(+c.dataset.g, true);
});
$('cycle').value = cycle;
$('cycle').addEventListener('change', e => { cycle = +e.target.value; save(); refreshAll(); });

// ======================================================================
//  المصحف
// ======================================================================
let page = lastPage, readTimer = null, readLeft = 0;
const BASMALA = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ';

$('rSura').innerHTML = '<option value="">انتقل إلى سورة…</option>' + SURAS.map((s, k) => `<option value="${k + 1}">${ar(k + 1)}. ${s[0]}</option>`).join('');
$('rJuz').innerHTML = '<option value="">الجزء…</option>' + JUZ.map((_, k) => `<option value="${k + 1}">الجزء ${ar(k + 1)}</option>`).join('');
$('rSura').onchange = e => { if (e.target.value) openReader(pageOf[start[+e.target.value]]); e.target.value = ''; };
$('rJuz').onchange = e => { if (e.target.value) openReader(pageOf[juzB[+e.target.value - 1][0]]); e.target.value = ''; };
$('rPage').onchange = e => openReader(Math.min(PAGES_N, Math.max(1, +e.target.value || 1)));
document.documentElement.style.setProperty('--qfs', fontSize + 'px');
const setFs = d => { fontSize = Math.min(40, Math.max(18, fontSize + d)); document.documentElement.style.setProperty('--qfs', fontSize + 'px'); save(); };
$('fsUp').onclick = () => setFs(2);
$('fsDown').onclick = () => setFs(-2);

function renderPage() {
  const [f, t] = pageB[page - 1];
  let html = '';
  for (let i = f; i <= t; i++) {
    const s = suraOf[i], a = ayahOf(i);
    if (a === 1) {
      html += `<div class="sura-h">سورة ${SURAS[s - 1][0]}</div>`;
      if (s !== 1 && s !== 9) html += `<span class="basm">${BASMALA}</span>`;
    }
    const cls = isDue(i) ? ' due' : '';
    html += `<span class="ay${cls}" data-i="${i}">${AYAT[i]}</span> <span class="anum">۝${ar(a)}</span> `;
  }
  $('mtext').innerHTML = html;
  $('mpSura').textContent = `سورة ${SURAS[suraOf[f] - 1][0]}`;
  $('mpJuz').textContent = `الجزء ${ar(juzOf[f])}`;
  $('mpNum').textContent = ar(page);
  $('rPage').value = page;
  $('pgPrev').disabled = page === 1;
  $('pgNext').disabled = page === PAGES_N;
  refreshPageActions();
  startReadTimer();
}

function refreshPageActions() {
  const [f, t] = pageB[page - 1], c = count(f, t);
  document.querySelector('[data-pact="1"]').lastChild.textContent = c.h === c.n ? 'إلغاء الحفظ' : 'حفظ';
  document.querySelector('[data-pact="2"]').lastChild.textContent = c.f === c.n ? 'إلغاء الفهم' : 'فهم';
  $('pRev').disabled = !c.h;
  $('mpToday').textContent = `اليوم: ${safahat(readCount(today()))}`;
}

function startReadTimer() {
  clearInterval(readTimer); readTimer = null;
  const st = $('readSt');
  if (readOn(today()).includes(page)) { st.className = 'readst ok'; st.textContent = '✓ قُرئت اليوم'; return; }
  if (screen !== 'reader' || document.hidden) { st.className = 'readst'; st.textContent = ''; return; }
  readLeft = DWELL;
  const tick = () => {
    if (readLeft <= 0) {
      clearInterval(readTimer); readTimer = null;
      markRead(page); save();
      st.className = 'readst ok'; st.textContent = '✓ قُرئت اليوم';
      refreshPageActions(); dashboard();
      return;
    }
    st.className = 'readst'; st.textContent = `تُسجَّل القراءة بعد ${ar(readLeft)} ث`;
    readLeft--;
  };
  tick();
  readTimer = setInterval(tick, 1000);
}
document.addEventListener('visibilitychange', () => { if (screen === 'reader') startReadTimer(); });

function openReader(p) {
  page = p; lastPage = p; save();
  if (screen !== 'reader') showScreen('reader'); else { renderPage(); scrollTo(0, 0); }
}
function turn(d) {
  const p = page + d;
  if (p < 1 || p > PAGES_N) return;
  page = p; lastPage = p; save();
  renderPage();
  scrollTo({ top: 0, behavior: 'smooth' });
}
$('pgNext').onclick = () => turn(1);
$('pgPrev').onclick = () => turn(-1);
// السحب باللمس: من اليسار إلى اليمين = الصفحة التالية (كتقليب المصحف)
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

document.querySelectorAll('[data-pact]').forEach(b => b.onclick = () => {
  const [f, t] = pageB[page - 1], ids = [];
  for (let i = f; i <= t; i++) ids.push(i);
  applyAct(ids, +b.dataset.pact); save(); refreshAll(); renderPage();
});
$('pRev').onclick = () => {
  const [f, t] = pageB[page - 1], ids = [];
  for (let i = f; i <= t; i++) ids.push(i);
  applyReview(ids); save(); refreshAll(); renderPage();
};
$('pOpen').onclick = () => {
  if (view !== 'pages') { view = 'pages'; try { localStorage.setItem(KEY + '.view', view); } catch (e) {} renderMap(); }
  openSheet(page - 1);
};
['hContinue', 'wContinue'].forEach(id => $(id).onclick = () => openReader(lastPage));

// ======================================================================
//  متابعة الورد
// ======================================================================
$('wirdSel').value = wird;
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

  // مؤشرات آخر ٣٠ يومًا
  const days = [...Array(30)].map((_, k) => t - 29 + k), counts = days.map(readCount);
  const total = counts.reduce((a, b) => a + b, 0), met = counts.filter(c => c >= wird).length;
  $('wKpis').innerHTML =
    `<div class="kpi"><div class="v">${ar(streak())}</div><div class="l">أيام متتالية أتممت فيها الورد</div></div>` +
    `<div class="kpi"><div class="v">${ar(+last7.toFixed(1))}</div><div class="l">متوسط الصفحات يوميًا (آخر ٧ أيام)</div></div>` +
    `<div class="kpi"><div class="v">${ar(total)}</div><div class="l">صفحة في آخر ٣٠ يومًا</div></div>` +
    `<div class="kpi"><div class="v">${ar(met)}/${ar(30)}</div><div class="l">يومًا أتممت فيه الورد</div></div>`;
  drawChart(days, counts);
}

// رسم أعمدة: الزمن من اليمين (الأقدم) إلى اليسار (اليوم)، وخط متقطع لمقدار الورد
function drawChart(days, counts) {
  const W = 640, H = 230, padR = 34, padL = 8, padT = 12, padB = 26;
  const max = Math.max(wird, ...counts, 1), top = Math.ceil(max * 1.15);
  const iw = W - padR - padL, ih = H - padT - padB, bw = iw / days.length;
  const y = v => padT + ih - v / top * ih;
  const xOf = k => W - padR - (k + 1) * bw;      // k=0 الأقدم على اليمين
  let g = '';
  const step = top <= 5 ? 1 : top <= 12 ? 2 : top <= 30 ? 5 : 10;
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
      bars += `<path d="M${x},${y(0)} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + w - r} Q${x + w},${yy} ${x + w},${yy + r} V${y(0)} Z" fill="${c >= wird ? 'var(--accent)' : 'var(--bar-low)'}"/>`;
    }
    hits += `<rect class="hit" data-k="${k}" x="${xOf(k)}" y="${padT}" width="${bw}" height="${ih}"/>`;
    if (k % 5 === 4 || k === counts.length - 1) {
      const dt = dayDate(days[k]);
      g += `<text x="${xOf(k) + bw / 2}" y="${H - 8}" text-anchor="middle">${k === counts.length - 1 ? 'اليوم' : `${ar(dt.getUTCDate())}/${ar(dt.getUTCMonth() + 1)}`}</text>`;
    }
  });
  const wy = y(wird);
  const line = `<line x1="${padL}" x2="${W - padR}" y1="${wy}" y2="${wy}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="5 4" opacity=".7"/>`;
  $('chart').innerHTML = g + bars + line + hits;
  $('chart').dataset.days = JSON.stringify(days);
}
$('chart').addEventListener('pointermove', e => {
  const h = e.target.closest('.hit');
  if (!h) { tip.style.display = 'none'; return; }
  const d = JSON.parse($('chart').dataset.days)[+h.dataset.k], c = readCount(d);
  showTip(e, `${dayLabel(d)}: ${c ? safahat(c) : 'لا قراءة'}${c >= wird ? ' ✓' : ''}`);
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
  const t = today();
  ids.forEach(i => {
    const was = state[i] & 1;
    state[i] = op(state[i]);
    if (!(state[i] & 1)) rev[i] = 0;
    else if (!was) rev[i] = t;
  });
}
function applyReview(ids) {
  const t = today();
  ids.forEach(i => { if (state[i] & 1) rev[i] = t; });
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
$('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showScreen(b.dataset.s); });
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
  const data = { app: 'quran-map', v: 3, date: new Date().toISOString(), state: state.join(''), rev: [...rev], cycle, readLog, wird, lastPage, khatmaStart };
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
  };
  return Object.values(out).includes(null) ? null : out;
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
  ({ cycle, readLog, wird, lastPage, khatmaStart } = d);
  save(); syncControls(); renderMap(); refreshAll();
};

// ---------- تذكير النسخة الاحتياطية ----------
function backupCard() {
  const t = today(), since = t - backupDay;
  const need = hasData() && since >= 7 && t - backupSnooze >= 3;
  $('bkCard').hidden = !need;
  $('bkWhen').textContent = backupDay ? `آخر نسخة احتياطية حفظتها كانت ${ayyam(since)}.` : 'لم تحفظ أي نسخة احتياطية بعد.';
  $('bkInfo').textContent = backupDay ? `(آخر نسخة: ${ayyam(since)})` : '';
}

// ---------- مزامنة النوافذ المفتوحة: نافذة قديمة لا تكتب فوق تغييرات نافذة أحدث ----------
function syncControls() {
  $('cycle').value = cycle; $('wirdSel').value = wird;
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

setPicking(false);
renderMap();
backupCard();
showScreen(['home', 'reader', 'wird', 'mapScreen'].includes(screen) ? screen : 'home');
