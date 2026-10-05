import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { GAME_CONFIG, QUESTIONS, type ClientToServerEvents, type RoomState, type ServerToClientEvents } from '@quiz/shared';
import { startApp, type RunningApp } from '../src/app';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

// Tests play the first four questions in list order, without categories (no carousel, no random subset).
process.env.QUIZ_NO_SHUFFLE = '1';
const TEST_QUESTIONS = QUESTIONS.slice(0, 4).map(({ category: _c, ...q }) => q);
const PLAIN = () => TEST_QUESTIONS;
/** After the power-up window the big screen plays the used power-ups out (POWERUP_SHOW): skip both. */
const toQuestion = (room: { phase: string; skip(): void }) => {
  while (room.phase === 'POWERUPS' || room.phase === 'POWERUP_SHOW') room.skip();
};

let app: RunningApp;
let url: string;
const sockets: Client[] = [];

before(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zsa-test-'));
  const file = path.join(dir, 'questions.json');
  writeFileSync(file, JSON.stringify(TEST_QUESTIONS));
  app = await startApp({ port: 0, timeScale: 0.02, questionsFile: file });
  url = `http://localhost:${app.port}`;
});

after(async () => {
  for (const s of sockets) s.disconnect();
  await app.close();
});

function client(base = url): Promise<Client> {
  const s: Client = connect(base, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

function call<T>(fn: (cb: (res: T) => void) => void): Promise<T> {
  return new Promise((resolve) => fn(resolve));
}

function waitFor(s: Client, pred: (st: RoomState) => boolean, timeoutMs = 5000): Promise<RoomState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.off('state', onState);
      reject(new Error('timeout waiting for state'));
    }, timeoutMs);
    const onState = (st: RoomState) => {
      if (pred(st)) {
        clearTimeout(timer);
        s.off('state', onState);
        resolve(st);
      }
    };
    s.on('state', onState);
  });
}

const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

