// يُنفَّذ داخل نافذة التطبيق في اختبار الشاشة؛ آخر قيمة هي النتيجة المُرسلة إلى tests/smoke.js
(async () => {
  const errors = [];
  addEventListener('error', e => errors.push(e.message));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const checks = {};
  try {
    const h = () => state.reduce((n, x) => n + (x & 1), 0);
    checks['نسخة سطح المكتب متصلة'] = !!window.qmDesktop && !!DESK;
    checks['استُرجعت البيانات من data.json'] = h() === 7 && readOn(today()).includes(1);
    checks['خطوط الواجهة محلية'] = await document.fonts.load('16px Tajawal').then(f => f.length > 0);
    checks['خط الصفحة ٧٧ محلي'] = await loadQcf(77);
    checks['مكتبة التقليب محمّلة'] = typeof St !== 'undefined' && !!St.PageFlip;

    // المصحف
    openReader(77, 'rev'); await wait(1500);
    const mt = bookOn ? bookEls[idxOf(77)].querySelector('.mtext') : $('mtext');
    checks['المصحف يعرض ١٥ سطرًا'] = mt.querySelectorAll('.ml').length === 15;
    if (bookOn) { turn(1); await wait(1300); checks['التقليب إلى الصفحة التالية'] = visiblePages().includes(79); }

    // التفسير
    openTafsir(start[2] + 1); await wait(1500);
    checks['التفسير الميسر يظهر'] = $('tfBody').textContent.length > 40 && !$('tafsir').hidden;
    closeTafsir();

    // الحفظ في الملف
    applyAct([start[114]], 1); save(); await wait(900);
    const file = qmDesktop.readData();
    checks['الحفظ يُكتب في data.json'] = !!file && file.keys['quranMap.v1'][start[114]] === '1';

    // الشاشات
    for (const s of ['home', 'wird', 'mapScreen', 'reader']) { showScreen(s); await wait(200); }
    checks['تنقّل الشاشات بلا أخطاء'] = errors.length === 0;
    return { ok: true, checks, errors };
  } catch (e) {
    return { ok: false, checks, errors, error: String(e && e.stack || e) };
  }
})();
