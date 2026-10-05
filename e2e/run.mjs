// End-to-end acceptance test: 1 host screen + 2 phones (+3 bots) play a full game in headless Chrome.
// Usage: npm run build && npm run e2e     (set CHROME_PATH if Chrome/Edge is installed elsewhere)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'e2e', 'screenshots');
mkdirSync(shots, { recursive: true });
const PORT = 3099;
const BASE = `http://localhost:${PORT}`;
const TIME_SCALE = process.env.QUIZ_TIME_SCALE ?? '1';

// Fresh question file per run (seeded with defaults); correct answers come from the host-only API.
const QUESTIONS_FILE = path.join(mkdtempSync(path.join(os.tmpdir(), 'quiz-e2e-')), 'questions.json');
// question text -> correct answer index (from the host-only API); the order of rounds is random
const BANK = new Map();
const ROUND_COUNT = 2;
const PER_ROUND = 2;
const ROUNDS = ROUND_COUNT * PER_ROUND; // questions in the game

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = chromeCandidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('Chrome/Edge not found, set CHROME_PATH');

const errors = [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const proc = spawn(process.execPath, ['server/dist/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), QUIZ_TIME_SCALE: TIME_SCALE, QUESTIONS_FILE, QUIZ_POWERUP_CHANCE: '1', QUIZ_ROUNDS: String(ROUND_COUNT), QUIZ_QUESTIONS_PER_ROUND: String(PER_ROUND), QUIZ_MUTATOR: 'double', QUIZ_INTRO_PLAYER_SECONDS: '60' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => errors.push(`[server] ${d}`));
  return new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => String(d).includes('сервер запущен') && resolve(proc));
    proc.on('exit', (code) => reject(new Error(`server exited ${code}`)));
    setTimeout(() => reject(new Error('server start timeout')), 15000);
  });
}

function watch(page, label) {
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(`[${label}] console: ${m.text()}`);
  });
}

async function phase(page) {
  return page.$eval('[data-testid="phase"]', (el) => el.getAttribute('data-phase')).catch(() => null);
}

const ORDER = ['LOBBY', 'INTRO', 'CATEGORY', 'MUTATOR', 'POWERUPS', 'POWERUP_SHOW', 'QUESTION', 'LOCKED', 'RUNNING', 'REVEAL', 'DROP', 'NEXT_QUESTION', 'FINAL'];

/** Resolves once the host is in `wanted` or any later phase of question `qi` (short phases can be missed under load). */
async function waitPhase(page, wanted, qi, timeout = 60000) {
  await page.waitForFunction(
    (order, w, q) => {
      const el = document.querySelector('[data-testid="phase"]');
      if (!el) return false;
      const ph = el.getAttribute('data-phase');
      const cur = Number(el.getAttribute('data-q'));
      return ph === 'FINAL' || cur > q || (cur === q && order.indexOf(ph) >= order.indexOf(w));
    },
    { timeout, polling: 100 },
    ORDER,
    wanted,
    qi,
  );
}

/** Phone of the victim (never answers right): get through whatever power-up hit this player. */
async function answerUnderEffects(page, answer) {
  await page.waitForSelector(`[data-testid="answer-${answer}"], [data-testid="bombed"], [data-testid="catapulted"]`, { timeout: 15000 });
  if (await page.$('[data-testid="catapulted"]')) {
    log('  effects on Айгерим: 🚀 катапульта');
    return 'catapulted';
  }
  const note = await page.$eval('[data-testid="effect-note"]', (el) => el.textContent).catch(() => '');
  if (note) log('  effects on Айгерим:', note.trim());
  if (await page.$('[data-testid="bombs"]')) {
    await page.waitForSelector('[data-testid="bomb"]');
    await page.$eval('[data-testid="bomb"]', (el) => el.click());
    await page.waitForSelector('[data-testid="bombed"]', { timeout: 5000 });
    return 'bombed';
  }
  if (await page.$('[data-testid="slime"]')) {
    const box = await (await page.$('[data-testid="slime"]')).boundingBox();
    await page.screenshot({ path: path.join(shots, 'phone-Айгерим-slime.png') });
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    for (let y = box.y + 10; y < box.y + box.height; y += 24) {
      await page.mouse.move(box.x + 5, y, { steps: 3 });
      await page.mouse.move(box.x + box.width - 5, y, { steps: 6 });
    }
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('[data-testid="slime"]'), { timeout: 5000 });
  }
  const frozen = await page.$('.answer-btn.frozen');
  if (frozen) await page.screenshot({ path: path.join(shots, 'phone-Айгерим-frozen.png') });
  const clicks = frozen ? 3 : 1;
  for (let i = 0; i < clicks; i++) await page.click(`[data-testid="answer-${answer}"]`).catch(() => undefined);
  return frozen ? 'frozen' : 'answered';
}