test('full game: join, setup, 4 questions, scoring, reconnect', async () => {
  const host = await client();
  const created = await call<any>((cb) => host.emit('host:create', cb));
  assert.equal(created.ok, true);
  const roomId: string = created.roomId;
  assert.match(roomId, /^[0-9]{4}$/, 'the game code is four digits');

  const p1 = await client();
  const p2 = await client();
  const j1 = await call<any>((cb) => p1.emit('player:join', { roomId: roomId.toLowerCase() }, cb));
  const j2 = await call<any>((cb) => p2.emit('player:join', { roomId }, cb));
  assert.equal(j1.ok && j2.ok, true);

  const empty = await call<any>((cb) => p1.emit('player:ready', { ready: true }, cb));
  assert.equal(empty.ok, false, 'cannot be ready without a name');

  for (const [p, name, avatar] of [[p1, 'Даниил', 'red'], [p2, 'Айгерим', 'blue']] as const) {
    assert.equal((await call<any>((cb) => p.emit('player:profile', { name, avatar }, cb))).ok, true);
    assert.equal((await call<any>((cb) => p.emit('player:photo', { dataUrl: TINY_JPEG }, cb))).ok, true);
    assert.equal((await call<any>((cb) => p.emit('player:ready', { ready: true }, cb))).ok, true);
  }

  const photo = await fetch(`${url}/api/rooms/${roomId}/photo/${j1.playerId}`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/jpeg');

  assert.equal((await call<any>((cb) => host.emit('host:addBots', { count: 2 }, cb))).ok, true);
  const notHost = await call<any>((cb) => p1.emit('host:start', cb));
  assert.equal(notHost.ok, false, 'players cannot control the game');

  const firstQ = waitFor(host, (s) => s.phase === 'QUESTION' && s.questionIndex === 0);
  assert.equal((await call<any>((cb) => host.emit('host:start', cb))).ok, true);
  let st = await firstQ;
  assert.equal(st.players.length, 4);
  assert.equal(st.correctAnswer, null, 'correct answer hidden during QUESTION');

  for (let qi = 0; qi < TEST_QUESTIONS.length; qi++) {
    if (qi > 0) st = await waitFor(host, (s) => s.phase === 'QUESTION' && s.questionIndex === qi);
    const correct = TEST_QUESTIONS[qi].correctAnswer;
    const wrong = (correct + 1) % 4;
    assert.equal((await call<any>((cb) => p1.emit('player:answer', { questionIndex: qi, answer: correct }, cb))).ok, true);
    const again = await call<any>((cb) => p1.emit('player:answer', { questionIndex: qi, answer: wrong }, cb));
    assert.equal(again.ok, false, 'answer cannot be changed');

    if (qi === 1) {
      // p2 drops out mid-question and must not block the round; rejoins later with its token.
      p2.disconnect();
    } else {
      const p2sock = qi > 1 ? sockets[sockets.length - 1] : p2;
      assert.equal(
        (await call<any>((cb) => p2sock.emit('player:answer', { questionIndex: qi, answer: wrong }, cb))).ok,
        true,
      );
    }

    const revealed = await waitFor(host, (s) => s.phase === 'REVEAL' && s.questionIndex === qi);
    assert.equal(revealed.correctAnswer, correct);
    const dropped = await waitFor(host, (s) => s.phase === 'DROP' && s.questionIndex === qi);
    const me = dropped.players.find((p) => p.id === j1.playerId)!;
    assert.equal(me.result, 'correct');
    assert.ok(me.lastDelta >= GAME_CONFIG.CORRECT_POINTS);

    if (qi === 1) {
      const back = await client();
      const rj = await call<any>((cb) => back.emit('player:join', { roomId, token: j2.token }, cb));
      assert.equal(rj.playerId, j2.playerId, 'reconnect keeps the same player');
      const afterRejoin = await waitFor(host, (s) => s.players.find((p) => p.id === j2.playerId)?.connected === true);
      assert.equal(afterRejoin.players.find((p) => p.id === j2.playerId)!.name, 'Айгерим');
      host.emit('host:next');
    } else if (qi < TEST_QUESTIONS.length - 1) {
      await waitFor(host, (s) => s.phase === 'NEXT_QUESTION');
      host.emit('host:next');
    }
  }

  const final = await waitFor(host, (s) => s.phase === 'FINAL');
  const pl1 = final.players.find((p) => p.id === j1.playerId)!;
  const pl2 = final.players.find((p) => p.id === j2.playerId)!;
  assert.ok(pl1.score >= TEST_QUESTIONS.length * GAME_CONFIG.CORRECT_POINTS, `p1 score ${pl1.score}`);
  // streak bonuses (3rd and 4th correct answer in a row) come on top
  assert.ok(pl1.score <= TEST_QUESTIONS.length * (GAME_CONFIG.CORRECT_POINTS + GAME_CONFIG.SPEED_BONUS_MAX) + 2 * GAME_CONFIG.STREAK_BONUS_MAX);
  assert.equal(pl2.score, 0);

  const host2 = await client();
  const rejoin = await call<any>((cb) => host2.emit('host:rejoin', { roomId, hostToken: created.hostToken }, cb));
  assert.equal(rejoin.ok, true, 'host can reconnect with token');
  const restarted = waitFor(host2, (s) => s.phase === 'LOBBY');
  host2.emit('host:restart');
  const lobby = await restarted;
  assert.ok(lobby.players.every((p) => p.score === 0));
});

test('timer locks the question when nobody answers', async () => {
  const host = await client();
  const created = await call<any>((cb) => host.emit('host:create', cb));
  const p = await client();
  await call<any>((cb) => p.emit('player:join', { roomId: created.roomId }, cb));
  await call<any>((cb) => p.emit('player:profile', { name: 'Тихий' }, cb));
  host.emit('host:start');
  const locked = await waitFor(host, (s) => s.phase === 'LOCKED');
  assert.equal(locked.players[0].result, null, 'result hidden until REVEAL');
  await waitFor(host, (s) => s.phase === 'RUNNING');
  const reveal = await waitFor(host, (s) => s.phase === 'REVEAL');
  assert.equal(reveal.players[0].result, 'none');
  const drop = await waitFor(host, (s) => s.phase === 'DROP');
  assert.equal(drop.players[0].score, 0);
});

test('pause freezes the round and resume continues it', async () => {
  const host = await client();
  const created = await call<any>((cb) => host.emit('host:create', cb));
  const p = await client();
  await call<any>((cb) => p.emit('player:join', { roomId: created.roomId }, cb));
  await call<any>((cb) => p.emit('player:profile', { name: 'Пауза' }, cb));
  const q = waitFor(host, (s) => s.phase === 'QUESTION');
  host.emit('host:start');
  await q;
  const paused = waitFor(host, (s) => s.paused);
  assert.equal((await call<any>((cb) => host.emit('host:pause', { paused: true }, cb))).ok, true);
  const ps = await paused;
  assert.ok(ps.pausedRemainingMs !== null && ps.pausedRemainingMs > 0);
  await new Promise((r) => setTimeout(r, GAME_CONFIG.ANSWER_TIME_SECONDS * 1000 * 0.02 * 2));
  const rejected = await call<any>((cb) => p.emit('player:answer', { questionIndex: 0, answer: 1 }, cb));
  assert.equal(rejected.ok, false, 'no answers while paused');
  const resumed = waitFor(host, (s) => !s.paused && s.phase === 'QUESTION');
  assert.equal((await call<any>((cb) => host.emit('host:pause', { paused: false }, cb))).ok, true);
  await resumed;
  const locked = waitFor(host, (s) => s.phase === 'LOCKED');
  assert.equal((await call<any>((cb) => p.emit('player:answer', { questionIndex: 0, answer: 1 }, cb))).ok, true);
  await locked;
});

test('questions API: local only, validated, used by the next game', async () => {
  const base = `${url}/api/questions`;
  const list = (await (await fetch(base)).json()) as unknown[];
  assert.equal(list.length, TEST_QUESTIONS.length);
  const remote = await fetch(base, { headers: { 'x-forwarded-for': '192.168.1.50' } });
  assert.equal(remote.status, 403, 'phones / proxied requests cannot read answers');
  const bad = await fetch(base, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ question: '', answers: ['a', 'b', 'c', 'd'], correctAnswer: 0 }]) });
  assert.equal(bad.status, 400);
  const custom = [
    { question: 'Два плюс два?', answers: ['3', '4', '5', '22'], correctAnswer: 1 },
    { question: 'Цвет неба днём?', answers: ['Зелёный', 'Красный', 'Голубой', 'Чёрный'], correctAnswer: 2 },
  ];
  const saved = await fetch(base, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(custom) });
  assert.equal(saved.status, 200);
  const host = await client();
  const created = await call<any>((cb) => host.emit('host:create', cb));
  const p = await client();
  await call<any>((cb) => p.emit('player:join', { roomId: created.roomId }, cb));
  await call<any>((cb) => p.emit('player:profile', { name: 'Вопросы' }, cb));
  const q = waitFor(host, (s) => s.phase === 'QUESTION');
  host.emit('host:start');
  const st = await q;
  assert.equal(st.totalQuestions, 2);
  assert.equal(st.question?.text, 'Два плюс два?');
  await fetch(base, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(TEST_QUESTIONS) });
});

