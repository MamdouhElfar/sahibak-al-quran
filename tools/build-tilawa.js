// يبني محرّك التسميع (Tilawa) في vendor/tilawa: ملف واحد tilawa.mjs، ومشغّل ONNX (WASM) ومرجع الكلمات.
// نموذج التعرّف نفسه (نحو ٦٨ م.ب) لا يُضمَّن: يُنزَّل من tilawa.dev عند أول تسميع ويُحفظ في مجلد البيانات.
// الاستخدام: npm run build:tilawa   (بعد npm install)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = p => path.join(root, 'node_modules', p);
const out = path.join(root, 'vendor', 'tilawa');
fs.mkdirSync(path.join(out, 'ort'), { recursive: true });

// onnxruntime-web/all يتضمن WebGPU؛ نكتفي بنسخة WASM (أصغر، والمعالج يكفي: ٥ ثوانٍ من التلاوة في نحو ٠٫٤ ثانية)
const entry = path.join(out, '.entry.mjs');
fs.writeFileSync(entry, "export { createTilawa, prepareMicrophone } from '@tilawa/core/web';\nexport { ayahsRecited, MODEL_REGISTRY } from '@tilawa/core';\n");
try {
  execFileSync(process.execPath, [nm('esbuild/bin/esbuild'), entry, '--bundle', '--format=esm', '--platform=browser', '--target=chrome130', '--minify',
    '--alias:onnxruntime-web/all=onnxruntime-web/wasm', `--outfile=${path.join(out, 'tilawa.mjs')}`, '--log-level=warning'], { stdio: 'inherit', cwd: root });
} finally { fs.rmSync(entry, { force: true }); }

const copy = (from, to) => fs.copyFileSync(nm(from), path.join(out, to));
copy('onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.mjs');
copy('onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort/ort-wasm-simd-threaded.wasm');
fs.writeFileSync(path.join(out, 'ort', 'LICENSE'), `onnxruntime-web ${require(nm('onnxruntime-web/package.json')).version}
Copyright (c) Microsoft Corporation. Licensed under the MIT License.
https://github.com/microsoft/onnxruntime/blob/main/LICENSE
`);
copy('@tilawa/core/assets/ref-v2.json', 'ref-v2.json');
copy('@tilawa/core/LICENSE', 'LICENSE');
copy('@tilawa/core/NOTICE.md', 'NOTICE.md');
console.log('vendor/tilawa جاهز:', require(nm('@tilawa/core/package.json')).version, '· onnxruntime-web', require(nm('onnxruntime-web/package.json')).version);
