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
    checks['التفسير الميسر يظهر'] = $('tfBody').textContent.length > 40 && !$('tfPanel').hidden;
    closeTafsir();

    // موضع الورد لا يتحرك بالتصفّح
    lastPage = 425; openReader(300); await wait(800);
    checks['التصفّح لا يحرّك موضع الورد'] = lastPage === 425 && $('readSt').textContent.includes('تصفّح حر');

    // المرجعيات
    const c = addCat('اختبار'); toggleRef(start[2], c); showScreen('refs'); await wait(200);
    checks['المرجعيات تُضاف وتُعرض'] = document.querySelectorAll('#riList .ri').length === 1;

    // الخريطة: الضغط المطوّل يبدأ التحديد المتعدد، والضغطة القصيرة تفتح اللوحة
    showScreen('mapScreen'); view = 'suras'; renderMap(); await wait(200);
    const tile = blkEls[1], rc = tile.getBoundingClientRect(), ev = (t, o = {}) => tile.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: rc.x + 5, clientY: rc.y + 5, button: 0, pointerType: 'mouse', ...o }));
    ev('pointerdown'); await wait(600); ev('pointerup'); tile.click();
    checks['الضغط المطوّل يبدأ التحديد المتعدد'] = picking && picked.has(1) && cur < 0;
    setPicking(false);
    tile.click(); await wait(100);
    checks['الضغطة القصيرة تفتح لوحة السورة'] = cur === 1 && sView === 'suras';
    $('close').click();
    checks['لا عرض للصفحات في الخريطة'] = !document.querySelector('#views [data-v="pages"]');

    // لوحة التفسير لا تختلط بزر التفسير في لوحة الآيات
    checks['لوحة التفسير بمعرّف فريد'] = document.querySelectorAll('#tfPanel').length === 1 && !document.getElementById('tafsir');

    // الإعدادات: الإصدار وحالة التحديث، وشكل المصحف «نص متصل»
    showScreen('settings'); await wait(200);
    checks['الإعدادات تعرض الإصدار والتحديث'] = $('setVer').textContent.includes(qmDesktop.version) && $('updState').textContent.length > 5;
    $('mStyle').value = 'plain'; $('mStyle').dispatchEvent(new Event('change'));
    openReader(50); await wait(600);
    checks['شكل «نص متصل» يعرض صفحة واحدة بخط أميري'] = !bookOn && $('mtext').querySelectorAll('.ay').length > 0;
    $('mStyle').value = 'm1441'; $('mStyle').dispatchEvent(new Event('change'));
    openReader(77); await wait(1200);
    checks['العودة إلى مصحف المدينة'] = bookOn;

    // مدة احتساب الصفحة من الإعدادات
    showScreen('settings'); $('dwellSel').value = '5'; $('dwellSel').dispatchEvent(new Event('change'));
    lastPage = 200; openReader(200); await wait(400);
    checks['مدة احتساب الصفحة تتبع الإعدادات'] = dwell === 5 && readLeft <= 5 && $('readSt').textContent.includes('ث');

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
