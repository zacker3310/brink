import { chromium } from '@playwright/test';
import fs from 'node:fs';
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
p.on('console', (m) => console.log('page:', m.text()));
p.on('pageerror', (e) => console.log('err:', e.message));
await p.goto('http://localhost:8765/index.html');
await p.waitForFunction(() => window.ready === true, null, { timeout: 30000 });
const res = await p.evaluate(() => window.renderAll());
for (const [k, v] of Object.entries(res)) {
  fs.writeFileSync(`${out}/${k}.png`, Buffer.from(v.url.split(',')[1], 'base64'));
  console.log(k, v.px, 'px', v.metres.toFixed(1), 'm');
}
await b.close();
