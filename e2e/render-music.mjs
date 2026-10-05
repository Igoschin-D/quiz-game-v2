// Renders every synthesized stage track to e2e/music-preview/<track>.wav and prints level statistics,
// so the music can be checked (and listened to) without playing a game.
// Usage: npm run build && node e2e/render-music.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'e2e', 'music-preview');
mkdirSync(out, { recursive: true });
const PORT = 3098;
const SECONDS = 24;
const TRACKS = ['intro', 'category', 'mutator', 'powerups', 'question', 'running', 'results', 'next'];

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('Chrome/Edge not found, set CHROME_PATH');

function wav(samples, rate) {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => pcm.writeInt16LE(Math.max(-1, Math.min(1, v)) * 32767, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const server = spawn(process.execPath, ['server/dist/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('сервер запущен') && resolve());
  setTimeout(() => reject(new Error('server start timeout')), 15000);
});
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`http://localhost:${PORT}/host`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => typeof window.__zsaRenderTrack === 'function', { timeout: 15000 });
  for (const id of TRACKS) {
    const samples = await page.evaluate((t, sec) => window.__zsaRenderTrack(t, sec), id, SECONDS);
    let peak = 0;
    let sum = 0;
    for (const v of samples) {
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
    }
    const rms = Math.sqrt(sum / samples.length);
    writeFileSync(path.join(out, `${id}.wav`), wav(samples, 32000));
    const verdict = peak < 0.01 ? 'SILENT!' : peak > 1.5 ? 'too loud (clipping)' : 'ok';
    console.log(`${id.padEnd(9)} peak ${peak.toFixed(2)}  rms ${rms.toFixed(3)}  ${verdict}`);
  }
  console.log(`WAV previews: ${out}`);
} finally {
  await browser.close();
  server.kill();
}
