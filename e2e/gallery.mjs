// Opens /gallery (all power-up looks in a close-up) and saves screenshots, including the catapult sequence.
// Usage: npm run build && node e2e/gallery.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'e2e', 'screenshots');
mkdirSync(out, { recursive: true });
const PORT = 3097;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('Chrome/Edge not found, set CHROME_PATH');

const server = spawn(process.execPath, ['server/dist/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('сервер запущен') && resolve());
  setTimeout(() => reject(new Error('server start timeout')), 15000);
});
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()));
  await page.setViewport({ width: 1600, height: 900 });
  await page.goto(`http://localhost:${PORT}/gallery`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="gallery-running"]');
  await sleep(5000); // robots drop from the sky and settle
  await page.screenshot({ path: path.join(out, 'gallery-1-question.png') });
  await sleep(1500);
  await page.screenshot({ path: path.join(out, 'gallery-1b-question.png') });
  await page.$eval('[data-testid="gallery-running"]', (el) => el.click());
  for (const [i, ms] of [300, 400, 400, 400, 400, 300, 300, 400, 600, 900, 1500].entries()) {
    await sleep(ms);
    await page.screenshot({ path: path.join(out, `gallery-2-catapult-${i}.png`) });
  }
  // the power-up show: line-up, then one power-up after another, the camera glides from pair to pair
  await page.$eval('[data-testid="gallery-question"]', (el) => el.click());
  await sleep(6000);
  await page.$eval('[data-testid="gallery-show"]', (el) => el.click());
  await sleep(1800);
  for (let i = 0; i < 16; i++) {
    await page.screenshot({ path: path.join(out, `gallery-3-show-${String(i).padStart(2, '0')}.png`) });
    await sleep(1400);
  }
  // the finale: 3D podium
  await page.$eval('[data-testid="gallery-question"]', (el) => el.click());
  await sleep(4000);
  await page.$eval('[data-testid="gallery-final"]', (el) => el.click());
  for (let i = 0; i < 8; i++) {
    await sleep(1800);
    await page.screenshot({ path: path.join(out, `gallery-4-final-${i}.png`) });
  }
  console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no browser errors');
} finally {
  await browser.close();
  server.kill();
}
