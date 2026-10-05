import { randomBytes, randomUUID } from 'node:crypto';
import {
  AVATAR_IDS,
  GAME_CONFIG,
  MUTATORS,
  MUTATOR_IDS,
  POWERUPS,
  POWERUP_TYPES,
  QUESTIONS,
  REACTIONS,
  type AnswerResult,
  type AvatarId,
  type MutatorId,
  type Notice,
  type Phase,
  type PlayerPrivate,
  type PowerupEvent,
  type PowerupType,
  type PublicPlayer,
  type Question,
  type RoomState,
} from '@quiz/shared';

export interface Player {
  id: string;
  token: string;
  name: string;
  avatar: AvatarId;
  photo: Buffer | null;
  photoMime: string;
  photoVersion: number;
  ready: boolean;
  connected: boolean;
  socketId: string | null;
  isBot: boolean;
  joinedAt: number;
  score: number;
  lastDelta: number;
  answer: number | null;
  answerMs: number | null;
  result: AnswerResult;
  comment: string;
  inventory: Partial<Record<PowerupType, number>>;
  shield: boolean;
  betTargetId: string | null;
  /** Power-ups that hit this player in the current round. */
  effects: PowerupType[];
  timePenaltySec: number;
  /** A bomb exploded on the phone: no answer possible this round. */
  blocked: boolean;
  streak: number;
  /** Streak after the question in progress; becomes public together with the result. */
  pendingStreak: number;
  lastReactionAt: number;
  /** The player picked this colour themselves (a default colour can still be taken away by someone who picks it). */
  avatarChosen: boolean;
  /** The shield was put up in the current power-up window (shown to everybody only during the show). */
  shieldNew: boolean;
}

interface PlanItem {
  question: Question;
  round: number;
  category: string | null;
  mutator: MutatorId | null;
}

export class GameError extends Error {}

export type QuestionSource = () => Question[];

const REVEALED_PHASES: Phase[] = ['REVEAL', 'DROP', 'NEXT_QUESTION', 'FINAL'];
/** Phases where the attacks of the round are already visible (they stay secret during the POWERUPS window). */
const EFFECT_PHASES: Phase[] = ['QUESTION', 'LOCKED', 'RUNNING', 'REVEAL', 'DROP', 'NEXT_QUESTION'];

const BOT_COMMENTS = [
  'Люблю быстрые ответы',
  'Я просто бот, но очень стараюсь',
  'Девиз: нажимай и не думай',
  'Суперспособность: случайный выбор',
];

function powerupPool(): PowerupType[] {
  const wanted = (process.env.QUIZ_POWERUP_TYPES ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t): t is PowerupType => (POWERUP_TYPES as string[]).includes(t));
  return wanted.length > 0 ? wanted : POWERUP_TYPES;
}

/** Relative drop weights: the catapult is rare. */
const DROP_WEIGHT: Partial<Record<PowerupType, number>> = { catapult: 0.2, slap: 0.8 };