/** Phone of p1: use the first power-up it owns (attacks go to Айгерим). */
async function usePowerupAs(page, host, qi) {
  await page.waitForSelector('[data-testid="powerup-panel"]', { timeout: 20000 });
  const buttons = await page.$$eval('[data-testid^="powerup-"]:not([data-testid="powerup-panel"])', (els) => els.map((e) => e.getAttribute('data-testid')));
  log(`  Даниил owns: ${buttons.join(', ')}`);
  if (qi === 1) await page.screenshot({ path: path.join(shots, 'phone-Даниил-powerups.png') });
  const kinds = [];
  for (const id of buttons) {
    await page.click(`[data-testid="${id}"]`);
    const picker = await page.waitForSelector('[data-testid="target-picker"]', { timeout: 1500 }).catch(() => null);
    if (picker) {
      if (id === 'powerup-bet') await page.click('[data-testid="target-self"]');
      else {
        await page.$$eval('[data-testid="target-row"]', (els) => els.find((e) => e.textContent?.includes('Айгерим'))?.click());
      }
    }
    kinds.push(id);
    await sleep(400);
  }
  await page.waitForSelector('[data-testid="toasts"]', { timeout: 3000 }).catch(() => undefined);
  if (qi === 1) await page.screenshot({ path: path.join(shots, 'phone-Даниил-powerups-used.png') });
  const used = await host.$eval('[data-testid="phase-banner"]', (el) => el.textContent).catch(() => '');
  log(`  host banner: ${used}`);
  await host.click('[data-testid="skip"]').catch(() => undefined); // the 7 s window may already be over on a slow machine
  if (qi === 1) {
    // the used power-ups are played out on the big screen: everybody lines up, attackers run to their targets
    const inShow = await host
      .waitForFunction(() => document.querySelector('[data-testid="phase"]')?.getAttribute('data-phase') === 'POWERUP_SHOW', { timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (inShow) {
      await page.waitForSelector('[data-testid="phone-powerup-show"]', { timeout: 3000 }).catch(() => undefined);
      await sleep(4500);
      await host.screenshot({ path: path.join(shots, 'host-powerup-show.png') });
      log('  power-up show played out');
    }
  }
  for (let i = 0; i < 3; i++) {
    if ((await phase(host)) !== 'POWERUP_SHOW') break;
    await host.click('[data-testid="skip"]').catch(() => undefined);
    await sleep(300);
  }
  return kinds;
}

async function setupPlayer(browser, code, name, avatar, filter, comment) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  watch(page, name);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/join/${code}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="name-input"]');
  await page.type('[data-testid="name-input"]', name);
  await page.click('[data-testid="name-submit"]');
  await page.waitForSelector('[data-testid="take-photo"]', { timeout: 15000 });
  await sleep(600);
  await page.click('[data-testid="take-photo"]');
  await page.waitForSelector('[data-testid="photo-done"]');
  await page.$$eval(
    '.chip',
    (els, f) => els.find((e) => e.textContent?.trim() === f)?.click(),
    filter,
  );
  await page.$$eval('.chip.sticker', (els) => els[1]?.click());
  await sleep(300);
  await page.screenshot({ path: path.join(shots, `phone-${name}-editor.png`) });
  await page.click('[data-testid="photo-done"]');
  await page.waitForSelector('.avatar-card');
  // the preferred colour may already be taken (bots / other phones): take the first free one then
  await page.$$eval('.avatar-card', (els, want) => {
    const free = els.filter((e) => !e.classList.contains('taken'));
    (free.find((e) => e.getAttribute('data-testid') === `avatar-${want}`) ?? free[0]).click();
  }, avatar);
  await sleep(300);
  await page.click('[data-testid="avatar-next"]');
  await page.waitForSelector('[data-testid="ready"]');
  await page.type('[data-testid="comment-input"]', comment);
  await page.screenshot({ path: path.join(shots, `phone-${name}-ready.png`) });
  await page.click('[data-testid="ready"]');
  await page.waitForFunction(() => location.pathname.startsWith('/play/'));
  return page;
}

