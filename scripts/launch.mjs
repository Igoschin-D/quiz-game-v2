// One-click launcher: install deps (first run), build, start the HTTPS server, open the host screen.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.ZSA_PORT) || 3001;
const DEV_PORT = Number(process.env.ZSA_DEV_PORT) || 5173;
// fresh=1: the host screen starts a brand-new room instead of rejoining the last one (no leftover bots).
const fresh = process.argv.includes('bots') ? '?fresh=1&testPlayers=6' : '?fresh=1';
const query = process.argv.includes('bots') ? '?testPlayers=6' : '';
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';

const say = (text = '') => console.log(text ? `  ${text}` : '');

function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(800, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function openBrowser(url) {
  if (process.env.ZSA_NO_BROWSER) return;
  const [cmd, args] = isWin ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: isWin }).unref();
}

function npmRun(args, quiet) {
  const res = isWin
    ? spawnSync(`${npm} ${args.join(' ')}`, { cwd: root, shell: true, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' })
    : spawnSync(npm, args, { cwd: root, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' });
  if (res.status !== 0) {
    if (quiet) console.log(`${res.stdout ?? ''}\n${res.stderr ?? ''}`);
    say('Не удалось выполнить: npm ' + args.join(' '));
    say('Пришлите текст ошибки выше.');
    process.exit(1);
  }
}

async function main() {
  if (await isListening(DEV_PORT)) {
    say('Игра уже запущена в режиме разработки — открываю браузер.');
    openBrowser(`http://localhost:${DEV_PORT}/host${query}`);
    return;
  }
  if (await isListening(PORT)) {
    say('Игра уже запущена — открываю браузер.');
    openBrowser(`https://localhost:${PORT}/host${query}`);
    return;
  }

  if (!existsSync(path.join(root, 'node_modules'))) {
    say('Первый запуск: устанавливаю зависимости, это займёт 1–2 минуты...');
    npmRun(['install', '--no-audit', '--no-fund'], false);
  }

  say('Собираю игру...');
  npmRun(['run', 'build'], true);

  say();
  say('================================================================');
  say(' Игра запускается, через несколько секунд откроется браузер.');
  say();
  say(' Браузер предупредит о сертификате — это нормально для локальной');
  say(' игры: «Дополнительно» → «Перейти на сайт». На телефонах так же.');
  say();
  say(' НЕ ЗАКРЫВАЙТЕ ЭТО ОКНО — пока оно открыто, игра работает.');
  say(' Чтобы остановить игру, закройте окно.');
  say('================================================================');

  const server = spawn(process.execPath, ['server/dist/index.js', '--https'], {
    cwd: root,
    stdio: 'inherit',
    // Test mode: power-ups drop almost always, so they are easy to try out.
    env: { ...process.env, PORT: String(PORT), ...(process.argv.includes('bots') ? { QUIZ_POWERUP_CHANCE: '0.9' } : {}) },
  });
  server.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => server.kill());

  for (let i = 0; i < 60; i++) {
    if (await isListening(PORT)) {
      openBrowser(`https://localhost:${PORT}/host${fresh}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  say('Сервер не ответил за 30 секунд — посмотрите сообщения выше.');
}

main();
