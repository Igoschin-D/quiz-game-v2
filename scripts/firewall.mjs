// Opens the game ports in Windows Firewall so phones on the same Wi-Fi can connect.
// Run via "Разрешить доступ с телефонов.cmd" (asks for administrator rights once).
import { spawnSync } from 'node:child_process';

const say = (s = '') => console.log(s);
const NAME = 'Quiz Arena (phones)';
const ps = (cmd) =>
  spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { encoding: 'utf8' });

const res = ps(
  [
    `Remove-NetFirewallRule -DisplayName '${NAME}' -ErrorAction SilentlyContinue | Out-Null`,
    `New-NetFirewallRule -DisplayName '${NAME}' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001,5173 -Profile Private,Public,Domain | Out-Null`,
    `Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { $_.InterfaceAlias + ': ' + $_.IPAddress }`,
  ].join('; '),
);

if (res.status !== 0) {
  say(res.stderr || res.stdout);
  say('Не удалось добавить правило. Запустите файл ещё раз и нажмите «Да» в окне Windows.');
  process.exit(1);
}
say('Готово! Порты игры (3001, 5173) открыты для телефонов.');
say();
say('Адреса этого компьютера:');
say(res.stdout.trim());
say();
say('Телефоны должны быть в той же Wi-Fi сети, что и компьютер.');
say('Если QR всё равно не открывается — роутер может изолировать устройства');
say('(гостевая сеть / «изоляция клиентов»). Тогда используйте туннель, см. README.');