test('intro: rules card, then player cards reveal names and comments one by one', async () => {
  // real-time scale: cards must not advance on their own while the test skips through them
  const slowFile = path.join(mkdtempSync(path.join(tmpdir(), 'zsa-intro-')), 'q.json');
  writeFileSync(slowFile, JSON.stringify(TEST_QUESTIONS));
  const slow = await startApp({ port: 0, timeScale: 1, questionsFile: slowFile });
  const slowUrl = `http://localhost:${slow.port}`;
  try {
    await introScenario(slowUrl);
  } finally {
    await slow.close();
  }
});

async function introScenario(base: string) {
  const host = await client(base);
  const created = await call<any>((cb) => host.emit('host:create', cb));
  const joined: { sock: Client; id: string }[] = [];
  for (const [name, comment] of [['Первый', 'Люблю чай'], ['Второй', 'Люблю кофе']] as const) {
    const s = await client(base);
    const j = await call<any>((cb) => s.emit('player:join', { roomId: created.roomId }, cb));
    await call<any>((cb) => s.emit('player:profile', { name, comment }, cb));
    joined.push({ sock: s, id: j.playerId });
  }
  const skipInLobby = await call<any>((cb) => host.emit('host:skip', cb));
  assert.equal(skipInLobby.ok, false, 'nothing to skip in the lobby');

  const lobbyState = waitFor(host, (s) => s.phase === 'LOBBY');
  host.emit('host:addBots', { count: 0 }); // forces a fresh broadcast
  const lobby = await lobbyState;
  assert.ok(lobby.players.every((p) => !p.revealed && p.comment === null), 'anonymous in the lobby');

  const rules = waitFor(host, (s) => s.phase === 'INTRO' && s.introPlayerId === null);
  host.emit('host:start');
  const r = await rules;
  assert.equal(r.introTotal, 2);
  assert.ok(r.players.every((p) => !p.revealed && p.comment === null), 'nobody revealed on the rules card');

  const first = waitFor(host, (s) => s.phase === 'INTRO' && s.introPlayerId === joined[0].id);
  assert.equal((await call<any>((cb) => host.emit('host:skip', cb))).ok, true);
  const s1 = await first;
  assert.equal(s1.players.find((p) => p.id === joined[0].id)!.comment, 'Люблю чай');
  assert.equal(s1.players.find((p) => p.id === joined[1].id)!.revealed, false, 'second player still hidden');
  assert.equal(s1.players.find((p) => p.id === joined[1].id)!.comment, null);

  const second = waitFor(host, (s) => s.phase === 'INTRO' && s.introPlayerId === joined[1].id);
  host.emit('host:skip');
  const s2 = await second;
  assert.ok(s2.players.every((p) => p.revealed));

  const q = waitFor(host, (s) => s.phase === 'QUESTION');
  host.emit('host:skip');
  const sq = await q;
  assert.equal(sq.questionIndex, 0);
  assert.ok(sq.players.every((p) => p.revealed), 'everybody revealed during the game');
}