function pickPowerup(pool: PowerupType[], uniform: boolean): PowerupType {
  const weights = pool.map((t) => (uniform ? 1 : (DROP_WEIGHT[t] ?? 1)));
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function grantChance(): number {
  const env = Number(process.env.QUIZ_POWERUP_CHANCE);
  return process.env.QUIZ_POWERUP_CHANCE !== undefined && Number.isFinite(env) ? env : GAME_CONFIG.POWERUP_GRANT_CHANCE;
}

function envInt(name: string, fallback: number) {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

/** Mutator of a round: env QUIZ_MUTATOR forces one ('none' disables), handy for tests. */
function pickMutator(): MutatorId | null {
  const forced = process.env.QUIZ_MUTATOR;
  if (forced === 'none') return null;
  if (forced && (MUTATOR_IDS as string[]).includes(forced)) return forced as MutatorId;
  return MUTATOR_IDS[Math.floor(Math.random() * MUTATOR_IDS.length)];
}

function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Categories of the previous game(s): the next game prefers other ones, so games do not feel the same. */
let recentCategories: string[] = [];

const totalItems = (p: Player) => Object.values(p.inventory).reduce((a, b) => a + (b ?? 0), 0);

export class Room {
  readonly hostToken = randomBytes(16).toString('hex');
  hostSocketId: string | null = null;
  readonly players = new Map<string, Player>();
  phase: Phase = 'LOBBY';
  questionIndex = -1;
  phaseStartedAt = Date.now();
  phaseEndsAt: number | null = null;
  paused = false;
  lastActivity = Date.now();
  private questions: Question[];
  private pausedAt = 0;
  private phaseTimer: NodeJS.Timeout | null = null;
  private pending: (() => void) | null = null;
  private botTimers: NodeJS.Timeout[] = [];
  private botCounter = 0;
  private closed = false;
  private plan: PlanItem[] = [];
  private categoryList: string[] = [];
  private introList: string[] = [];
  private introIndex = -1;
  private powerupsUsed = 0;
  private powerupEvents: PowerupEvent[] = [];
  private notices: { playerId: string; notice: Notice }[] = [];

  constructor(
    readonly id: string,
    private readonly onChange: (room: Room) => void,
    private readonly timeScale = 1,
    private readonly questionSource: QuestionSource = () => QUESTIONS,
  ) {
    this.questions = questionSource();
  }

  // ---------------------------------------------------------------- players

  addPlayer(socketId: string | null, isBot = false): Player {
    if (this.players.size >= GAME_CONFIG.MAX_PLAYERS) throw new GameError('Комната заполнена');
    const index = this.players.size;
    const player: Player = {
      id: randomUUID(),
      token: randomBytes(16).toString('hex'),
      name: '',
      avatar: this.freeAvatar(),
      photo: null,
      photoMime: 'image/jpeg',
      photoVersion: 0,
      ready: false,
      connected: true,
      socketId,
      isBot,
      joinedAt: Date.now() + index,
      score: 0,
      lastDelta: 0,
      answer: null,
      answerMs: null,
      result: null,
      comment: '',
      inventory: {},
      shield: false,
      betTargetId: null,
      effects: [],
      timePenaltySec: 0,
      blocked: false,
      streak: 0,
      pendingStreak: 0,
      lastReactionAt: 0,
      avatarChosen: false,
      shieldNew: false,
    };
    this.players.set(player.id, player);
    this.touch();
    return player;
  }

  playerByToken(token: string): Player | undefined {
    for (const p of this.players.values()) if (p.token === token) return p;
    return undefined;
  }

  attachSocket(player: Player, socketId: string) {
    player.socketId = socketId;
    player.connected = true;
    this.touch();
  }

  handleDisconnect(socketId: string) {
    if (this.hostSocketId === socketId) this.hostSocketId = null;
    for (const p of this.players.values()) {
      if (p.socketId === socketId) {
        p.connected = false;
        p.socketId = null;
      }
    }
    this.lockIfEveryoneAnswered();
    this.touch();
  }

  setProfile(player: Player, name?: string, avatar?: AvatarId, comment?: string) {
    if (name !== undefined) {
      const clean = name.replace(/\s+/g, ' ').trim().slice(0, GAME_CONFIG.NAME_MAX_LENGTH);
      if (!clean) throw new GameError('Введите имя');
      player.name = clean;
    }
    if (avatar !== undefined) {
      if (!AVATAR_IDS.includes(avatar)) throw new GameError('Неизвестный персонаж');
      const holder = [...this.players.values()].find((p) => p.id !== player.id && p.avatar === avatar);
      if (holder?.avatarChosen) throw new GameError('Этот цвет уже занят другим игроком');
      if (holder) {
        // it was only a default colour: the other player gets a free one, or swaps with the old colour of this player
        const used = new Set([...this.players.values()].map((p) => p.avatar));
        const free = AVATAR_IDS.filter((id) => !used.has(id));
        holder.avatar = free.length > 0 ? free[Math.floor(Math.random() * free.length)] : player.avatar;
      }
      player.avatar = avatar;
      player.avatarChosen = true;
    }
    if (comment !== undefined) {
      player.comment = String(comment).replace(/\s+/g, ' ').trim().slice(0, GAME_CONFIG.COMMENT_MAX_LENGTH);
    }
    this.touch();
  }

  setPhoto(player: Player, dataUrl: string) {
    const m = /^data:(image\/(?:jpeg|webp|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw new GameError('Неверный формат фото');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > GAME_CONFIG.PHOTO_MAX_BYTES) throw new GameError('Фото слишком большое');
    player.photo = buf;
    player.photoMime = m[1];
    player.photoVersion += 1;
    this.touch();
  }

  /** A colour nobody uses yet (random, so the lobby looks different every time). */
  private freeAvatar(extraTaken: AvatarId[] = []): AvatarId {
    const taken = new Set<AvatarId>([...extraTaken, ...[...this.players.values()].map((p) => p.avatar)]);
    const free = AVATAR_IDS.filter((id) => !taken.has(id));
    const pool = free.length > 0 ? free : AVATAR_IDS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  setReady(player: Player, ready: boolean) {
    if (ready && !player.name) throw new GameError('Сначала введите имя');
    if (ready) player.avatarChosen = true; // from now on the colour belongs to this player
    player.ready = ready;
    this.touch();
  }

  addBots(count: number) {
    const n = Math.max(0, Math.min(count, GAME_CONFIG.MAX_PLAYERS - this.players.size));
    for (let i = 0; i < n; i++) {
      const bot = this.addPlayer(null, true);
      this.botCounter += 1;
      bot.avatarChosen = true;
      bot.name = `Player ${this.botCounter}`;
      bot.comment = BOT_COMMENTS[(this.botCounter - 1) % BOT_COMMENTS.length];
      bot.ready = true;
    }
    if (this.phase === 'QUESTION' && !this.paused) this.scheduleBotAnswers();
    this.touch();
  }

  // ---------------------------------------------------------------- game flow

  start() {
    if (this.phase !== 'LOBBY') throw new GameError('Игра уже идёт');
    if (this.activePlayers().length === 0) throw new GameError('Нет игроков');
    this.preparePlan();
    for (const p of this.players.values()) {
      p.score = 0;
      p.lastDelta = 0;
      this.resetRound(p);
      p.inventory = {};
      p.shield = false;
      p.streak = 0;
      p.pendingStreak = 0;
    }
    this.introList = this.activePlayers()
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => p.id);
    this.introIndex = -1;
    this.questionIndex = -1;
    this.setPhase('INTRO', GAME_CONFIG.INTRO_RULES_SECONDS);
    this.schedule(GAME_CONFIG.INTRO_RULES_SECONDS, () => this.introStep());
  }

  next() {
    if (this.phase !== 'NEXT_QUESTION') throw new GameError('Следующий вопрос доступен после итогов раунда');
    this.questionIndex += 1;
    this.beginRound();
  }

  /**
   * Builds the game: ROUNDS rounds of QUESTIONS_PER_ROUND questions. Every round takes one random category, and one
   * random question of the round (never the first) is a "mutator" question with a twist.
   * QUIZ_NO_SHUFFLE=1 keeps the list order as a single round without categories (used by tests).
   */
  private preparePlan() {
    const bank = this.questionSource();
    const catOf = (q: Question) => q.category?.trim() || null;
    const names = new Set(bank.map((q) => catOf(q) ?? 'Разное'));
    const useCategories = names.size >= 2;
    const per = envInt('QUIZ_QUESTIONS_PER_ROUND', GAME_CONFIG.QUESTIONS_PER_ROUND);
    let plan: PlanItem[] = [];

    if (process.env.QUIZ_NO_SHUFFLE === '1') {
      plan = bank.map((question) => ({ question, round: 1, category: null, mutator: null }));
      this.categoryList = [];
    } else {
      const wantedRounds = envInt('QUIZ_ROUNDS', GAME_CONFIG.ROUNDS);
      const rounds: { category: string | null; questions: Question[] }[] = [];
      if (useCategories) {
        const pools = new Map<string, Question[]>();
        for (const q of shuffled(bank)) {
          const cat = catOf(q) ?? 'Разное';
          pools.set(cat, [...(pools.get(cat) ?? []), q]);
        }
        // categories with enough questions first, in random order; small ones only as a fallback
        const rank = (c: string) => Number(pools.get(c)!.length >= per) * 2 + Number(!recentCategories.includes(c));
        const order = shuffled([...pools.keys()]).sort((x, y) => rank(y) - rank(x));
        for (const cat of order.slice(0, wantedRounds)) rounds.push({ category: cat, questions: pools.get(cat)!.slice(0, per) });
        recentCategories = rounds.map((x) => x.category!);
        const used = new Set(rounds.flatMap((x) => x.questions));
        const rest = shuffled(bank.filter((q) => !used.has(q)));
        for (const round of rounds) while (round.questions.length < per && rest.length > 0) round.questions.push(rest.pop()!);
      } else {
        const all = shuffled(bank);
        const count = Math.min(wantedRounds, Math.max(1, Math.ceil(all.length / per)));
        for (let i = 0; i < count; i++) rounds.push({ category: null, questions: all.slice(i * per, (i + 1) * per) });
      }
      rounds.forEach((round, ri) => {
        const mutatorAt = round.questions.length > 1 ? 1 + Math.floor(Math.random() * (round.questions.length - 1)) : 0;
        const mutator = pickMutator();
        round.questions.forEach((question, qi) =>
          plan.push({ question, round: ri + 1, category: round.category, mutator: qi === mutatorAt ? mutator : null }),
        );
      });
      this.categoryList = useCategories ? [...names] : [];
    }
    this.plan = plan;
    this.questions = plan.map((p) => p.question);
  }

  /** Host button: skip the rules/player card, the category carousel or the power-up window. */
  skip() {
    if (this.paused) throw new GameError('Игра на паузе');
    if (this.phase === 'INTRO') {
      this.clearTimers();
      this.introStep();
    } else if (this.phase === 'CATEGORY') {
      this.clearTimers();
      this.afterCategory();
    } else if (this.phase === 'MUTATOR') {
      this.clearTimers();
      this.afterMutator();
    } else if (this.phase === 'POWERUPS') {
      this.clearTimers();
      this.afterPowerups();
    } else if (this.phase === 'POWERUP_SHOW') {
      this.clearTimers();
      this.enterQuestion();
    } else {
      throw new GameError('Сейчас нечего пропускать');
    }
  }

  private introStep() {
    this.introIndex += 1;
    if (this.introIndex >= this.introList.length) {
      this.questionIndex = 0;
      this.beginRound();
      return;
    }
    // QUIZ_INTRO_PLAYER_SECONDS: longer cards for slow test machines
    const seconds = envInt('QUIZ_INTRO_PLAYER_SECONDS', GAME_CONFIG.INTRO_PLAYER_SECONDS);
    this.setPhase('INTRO', seconds);
    this.schedule(seconds, () => this.introStep());
  }

  /** New round: reset per-round state; open the power-up window if somebody holds a power-up. */
  private beginRound() {
    this.paused = false;
    this.clearBotTimers();
    for (const p of this.players.values()) {
      this.resetAnswer(p);
      this.resetRound(p);
    }
    this.powerupsUsed = 0;
    this.powerupEvents = [];
    for (const p of this.players.values()) p.shieldNew = false;
    const item = this.plan[this.questionIndex];
    const firstOfRound = this.questionIndex === 0 || this.plan[this.questionIndex - 1].round !== item.round;
    if (firstOfRound && item.category && this.categoryList.length >= 2) {
      this.setPhase('CATEGORY', GAME_CONFIG.CATEGORY_SECONDS);
      this.schedule(GAME_CONFIG.CATEGORY_SECONDS, () => this.afterCategory());
      return;
    }
    this.afterCategory();
  }

  private afterCategory() {
    if (this.plan[this.questionIndex]?.mutator) {
      this.setPhase('MUTATOR', GAME_CONFIG.MUTATOR_SECONDS);
      this.schedule(GAME_CONFIG.MUTATOR_SECONDS, () => this.afterMutator());
      return;
    }
    this.afterMutator();
  }

  private afterMutator() {
    if (!this.activePlayers().some((p) => totalItems(p) > 0)) {
      this.enterQuestion();
      return;
    }
    this.setPhase('POWERUPS', GAME_CONFIG.POWERUP_WINDOW_SECONDS);
    this.schedule(GAME_CONFIG.POWERUP_WINDOW_SECONDS, () => this.afterPowerups());
    this.scheduleBotPowerups();
  }

  /** The window is over: everything that was used is now played out on the big screen, one after another. */
  private afterPowerups() {
    const shown = Math.min(this.powerupEvents.length, GAME_CONFIG.SHOW_MAX_EVENTS);
    if (shown === 0) {
      this.enterQuestion();
      return;
    }
    const seconds = GAME_CONFIG.SHOW_LINEUP_SECONDS + shown * GAME_CONFIG.SHOW_EVENT_SECONDS + GAME_CONFIG.SHOW_END_SECONDS;
    this.setPhase('POWERUP_SHOW', seconds);
    this.schedule(seconds, () => this.enterQuestion());
  }

  private resetRound(p: Player) {
    p.effects = [];
    p.timePenaltySec = 0;
    p.blocked = false;
    p.betTargetId = null;
  }

  restart() {
    this.clearTimers();
    this.paused = false;
    for (const p of this.players.values()) {
      p.score = 0;
      p.lastDelta = 0;
      p.inventory = {};
      p.shield = false;
      p.streak = 0;
      p.pendingStreak = 0;
      this.resetAnswer(p);
      this.resetRound(p);
    }
    this.introList = [];
    this.introIndex = -1;
    this.powerupsUsed = 0;
    this.plan = [];
    this.categoryList = [];
    this.questionIndex = -1;
    this.questions = this.questionSource();
    this.setPhase('LOBBY', null);
  }

  setPaused(paused: boolean) {
    if (paused === this.paused) return;
    if (paused) {
      if (this.phase === 'LOBBY' || this.phase === 'FINAL') throw new GameError('Пауза доступна только во время игры');
      this.paused = true;
      this.pausedAt = Date.now();
      if (this.phaseTimer) clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
      this.clearBotTimers();
    } else {
      const shift = Date.now() - this.pausedAt;
      this.paused = false;
      this.phaseStartedAt += shift;
      if (this.phaseEndsAt !== null) {
        this.phaseEndsAt += shift;
        if (this.pending) this.startTimer(this.phaseEndsAt - Date.now());
      }
      if (this.phase === 'QUESTION') this.scheduleBotAnswers();
      if (this.phase === 'POWERUPS') this.scheduleBotPowerups();
    }
    this.touch();
    this.onChange(this);
  }

  // ---------------------------------------------------------------- power-ups

  usePowerup(player: Player, type: PowerupType, targetId?: string) {
    if (this.paused) throw new GameError('Игра на паузе');
    if (this.phase !== 'POWERUPS') throw new GameError('Приёмы применяются только на этапе спецприёмов');
    const info = POWERUPS[type];
    if (!info) throw new GameError('Неизвестный приём');
    if ((player.inventory[type] ?? 0) <= 0) throw new GameError('У вас нет такого приёма');

    if (info.kind === 'self') {
      if (player.shield) throw new GameError('Щит уже активен');
      this.consume(player, type);
      player.shield = true;
      player.shieldNew = true;
      this.powerupEvents.push({ attackerId: player.id, targetId: player.id, type, blocked: false });
      this.notify(player, 'good', '🛡️ Щит активирован: он отразит следующий приём против вас');
    } else if (info.kind === 'bet') {
      if (player.betTargetId) throw new GameError('Ставка уже сделана');
      const target = this.players.get(targetId ?? player.id);
      if (!target) throw new GameError('Игрок не найден');
      this.consume(player, type);
      player.betTargetId = target.id;
      this.powerupsUsed += 1;
      this.powerupEvents.push({ attackerId: player.id, targetId: target.id, type, blocked: false });
      this.notify(player, 'info', `💰 Ставка на ${target.id === player.id ? 'себя' : target.name || 'игрока'} принята`);
    } else {
      const target = targetId ? this.players.get(targetId) : undefined;
      if (!target || target.id === player.id) throw new GameError('Выберите другого игрока');
      this.consume(player, type);
      this.powerupsUsed += 1;
      const targetName = target.name || 'игрок';
      if (info.kind === 'emote') {
        // just for fun: no effect on the game, a shield does not stop it
        this.powerupEvents.push({ attackerId: player.id, targetId: target.id, type, blocked: false });
        this.notify(player, 'info', `${info.icon} ${info.name} → ${targetName}`);
        this.touch();
        return;
      }
      if (target.shield) {
        target.shield = false;
        this.powerupEvents.push({ attackerId: player.id, targetId: target.id, type, blocked: true });
        this.notify(player, 'bad', `🛡️ ${targetName} отразил(а) ваш приём щитом`);
        this.notify(target, 'good', '🛡️ Щит отразил чей-то приём!');
      } else {
        if (type === 'reduce_time') target.timePenaltySec += GAME_CONFIG.REDUCE_TIME_SECONDS;
        if (type === 'catapult') target.blocked = true; // shot out of this question: no answer, no points
        if (type === 'reduce_time' || !target.effects.includes(type)) target.effects.push(type);
        this.powerupEvents.push({ attackerId: player.id, targetId: target.id, type, blocked: false });
        this.notify(player, 'info', `${info.icon} ${info.name} → ${targetName}`);
      }
    }
    this.touch();
  }

  /** The phone reports that a bomb exploded: the player loses this question. */
  bomb(player: Player) {
    if (this.phase !== 'QUESTION' || this.paused) throw new GameError('Сейчас бомбы не действуют');
    if (!player.effects.includes('bombs')) throw new GameError('На вас не наложены бомбы');
    if (player.answer !== null) throw new GameError('Ответ уже принят');
    player.blocked = true;
    this.touch();
    this.lockIfEveryoneAnswered();
  }

  private consume(player: Player, type: PowerupType) {
    player.inventory[type] = Math.max(0, (player.inventory[type] ?? 0) - 1);
  }

  private notify(player: Player, kind: Notice['kind'], text: string) {
    if (!player.isBot) this.notices.push({ playerId: player.id, notice: { kind, text } });
  }

  drainNotices() {
    const out = this.notices;
    this.notices = [];
    return out;
  }

  private grantPowerups() {
    const pool = powerupPool();
    const chance = grantChance();
    for (const p of this.players.values()) {
      if (p.result !== 'correct' || Math.random() >= chance) continue;
      const type = pickPowerup(pool, Boolean(process.env.QUIZ_POWERUP_TYPES));
      let replaced = '';
      if (totalItems(p) >= GAME_CONFIG.MAX_INVENTORY) {
        // Inventory is full (items were not used): the new one replaces a random old one, so rewards never dry up.
        const owned = POWERUP_TYPES.filter((t) => (p.inventory[t] ?? 0) > 0);
        const old = owned[Math.floor(Math.random() * owned.length)];
        this.consume(p, old);
        replaced = ` (запас полон, заменён ${POWERUPS[old].icon})`;
      }
      p.inventory[type] = (p.inventory[type] ?? 0) + 1;
      this.notify(p, 'good', `Получен приём: ${POWERUPS[type].icon} ${POWERUPS[type].name}${replaced}`);
    }
  }

  private resolveBets() {
    for (const bettor of this.players.values()) {
      if (!bettor.betTargetId) continue;
      const target = this.players.get(bettor.betTargetId);
      if (target && target.result === 'correct' && target.lastDelta > 0) {
        const bonus = Math.round(target.lastDelta * GAME_CONFIG.BET_BONUS_RATIO);
        bettor.score += bonus;
        bettor.lastDelta += bonus;
        this.notify(bettor, 'good', `💰 Ставка сыграла: +${bonus}`);
      } else {
        this.notify(bettor, 'bad', '💰 Ставка не сыграла');
      }
      bettor.betTargetId = null;
    }
  }

  private scheduleBotPowerups() {
    for (const bot of this.players.values()) {
      if (!bot.isBot || totalItems(bot) === 0) continue;
      const t = setTimeout(() => {
        if (this.closed || this.paused || this.phase !== 'POWERUPS' || !this.players.has(bot.id)) return;
        const type = POWERUP_TYPES.find((k) => (bot.inventory[k] ?? 0) > 0);
        if (!type) return;
        const bots = [...this.players.values()].filter((p) => p.isBot && p.id !== bot.id);
        // Bots never attack humans: keeps test runs predictable.
        const target = bots[Math.floor(Math.random() * bots.length)];
        try {
          if (POWERUPS[type].kind !== 'self' && POWERUPS[type].kind !== 'bet' && !target) return;
          this.usePowerup(bot, type, POWERUPS[type].kind === 'bet' ? bot.id : target?.id);
          this.onChange(this);
        } catch {
          /* nothing to do */
        }
      }, this.sec(0.5 + Math.random() * GAME_CONFIG.POWERUP_WINDOW_SECONDS * 0.5));
      this.botTimers.push(t);
    }
  }

  answer(player: Player, questionIndex: number, answer: number) {
    if (this.paused) throw new GameError('Игра на паузе');
    if (this.phase !== 'QUESTION') throw new GameError('Приём ответов закрыт');
    if (questionIndex !== this.questionIndex) throw new GameError('Это ответ на другой вопрос');
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) throw new GameError('Неверный ответ');
    if (player.answer !== null) throw new GameError('Ответ уже принят');
    if (player.blocked) {
      throw new GameError(player.effects.includes('catapult') ? 'Вас катапультировали: в этом вопросе вы не участвуете' : 'Бомба взорвалась: ответить на этот вопрос нельзя');
    }
    if (Date.now() - this.phaseStartedAt > this.windowMs(player) + 400) throw new GameError('Ваше время вышло');
    player.answer = answer;
    player.answerMs = Date.now() - this.phaseStartedAt;
    this.touch();
    this.lockIfEveryoneAnswered();
  }

  close() {
    this.closed = true;
    this.clearTimers();
  }

  private enterQuestion() {
    this.paused = false;
    this.clearBotTimers();
    this.setPhase('QUESTION', this.questionSeconds());
    this.schedule(this.questionSeconds(), () => this.lock());
    this.scheduleBotAnswers();
  }

  private lockIfEveryoneAnswered() {
    if (this.phase !== 'QUESTION' || this.paused) return;
    const active = this.activePlayers();
    if (active.length > 0 && active.every((p) => p.answer !== null || p.blocked)) this.lock();
  }

  private lock() {
    if (this.phase !== 'QUESTION') return;
    this.clearBotTimers();
    const q = this.questions[this.questionIndex];
    const mutator = this.plan[this.questionIndex]?.mutator ?? null;
    for (const p of this.players.values()) {
      const windowMs = this.windowMs(p);
      const penalty = mutator === 'allin' ? -GAME_CONFIG.ALLIN_PENALTY : 0;
      if (p.effects.includes('catapult')) {
        // catapulted out of the question: nothing won, nothing lost, the streak is kept
        p.result = 'none';
        p.lastDelta = 0;
        p.pendingStreak = p.streak;
      } else if (p.answer === null) {
        p.result = 'none';
        p.lastDelta = penalty;
        p.pendingStreak = 0;
      } else if (p.answer === q.correctAnswer) {
        p.result = 'correct';
        const remaining = Math.max(0, 1 - (p.answerMs ?? windowMs) / windowMs);
        let points = GAME_CONFIG.CORRECT_POINTS + Math.round(GAME_CONFIG.SPEED_BONUS_MAX * remaining);
        if (mutator === 'double' || mutator === 'allin') points *= 2;
        p.pendingStreak = p.streak + 1;
        if (p.pendingStreak >= GAME_CONFIG.STREAK_MIN) {
          points += Math.min(GAME_CONFIG.STREAK_BONUS_MAX, GAME_CONFIG.STREAK_BONUS_STEP * (p.pendingStreak - GAME_CONFIG.STREAK_MIN + 1));
        }
        p.lastDelta = points;
      } else {
        p.result = 'wrong';
        p.lastDelta = penalty;
        p.pendingStreak = 0;
      }
    }
    this.setPhase('LOCKED', GAME_CONFIG.LOCK_SECONDS);
    this.schedule(GAME_CONFIG.LOCK_SECONDS, () => {
      this.setPhase('RUNNING', GAME_CONFIG.RUN_SECONDS);
      this.schedule(GAME_CONFIG.RUN_SECONDS, () => {
        this.setPhase('REVEAL', GAME_CONFIG.REVEAL_SECONDS);
        this.schedule(GAME_CONFIG.REVEAL_SECONDS, () => this.drop());
      });
    });
  }

  private drop() {
    for (const p of this.players.values()) {
      const before = p.score;
      p.score = Math.max(0, p.score + p.lastDelta);
      p.lastDelta = p.score - before; // the score never drops below zero
      const hadStreak = p.pendingStreak >= GAME_CONFIG.STREAK_MIN;
      p.streak = p.pendingStreak;
      if (hadStreak) this.notify(p, 'good', `🔥 Серия ×${p.streak}: бонус к очкам!`);
    }
    this.resolveBets();
    this.grantPowerups();
    this.setPhase('DROP', GAME_CONFIG.DROP_SECONDS);
    this.schedule(GAME_CONFIG.DROP_SECONDS, () => {
      if (this.questionIndex >= this.questions.length - 1) {
        this.setPhase('FINAL', null);
        return;
      }
      const roundEnds = this.plan[this.questionIndex + 1]?.round !== this.plan[this.questionIndex]?.round;
      const auto = roundEnds ? GAME_CONFIG.ROUND_END_SECONDS : GAME_CONFIG.NEXT_QUESTION_AUTO_SECONDS;
      this.setPhase('NEXT_QUESTION', auto > 0 ? auto : null);
      if (auto > 0) {
        this.schedule(auto, () => {
          this.questionIndex += 1;
          this.beginRound();
        });
      }
    });
  }

  private scheduleBotAnswers() {
    for (const bot of this.players.values()) {
      if (!bot.isBot || bot.answer !== null) continue;
      const delay = this.sec(1 + Math.random() * (this.questionSeconds() * 0.6));
      const qIndex = this.questionIndex;
      const t = setTimeout(() => {
        if (this.closed || this.paused || this.phase !== 'QUESTION' || this.questionIndex !== qIndex) return;
        if (bot.answer !== null || !this.players.has(bot.id)) return;
        try {
          this.answer(bot, qIndex, Math.floor(Math.random() * 4));
        } catch {
          return;
        }
        this.onChange(this);
      }, delay);
      this.botTimers.push(t);
    }
  }

  // ---------------------------------------------------------------- helpers

  activePlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.connected || p.isBot);
  }

  hasConnections(): boolean {
    if (this.hostSocketId) return true;
    for (const p of this.players.values()) if (p.connected && !p.isBot) return true;
    return false;
  }

  private resetAnswer(p: Player) {
    p.answer = null;
    p.answerMs = null;
    p.result = null;
  }

  private setPhase(phase: Phase, seconds: number | null) {
    this.phase = phase;
    this.phaseStartedAt = Date.now();
    this.phaseEndsAt = seconds === null ? null : this.phaseStartedAt + this.sec(seconds);
    this.touch();
    this.onChange(this);
  }

  private schedule(seconds: number, fn: () => void) {
    this.pending = fn;
    this.startTimer(this.sec(seconds));
  }

  private startTimer(ms: number) {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = setTimeout(() => {
      this.phaseTimer = null;
      const fn = this.pending;
      this.pending = null;
      if (!this.closed && fn) fn();
    }, Math.max(0, ms));
  }

  private clearBotTimers() {
    for (const t of this.botTimers) clearTimeout(t);
    this.botTimers = [];
  }

  private clearTimers() {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
    this.pending = null;
    this.clearBotTimers();
  }

  /** Personal answer window (shorter for players hit by "Урезать время"). */
  private windowMs(p: Player) {
    return this.sec(Math.max(GAME_CONFIG.MIN_ANSWER_WINDOW_SECONDS, this.questionSeconds() - p.timePenaltySec));
  }

  /** Seconds for the current question (Blitz mutator = shorter). */
  private questionSeconds() {
    return this.plan[this.questionIndex]?.mutator === 'blitz' ? GAME_CONFIG.BLITZ_SECONDS : GAME_CONFIG.ANSWER_TIME_SECONDS;
  }

  /** Emoji reaction from a phone: validated and rate limited, the server broadcasts it. */
  react(player: Player, emoji: string) {
    if (!(REACTIONS as readonly string[]).includes(emoji)) throw new GameError('Неизвестная реакция');
    const now = Date.now();
    if (now - player.lastReactionAt < GAME_CONFIG.REACTION_COOLDOWN_MS) throw new GameError('Не так быстро');
    player.lastReactionAt = now;
  }

  private sec(seconds: number) {
    return seconds * 1000 * this.timeScale;
  }

  private touch() {
    this.lastActivity = Date.now();
  }

  publicState(): RoomState {
    const revealAnswers = !['LOBBY', 'INTRO', 'POWERUPS', 'POWERUP_SHOW', 'QUESTION'].includes(this.phase);
    const showEffects = EFFECT_PHASES.includes(this.phase);
    const duringPowerups = this.phase === 'POWERUPS' || this.phase === 'POWERUP_SHOW';
    const introPos = new Map(this.introList.map((id, i) => [id, i]));
    const isRevealed = (id: string) => {
      if (this.phase === 'LOBBY') return false;
      if (this.phase !== 'INTRO') return true;
      const pos = introPos.get(id);
      return pos === undefined || pos <= this.introIndex;
    };
    const revealCorrect = REVEALED_PHASES.includes(this.phase);
    const q = this.questionIndex >= 0 ? this.questions[this.questionIndex] : null;
    const players: PublicPlayer[] = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        photoVersion: p.photoVersion,
        ready: p.ready,
        connected: p.connected,
        isBot: p.isBot,
        score: p.score,
        lastDelta: p.lastDelta,
        answered: p.answer !== null,
        answer: revealAnswers ? p.answer : null,
        answerMs: revealAnswers ? p.answerMs : null,
        result: revealCorrect ? p.result : null,
        revealed: isRevealed(p.id),
        comment: isRevealed(p.id) && p.comment ? p.comment : null,
        effects: showEffects ? [...p.effects] : [],
        streak: p.streak,
        // a freshly raised shield / placed bet is only revealed by the show; before that nobody knows
        shield: p.shield && !(duringPowerups && p.shieldNew),
        bet: !duringPowerups && p.betTargetId !== null,
      }));
    const now = Date.now();
    const inGame = this.phase !== 'LOBBY' && this.phase !== 'INTRO';
    const item = this.questionIndex >= 0 ? this.plan[this.questionIndex] : undefined;
    return {
      roomId: this.id,
      phase: this.phase,
      questionIndex: this.questionIndex,
      totalQuestions: this.questions.length,
      question: q && !['LOBBY', 'INTRO', 'CATEGORY', 'MUTATOR', 'POWERUPS', 'POWERUP_SHOW'].includes(this.phase) ? { index: this.questionIndex, text: q.question, answers: [...q.answers] } : null,
      correctAnswer: revealCorrect && q ? q.correctAnswer : null,
      phaseStartedAt: this.phaseStartedAt,
      phaseEndsAt: this.phaseEndsAt,
      serverNow: now,
      hostConnected: this.hostSocketId !== null,
      paused: this.paused,
      pausedRemainingMs: this.paused && this.phaseEndsAt !== null ? Math.max(0, this.phaseEndsAt - this.pausedAt) : null,
      players,
      introPlayerId: this.phase === 'INTRO' && this.introIndex >= 0 ? (this.introList[this.introIndex] ?? null) : null,
      introIndex: this.introIndex,
      introTotal: this.introList.length,
      powerupsUsed: this.powerupsUsed,
      powerupEvents: this.phase === 'POWERUP_SHOW' ? this.powerupEvents : [],
      category: inGame ? (item?.category ?? null) : null,
      categories: this.categoryList,
      round: inGame ? (item?.round ?? 0) : 0,
      totalRounds: this.plan.length ? this.plan[this.plan.length - 1].round : 0,
      roundQuestion: inGame && item ? this.plan.filter((x, i) => x.round === item.round && i <= this.questionIndex).length : 0,
      roundSize: inGame && item ? this.plan.filter((x) => x.round === item.round).length : 0,
      roundEnd:
        this.phase === 'NEXT_QUESTION' && Boolean(item) && this.plan[this.questionIndex + 1]?.round !== item!.round,
      mutator: inGame && !['CATEGORY'].includes(this.phase) ? (item?.mutator ?? null) : null,
    };
  }

  privateState(p: Player): PlayerPrivate {
    const inventory: PlayerPrivate['inventory'] = {};
    for (const [k, v] of Object.entries(p.inventory)) if (v && v > 0) inventory[k as PowerupType] = v;
    return {
      inventory,
      shield: p.shield,
      betTargetId: p.betTargetId,
      comment: p.comment,
      answerWindowMs: this.windowMs(p),
      blocked: p.blocked,
    };
  }
}