async function main() {
  log('server…');
  const server = await startServer();
  for (const q of await fetch(`${BASE}/api/questions`).then((r) => r.json())) BANK.set(q.question, q.correctAnswer);
  log('question bank:', BANK.size);
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
    ],
  });
  const pages = {};
  try {
    const host = await browser.newPage();
    pages.host = host;
    watch(host, 'host');
    await host.setViewport({ width: 1280, height: 720 });
    await host.goto(`${BASE}/questions`, { waitUntil: 'networkidle0' });
    await host.waitForSelector('.qe-card');
    await host.screenshot({ path: path.join(shots, 'host-0-questions.png') });
    await host.goto(`${BASE}/host?fresh=1&testPlayers=3`, { waitUntil: 'networkidle0' });
    await host.waitForSelector('[data-testid="create-game"]:not([disabled])');
    await host.click('[data-testid="create-game"]');
    await host.waitForSelector('[data-testid="room-code"]');
    await host.waitForSelector('[data-testid="qr"]');
    const code = (await host.$eval('[data-testid="room-code"]', (el) => el.textContent)).trim();
    log('room', code);

    const p1 = await setupPlayer(browser, code, 'Даниил', 'red', 'Смешной', 'Люблю быстрые ответы');
    const p2 = await setupPlayer(browser, code, 'Айгерим', 'blue', 'Ч/Б', 'Мастер спорта по шахматам');
    pages.p1 = p1;
    pages.p2 = p2;
    log('players ready');
    await host.$$eval('.controls .btn', (els) => els.find((e) => e.textContent?.includes('бота'))?.click());
    await host.waitForFunction(() => document.querySelectorAll('.lobby-list li:not(.empty)').length >= 5);
    await sleep(2500);
    const lobbyText = await host.$eval('.lobby-list', (el) => el.textContent);
    if (/Даниил|Айгерим/.test(lobbyText) || !/Игрок #1/.test(lobbyText)) throw new Error(`lobby must be anonymous: ${lobbyText}`);
    await host.screenshot({ path: path.join(shots, 'host-1-lobby.png') });
    await p1.screenshot({ path: path.join(shots, 'phone-Даниил-lobby.png') });

    await host.click('[data-testid="start-game"]');
    await host.waitForSelector('[data-testid="intro-rules"]', { timeout: 10000 });
    await p1.waitForSelector('[data-testid="phone-intro"]');
    await host.screenshot({ path: path.join(shots, 'host-1b-rules.png') });
    // page through the cards quickly (they also advance on their own), remember what each card showed
    const seen = {};
    let introPhoto = null;
    while ((await phase(host)) === 'INTRO') {
      const text = await host.$eval('[data-testid="intro-card"]', (el) => el.textContent).catch(() => '');
      for (const name of ['Даниил', 'Айгерим']) if (text.includes(name)) seen[name] = text;
      if (text.includes('Даниил') && introPhoto === null) {
        await sleep(700); // let the pop-in animation of the card finish
        introPhoto = await host.$eval('[data-testid="intro-photo"] img', (el) => ({ ok: el.naturalWidth > 0, w: el.getBoundingClientRect().width })).catch(() => false);
        await host.screenshot({ path: path.join(shots, 'host-1c-intro-card.png') });
        // screenshots are slow: freeze the game meanwhile so the next card is not missed
        await host.click('[data-testid="pause"]');
        await host.waitForSelector('[data-testid="paused"]');
        await p1.screenshot({ path: path.join(shots, 'phone-Даниил-intro.png') });
        await host.click('[data-testid="pause"]');
        await host.waitForFunction(() => !document.querySelector('[data-testid="paused"]'));
      }
      await host.click('[data-testid="skip"]').catch(() => undefined);
      await sleep(300);
    }
    if (!/Люблю быстрые ответы/.test(seen['Даниил'] ?? '')) throw new Error(`intro card Даниил: ${seen['Даниил']}`);
    if (!/Мастер спорта по шахматам/.test(seen['Айгерим'] ?? '')) throw new Error(`intro card Айгерим: ${seen['Айгерим']}`);
    if (!introPhoto || !introPhoto.ok || introPhoto.w < 150) throw new Error(`intro photo is not clearly visible: ${JSON.stringify(introPhoto)}`);
    log('intro cards ok, photo', Math.round(introPhoto.w) + 'px');
    const seenCategories = [];
    let roundCategory = null;
    for (let qi = 0; qi < ROUNDS; qi++) {
      if (qi % PER_ROUND === 0) {
        // first question of a round: the category carousel decides the topic of the whole round
        await host.waitForSelector('[data-testid="category-carousel"]', { timeout: 30000 });
        roundCategory = await host.$eval('[data-testid="category-carousel"]', (el) => el.getAttribute('data-winner'));
        seenCategories.push(roundCategory);
        if (qi === 0) {
          await p1.waitForSelector('[data-testid="phone-category"]', { timeout: 5000 });
          await sleep(1500);
          await host.screenshot({ path: path.join(shots, 'host-2a-carousel-spin.png') });
          await host.waitForSelector('.carousel-card.winner', { timeout: 10000 });
          await host.screenshot({ path: path.join(shots, 'host-2b-carousel-done.png') });
        }
      } else {
        // later questions keep the category and get the mutator twist (once per round)
        await host.waitForSelector('[data-testid="mutator-card"]', { timeout: 30000 });
        const kind = await host.$eval('[data-testid="mutator-card"]', (el) => el.getAttribute('data-mutator'));
        if (kind !== 'double') throw new Error(`unexpected mutator ${kind}`);
        await p1.waitForSelector('[data-testid="phone-mutator"]', { timeout: 5000 });
        if (qi === 1) await host.screenshot({ path: path.join(shots, 'host-2c-mutator.png') });
        if (await host.$('[data-testid="category-carousel"]')) throw new Error('carousel must not repeat inside a round');
      }
      if (qi > 0) await usePowerupAs(p1, host, qi);
      await waitPhase(host, 'QUESTION', qi);
      const badge = await host.$eval('[data-testid="category-badge"]', (el) => el.textContent).catch(() => '');
      if (!badge.includes(roundCategory)) throw new Error(`category badge "${badge}" does not match the round category "${roundCategory}"`);
      const mutBadge = await host.$eval('[data-testid="mutator-badge"]', (el) => el.textContent).catch(() => '');
      if (qi % PER_ROUND === 0 && mutBadge) throw new Error('first question of a round must not be a mutator question');
      if (qi % PER_ROUND !== 0 && !/Двойные/.test(mutBadge)) throw new Error(`mutator badge missing: "${mutBadge}"`);
      log(`Q${qi + 1} [${roundCategory}]${mutBadge ? ' ' + mutBadge.trim() : ''}`);
      if (qi === 0) {
        await p1.click('[data-testid="react-🔥"]');
        await host.screenshot({ path: path.join(shots, 'host-3a-reaction.png') });
      }
      if (qi === 1) {
        await host.click('[data-testid="pause"]');
        await host.waitForSelector('[data-testid="paused"]');
        await p1.waitForSelector('[data-testid="phone-paused"]');
        await sleep(1500);
        await host.screenshot({ path: path.join(shots, 'host-pause.png') });
        await p1.screenshot({ path: path.join(shots, 'phone-Даниил-pause.png') });
        await host.click('[data-testid="pause"]');
        await host.waitForFunction(() => !document.querySelector('[data-testid="paused"]'));
        log('pause/resume ok');
      }
      // the host screen hides the question while players answer: it is read on the phone
      await host.waitForSelector('[data-testid="host-question-hidden"]');
      const qText = await p1.$eval('.q-text', (el) => el.textContent);
      if (!BANK.has(qText)) throw new Error(`unknown question on screen: ${qText}`);
      const correct = BANK.get(qText);
      const wrong = (correct + 1) % 4;
      await p1.waitForSelector(`[data-testid="answer-${correct}"]`, { timeout: 15000 });
      await p1.click(`[data-testid="answer-${correct}"]`);
      await p1.waitForSelector('.picked'); // before the (slow) victim handling below, the question may end meanwhile
      // the victim's effects are fiddly and slow on a loaded machine: a miss is logged, not fatal
      const outcome = await answerUnderEffects(p2, wrong).catch((e) => `missed (${String(e.message).slice(0, 60)})`);
      if (qi > 0) log(`  Айгерим: ${outcome}`);
      if (outcome === 'catapulted') {
        // the victim is shot into the host screen when the others start running
        await waitPhase(host, 'RUNNING', qi);
        await sleep(1800);
        await host.screenshot({ path: path.join(shots, 'host-catapult.png') });
      }
      if (qi === 0) {
        await p1.screenshot({ path: path.join(shots, 'phone-Даниил-q1-answered.png') });
        await host.screenshot({ path: path.join(shots, 'host-2-question.png') });
      }
      await waitPhase(host, 'RUNNING', qi);
      if (qi === 0) {
        await sleep(1200);
        await host.screenshot({ path: path.join(shots, 'host-3-running.png') });
        // only meaningful while the host is still in RUNNING (a slow machine may already be past it)
        const before = await phase(host);
        const leaked = await p1.$('.result.ok, .result.bad');
        const after = await phase(host);
        if (leaked && before === 'RUNNING' && after === 'RUNNING') throw new Error('correct answer shown on phone before robots arrived');
      }
      await waitPhase(host, 'REVEAL', qi);
      if (qi === 0) {
        await sleep(400);
        await host.screenshot({ path: path.join(shots, 'host-4-reveal.png') });
      }
      await waitPhase(host, 'DROP', qi);
      if (qi === 0) {
        await sleep(900);
        await host.screenshot({ path: path.join(shots, 'host-5-drop.png') });
        await sleep(1200);
        await host.screenshot({ path: path.join(shots, 'host-5b-drop-later.png') });
        await p2.screenshot({ path: path.join(shots, 'phone-Айгерим-q1-fell.png') });
      }
      if (qi < ROUNDS - 1) {
        await waitPhase(host, 'NEXT_QUESTION', qi);
        if (qi === 0) {
          await sleep(600);
          await host.screenshot({ path: path.join(shots, 'host-6-next.png') });
        }
        if ((await phase(host)) === 'NEXT_QUESTION') await host.click('[data-testid="next-question"]');
      }
    }
    await waitPhase(host, 'FINAL', 99);
    await host.waitForSelector('[data-testid="final"]');
    await host.waitForSelector('[data-testid="podium-1"]');
    await sleep(6500); // the winners drop onto the 3D podium one after another
    await host.screenshot({ path: path.join(shots, 'host-7-final.png') });
    const podium1 = await host.$eval('[data-testid="podium-1"]', (el) => el.textContent);
    if (!/Даниил/.test(podium1)) throw new Error(`podium 1st place: ${podium1}`);
    await p1.screenshot({ path: path.join(shots, 'phone-Даниил-final.png') });
    await p2.screenshot({ path: path.join(shots, 'phone-Айгерим-final.png') });

    const winner = await host.$eval('.winner-name', (el) => el.textContent);
    const board = await host.$$eval('.final-list li', (els) =>
      els.map((e) => ({ name: e.querySelector('.sname')?.textContent, score: Number(e.querySelector('.sscore')?.textContent) })),
    );
    log('winner:', winner);
    log('ranking:', board.map((r, i) => `${i + 1}. ${r.name} ${r.score}`).join(' | '));
    const danil = board.find((r) => r.name === 'Даниил');
    const aigerim = board.find((r) => r.name === 'Айгерим');
    if (!winner.includes('Даниил')) throw new Error(`expected Даниил to win, got ${winner}`);
    if (!danil || danil.score < ROUNDS * 100) throw new Error(`Даниил should have >= 400: ${danil?.score}`);
    if (aigerim?.score !== 0) throw new Error(`Айгерим should have 0 points: ${aigerim?.score}`);
    if (new Set(seenCategories).size !== ROUND_COUNT) throw new Error(`rounds must have different categories: ${seenCategories.join(', ')}`);
    log('categories:', seenCategories.join(' → '));
    log('PASS');
  } catch (e) {
    for (const [name, pg] of Object.entries(pages)) {
      await pg.screenshot({ path: path.join(shots, `FAIL-${name}.png`) }).catch(() => undefined);
      const text = await pg.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300)).catch(() => '');
      console.log(`[${name}] ${text}`);
    }
    throw e;
  } finally {
    await browser.close();
    server.kill();
  }
  if (errors.length) {
    console.log('\nBrowser/server errors:');
    for (const e of errors) console.log('  ' + e);
  }
}

main().catch((e) => {
  console.error('FAIL', e);
  if (errors.length) console.log(errors.join('\n'));
  process.exit(1);
});