test('power-ups: shield, attacks, reduced time, bets, bombs', async () => {
  const { Room } = await import('../src/game/Room');
  const make = () => {
    const room = new Room('TEST01', () => undefined, 0.02, PLAIN);
    const a = room.addPlayer(null);
    const b = room.addPlayer(null);
    a.name = 'Атакующий';
    b.name = 'Цель';
    room.start();
    const toPowerups = () => {
      room.skip(); // rules → first card
      room.skip(); // → second card
      room.skip(); // → round start (POWERUPS because somebody holds an item)
    };
    return { room, a, b, toPowerups };
  };

  // outside the window nothing can be used
  {
    const { room, a, b } = make();
    a.inventory = { freeze: 1 };
    assert.throws(() => room.usePowerup(a, 'freeze', b.id), /этапе спецприёмов/);
    room.close();
  }

  // attack lands, attacker stays secret, effect becomes public only when the question starts
  {
    const { room, a, b, toPowerups } = make();
    a.inventory = { freeze: 1 };
    toPowerups();
    assert.equal(room.phase, 'POWERUPS');
    room.usePowerup(a, 'freeze', b.id);
    assert.equal(a.inventory.freeze, 0);
    assert.deepEqual(room.publicState().players.find((p) => p.id === b.id)!.effects, [], 'secret during the window');
    assert.throws(() => room.usePowerup(a, 'freeze', b.id), /нет такого приёма/);
    toQuestion(room);
    assert.equal(room.phase, 'QUESTION');
    assert.deepEqual(room.publicState().players.find((p) => p.id === b.id)!.effects, ['freeze']);
    room.close();
  }

  // shield eats the attack and is consumed; attacker still pays
  {
    const { room, a, b, toPowerups } = make();
    a.inventory = { freeze: 1 };
    b.inventory = { shield: 1 };
    toPowerups();
    room.usePowerup(b, 'shield');
    assert.equal(b.shield, true);
    room.usePowerup(a, 'freeze', b.id);
    assert.equal(b.shield, false);
    assert.equal(a.inventory.freeze, 0);
    assert.deepEqual(b.effects, []);
    const notes = room.drainNotices().map((n) => n.notice.text).join('|');
    assert.match(notes, /отразил\(а\) ваш приём/);
    room.close();
  }

  // reduce_time shortens the personal window and rejects late answers
  {
    const { room, a, b, toPowerups } = make();
    a.inventory = { reduce_time: 1 };
    toPowerups();
    room.usePowerup(a, 'reduce_time', b.id);
    const full = room.privateState(a).answerWindowMs;
    assert.equal(room.privateState(b).answerWindowMs, full - GAME_CONFIG.REDUCE_TIME_SECONDS * 1000 * 0.02);
    room.close();
  }

  // bomb blocks the answer, counts as done for the early lock
  {
    const { room, a, b, toPowerups } = make();
    a.inventory = { bombs: 1 };
    toPowerups();
    room.usePowerup(a, 'bombs', b.id);
    toQuestion(room);
    assert.throws(() => room.bomb(a), /не наложены бомбы/);
    room.bomb(b);
    assert.throws(() => room.answer(b, 0, 1), /Бомба/);
    assert.equal(room.privateState(b).blocked, true);
    room.answer(a, 0, 1);
    assert.equal(room.phase, 'LOCKED', 'everybody is done: round locks early');
    room.close();
  }

  // bet pays half of the target's points when the target is right
  {
    const { room, a, b, toPowerups } = make();
    a.inventory = { bet: 1 };
    toPowerups();
    room.usePowerup(a, 'bet', b.id);
    toQuestion(room);
    room.answer(a, 0, (QUESTIONS[0].correctAnswer + 1) % 4);
    room.answer(b, 0, QUESTIONS[0].correctAnswer);
    for (let i = 0; i < 100 && (room.phase as string) !== 'DROP'; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(room.phase, 'DROP');
    assert.ok(b.score >= GAME_CONFIG.CORRECT_POINTS);
    assert.equal(a.score, Math.round(b.lastDelta * GAME_CONFIG.BET_BONUS_RATIO));
    room.close();
  }
});

test('power-ups are granted for correct answers (chance 1)', async () => {
  const { Room } = await import('../src/game/Room');
  process.env.QUIZ_POWERUP_CHANCE = '1';
  process.env.QUIZ_POWERUP_TYPES = 'shield';
  try {
    const room = new Room('TEST02', () => undefined, 0.02, PLAIN);
    const a = room.addPlayer(null);
    a.name = 'Умный';
    room.start();
    room.skip();
    room.skip();
    assert.equal(room.phase, 'QUESTION');
    room.answer(a, 0, QUESTIONS[0].correctAnswer);
    for (let i = 0; i < 100 && (room.phase as string) !== 'DROP'; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(a.inventory.shield, 1);
    assert.match(room.drainNotices().map((n) => n.notice.text).join('|'), /Получен приём/);
    room.close();
  } finally {
    delete process.env.QUIZ_POWERUP_CHANCE;
    delete process.env.QUIZ_POWERUP_TYPES;
  }
});

test('full inventory: a new power-up replaces an old one instead of drying up', async () => {
  const { Room } = await import('../src/game/Room');
  process.env.QUIZ_POWERUP_CHANCE = '1';
  process.env.QUIZ_POWERUP_TYPES = 'shield';
  try {
    const room = new Room('TEST03', () => undefined, 0.02, PLAIN);
    const a = room.addPlayer(null);
    a.name = 'Копилка';
    room.start();
    a.inventory = { freeze: 1, bombs: 1, slime: 1 };
    room.skip(); // rules → card
    room.skip(); // card → POWERUPS (a holds items)
    room.skip(); // → QUESTION
    room.answer(a, 0, QUESTIONS[0].correctAnswer);
    for (let i = 0; i < 100 && (room.phase as string) !== 'DROP'; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(a.inventory.shield, 1);
    assert.equal(Object.values(a.inventory).reduce((x, y) => x + (y ?? 0), 0), GAME_CONFIG.MAX_INVENTORY);
    room.close();
  } finally {
    delete process.env.QUIZ_POWERUP_CHANCE;
    delete process.env.QUIZ_POWERUP_TYPES;
  }
});

test('rounds: 3 rounds x 5 questions, one category per round, one mutator per round, carousel at round start', async () => {
  const { Room } = await import('../src/game/Room');
  const saved = process.env.QUIZ_NO_SHUFFLE;
  delete process.env.QUIZ_NO_SHUFFLE;
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      const room = new Room('TESTCAT', () => undefined, 0.02, () => QUESTIONS);
      const a = room.addPlayer(null);
      a.name = 'Крутильщик';
      room.start();
      const plan = (room as any).plan as { question: { question: string; category?: string }; round: number; category: string | null; mutator: string | null }[];
      assert.equal(plan.length, GAME_CONFIG.ROUNDS * GAME_CONFIG.QUESTIONS_PER_ROUND);
      assert.equal(new Set(plan.map((p) => p.question.question)).size, plan.length, 'no repeated question');
      const cats: string[] = [];
      for (let r = 1; r <= GAME_CONFIG.ROUNDS; r++) {
        const items = plan.filter((p) => p.round === r);
        assert.equal(items.length, GAME_CONFIG.QUESTIONS_PER_ROUND);
        assert.ok(items.every((p) => p.category === items[0].category && p.question.category === p.category), 'whole round = one category');
        cats.push(items[0].category!);
        const mutators = items.map((p, idx) => ({ idx, m: p.mutator })).filter((x) => x.m);
        assert.equal(mutators.length, 1, 'exactly one mutator per round');
        assert.ok(mutators[0].idx >= 1, 'never on the first question of the round');
      }
      assert.equal(new Set(cats).size, GAME_CONFIG.ROUNDS, 'a different category every round');
      room.close();
    }
    const room = new Room('TESTCAT2', () => undefined, 0.02, () => QUESTIONS);
    const a = room.addPlayer(null);
    a.name = 'Зритель';
    room.start();
    room.skip(); // rules → card
    room.skip(); // card → first round
    assert.equal(room.phase, 'CATEGORY');
    const st = room.publicState();
    assert.ok(st.category && st.categories.includes(st.category), 'winner is one of the carousel cards');
    assert.equal(st.categories.length, 8);
    assert.equal(st.question, null, 'question stays hidden during the carousel');
    assert.deepEqual([st.round, st.totalRounds, st.roundQuestion, st.roundSize], [1, 3, 1, 5]);
    room.skip();
    assert.equal(room.phase, 'QUESTION');
    assert.equal(room.publicState().category, st.category);
    // the 2nd question of a round continues with the same category and no carousel
    (room as any).questionIndex = 1;
    (room as any).beginRound();
    assert.notEqual(room.phase, 'CATEGORY');
    assert.equal(room.publicState().category, st.category);
    assert.equal(room.publicState().roundQuestion, 2);
    room.close();
  } finally {
    process.env.QUIZ_NO_SHUFFLE = saved;
  }
});

test('mutators and streaks change the scoring', async () => {
  const { Room } = await import('../src/game/Room');
  const play = async (setup: (room: any, a: any, b: any) => void, answerA: number, answerB: number) => {
    const room = new Room('TESTMUT', () => undefined, 0.02, PLAIN);
    const a = room.addPlayer(null);
    const b = room.addPlayer(null);
    a.name = 'A';
    b.name = 'B';
    room.start();
    setup(room, a, b);
    room.skip(); // rules → card
    room.skip(); // card → card
    room.skip(); // card → [MUTATOR]
    if (room.phase === 'MUTATOR') room.skip();
    assert.equal(room.phase, 'QUESTION');
    const seconds = (room.publicState().phaseEndsAt! - room.publicState().phaseStartedAt) / 1000;
    room.answer(a, 0, answerA);
    room.answer(b, 0, answerB);
    for (let i = 0; i < 100 && (room.phase as string) !== 'DROP'; i++) await new Promise((r) => setTimeout(r, 20));
    const out = { a, b, seconds, notices: room.drainNotices().map((n) => n.notice.text).join('|') };
    room.close();
    return out;
  };
  const right = QUESTIONS[0].correctAnswer;
  const wrong = (right + 1) % 4;
  const base = GAME_CONFIG.CORRECT_POINTS;
  const top = GAME_CONFIG.CORRECT_POINTS + GAME_CONFIG.SPEED_BONUS_MAX;

  const plain = await play(() => undefined, right, wrong);
  assert.ok(plain.a.lastDelta >= base && plain.a.lastDelta <= top);

  const dbl = await play((room) => ((room as any).plan[0].mutator = 'double'), right, wrong);
  assert.ok(dbl.a.lastDelta >= 2 * base && dbl.a.lastDelta <= 2 * top, `double: ${dbl.a.lastDelta}`);
  assert.equal(dbl.b.lastDelta, 0);

  const allin = await play(
    (room, a, b) => {
      room.plan[0].mutator = 'allin';
      a.score = 300;
      b.score = 300;
    },
    right,
    wrong,
  );
  assert.ok(allin.a.lastDelta >= 2 * base, `allin win: ${allin.a.lastDelta}`);
  assert.equal(allin.b.score, 300 - GAME_CONFIG.ALLIN_PENALTY, 'a wrong answer costs points');
  const broke = await play((room) => ((room as any).plan[0].mutator = 'allin'), right, wrong);
  assert.equal(broke.b.score, 0, 'the score never goes below zero');
  assert.equal(broke.b.lastDelta, 0);

  const blitz = await play((room) => ((room as any).plan[0].mutator = 'blitz'), right, wrong);
  assert.ok(Math.abs(blitz.seconds - GAME_CONFIG.BLITZ_SECONDS * 0.02) < 0.05, `blitz window ${blitz.seconds}`);

  const streak = await play((room, a) => (a.streak = 2), right, wrong);
  assert.ok(streak.a.lastDelta >= base + GAME_CONFIG.STREAK_BONUS_STEP, `streak bonus: ${streak.a.lastDelta}`);
  assert.equal(streak.a.streak, 3);
  assert.match(streak.notices, /Серия ×3/);
  assert.equal(streak.b.streak, 0);
});

test('reactions are validated and rate limited', async () => {
  const { Room } = await import('../src/game/Room');
  const room = new Room('TESTREA', () => undefined, 0.02, PLAIN);
  const a = room.addPlayer(null);
  room.react(a, '🔥');
  assert.throws(() => room.react(a, '🔥'), /Не так быстро/);
  const b = room.addPlayer(null);
  assert.throws(() => room.react(b, '<script>'), /Неизвестная реакция/);
  room.close();
});

test('catapult: rare drop, shoots a player out of the question without penalty', async () => {
  const { Room } = await import('../src/game/Room');
  const mk = () => {
    const room = new Room('TESTCAP', () => undefined, 0.02, PLAIN);
    const a = room.addPlayer(null);
    const b = room.addPlayer(null);
    a.name = 'Стрелок';
    b.name = 'Мишень';
    room.start();
    return { room, a, b };
  };

  // rare: about 3% of all drops with the default pool
  {
    process.env.QUIZ_POWERUP_CHANCE = '1';
    const { room, a } = mk();
    a.result = 'correct';
    let catapults = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      a.inventory = {};
      (room as any).grantPowerups();
      if (a.inventory.catapult) catapults++;
    }
    delete process.env.QUIZ_POWERUP_CHANCE;
    const share = catapults / N;
    assert.ok(share > 0.01 && share < 0.07, `catapult share ${share}`);
    room.close();
  }

  // hit: no answer possible, no penalty even in an all-in round, streak kept, early lock
  {
    const { room, a, b } = mk();
    a.inventory = { catapult: 1 };
    b.score = 300;
    b.streak = 2;
    room.skip(); // rules → card
    room.skip(); // card → card
    (room as any).plan[0].mutator = 'allin';
    room.skip(); // → MUTATOR
    assert.equal(room.phase, 'MUTATOR');
    room.skip(); // → POWERUPS (a holds the catapult)
    assert.equal(room.phase, 'POWERUPS');
    room.usePowerup(a, 'catapult', b.id);
    assert.equal(a.inventory.catapult, 0);
    assert.deepEqual(room.publicState().players.find((p) => p.id === b.id)!.effects, [], 'secret during the window');
    toQuestion(room);
    assert.equal(room.phase, 'QUESTION');
    assert.deepEqual(room.publicState().players.find((p) => p.id === b.id)!.effects, ['catapult']);
    assert.throws(() => room.answer(b, 0, 0), /катапультировали/);
    room.answer(a, 0, QUESTIONS[0].correctAnswer);
    assert.equal(room.phase, 'LOCKED', 'the catapulted player does not hold up the round');
    for (let i = 0; i < 100 && (room as any).phase !== 'DROP'; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(b.score, 300, 'no all-in penalty for a catapulted player');
    assert.equal(b.streak, 2, 'streak is kept');
    assert.equal(b.result, 'none');
    room.close();
  }

  // a shield stops it
  {
    const { room, a, b } = mk();
    a.inventory = { catapult: 1 };
    b.inventory = { shield: 1 };
    room.skip();
    room.skip();
    room.skip(); // POWERUPS
    room.usePowerup(b, 'shield');
    assert.equal(room.publicState().players.find((p) => p.id === b.id)!.shield, false, 'a new shield stays secret until the show');
    room.usePowerup(a, 'catapult', b.id);
    assert.equal(b.blocked, false);
    assert.equal(a.inventory.catapult, 0);
    room.skip(); // window over → the big screen plays it out
    assert.equal(room.phase, 'POWERUP_SHOW');
    const events = room.publicState().powerupEvents;
    assert.deepEqual(events.map((e) => [e.type, e.blocked]), [['shield', false], ['catapult', true]], 'who did what, in order');
    assert.equal(events[1].attackerId, a.id);
    assert.equal(events[1].targetId, b.id);
    room.close();
  }

  // bet is visible as a money bag, target stays secret
  {
    const { room, a, b } = mk();
    a.inventory = { bet: 1 };
    room.skip();
    room.skip();
    room.skip();
    room.usePowerup(a, 'bet', b.id);
    assert.equal(room.publicState().players.find((p) => p.id === a.id)!.bet, false, 'bet stays secret during the window');
    room.skip();
    assert.equal(room.phase, 'POWERUP_SHOW');
    toQuestion(room);
    const pa = room.publicState().players.find((p) => p.id === a.id)!;
    assert.equal(pa.bet, true, 'the money bag is visible during the question');
    assert.ok(!JSON.stringify(room.publicState()).includes(b.id + '"' + ',"betTarget'), 'no target in the public state');
    room.close();
  }
});

test('categories are really random: every topic comes up, consecutive games differ', async () => {
  const { Room } = await import('../src/game/Room');
  const saved = process.env.QUIZ_NO_SHUFFLE;
  delete process.env.QUIZ_NO_SHUFFLE;
  try {
    const seen = new Map<string, number>();
    let previous: string[] = [];
    for (let game = 0; game < 400; game++) {
      const room = new Room('TESTRND', () => undefined, 0.02, () => QUESTIONS);
      room.addPlayer(null).name = 'Игрок';
      room.start();
      const plan = (room as any).plan as { round: number; category: string }[];
      const cats = [...new Set(plan.map((p) => p.category))];
      for (const c of cats) seen.set(c, (seen.get(c) ?? 0) + 1);
      assert.equal(cats.length, GAME_CONFIG.ROUNDS);
      if (previous.length) assert.ok(cats.every((c) => !previous.includes(c)), 'the next game uses other topics than the last one');
      previous = cats;
      room.close();
    }
    assert.equal(seen.size, 8, 'all categories appear');
    const counts = [...seen.values()];
    assert.ok(Math.max(...counts) < 2 * Math.min(...counts), `roughly even: ${JSON.stringify([...seen])}`);
  } finally {
    process.env.QUIZ_NO_SHUFFLE = saved;
  }
});

test('robot colours are unique: a taken colour cannot be picked, default colours give way', async () => {
  const { Room } = await import('../src/game/Room');
  const room = new Room('TESTCOL', () => undefined, 0.02, PLAIN);
  const players = Array.from({ length: 20 }, () => room.addPlayer(null));
  assert.equal(new Set(players.map((p) => p.avatar)).size, 20, '20 players = 20 different colours by default');
  const [a, b] = players;
  const wanted = b.avatar;
  room.setProfile(a, 'A', wanted); // b only has it by default: b gets another colour
  assert.equal(a.avatar, wanted);
  assert.notEqual(b.avatar, wanted);
  assert.equal(new Set(players.map((p) => p.avatar)).size, 20);
  assert.throws(() => room.setProfile(b, 'B', wanted), /занят/);
  room.close();
});

test('slap emote: just for fun, no effect on the game, a shield does not stop it', async () => {
  const { Room } = await import('../src/game/Room');
  const room = new Room('TESTSLP', () => undefined, 0.02, PLAIN);
  const a = room.addPlayer(null);
  const b = room.addPlayer(null);
  a.name = 'Хулиган';
  b.name = 'Жертва';
  room.start();
  a.inventory = { slap: 1 };
  b.inventory = { shield: 1 };
  room.skip();
  room.skip();
  room.skip(); // POWERUPS
  assert.equal(room.phase, 'POWERUPS');
  room.usePowerup(b, 'shield');
  assert.throws(() => room.usePowerup(a, 'slap', a.id), /другого игрока/);
  room.usePowerup(a, 'slap', b.id);
  assert.equal(b.shield, true, 'the shield is not used up by an emote');
  assert.deepEqual(b.effects, [], 'nothing changes in the game');
  assert.equal(b.blocked, false);
  room.skip();
  assert.equal(room.phase, 'POWERUP_SHOW');
  assert.deepEqual(room.publicState().powerupEvents.map((e) => e.type), ['shield', 'slap']);
  toQuestion(room);
  assert.equal(room.phase, 'QUESTION');
  assert.deepEqual(room.publicState().powerupEvents, [], 'events are only public during the show');
  room.close();
});
