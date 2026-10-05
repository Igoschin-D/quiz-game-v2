import { startApp } from './app';
import { lanAddresses } from './util/net';

const https = process.argv.includes('--https') || process.env.HTTPS === '1';
const port = Number(process.env.PORT) || 3001;
const timeScale = Number(process.env.QUIZ_TIME_SCALE) || 1;
const publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, '') || null;
const questionsFile = process.env.QUESTIONS_FILE || undefined;

const app = await startApp({ port, https, timeScale, publicUrl, questionsFile });
const proto = https ? 'https' : 'http';

console.log(`\n  Знание — сила: Arena — сервер запущен`);
console.log(`  Локально:   ${proto}://localhost:${app.port}`);
for (const ip of lanAddresses()) console.log(`  В сети:     ${proto}://${ip}:${app.port}`);
if (publicUrl) console.log(`  Публичный:  ${publicUrl}`);
if (timeScale !== 1) console.log(`  QUIZ_TIME_SCALE = ${timeScale}`);
console.log('');

const shutdown = () => app.close().finally(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
