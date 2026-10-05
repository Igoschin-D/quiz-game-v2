import type { MutatorId } from './mutators';
import type { PowerupType } from './powerups';
import type { AvatarId } from './theme';

/**
 * Game start: LOBBY → INTRO (rules + player cards). Round: [CATEGORY] → [MUTATOR] → [POWERUPS → POWERUP_SHOW] → QUESTION → LOCKED → RUNNING → REVEAL → DROP →
 * NEXT_QUESTION (or FINAL). POWERUPS is skipped when nobody holds a power-up.
 */
export type Phase =
  | 'LOBBY'
  | 'INTRO'
  | 'CATEGORY'
  | 'MUTATOR'
  | 'POWERUPS'
  | 'POWERUP_SHOW'
  | 'QUESTION'
  | 'LOCKED'
  | 'RUNNING'
  | 'REVEAL'
  | 'DROP'
  | 'NEXT_QUESTION'
  | 'FINAL';

export const PHASE_ORDER: Phase[] = ['LOBBY', 'INTRO', 'CATEGORY', 'MUTATOR', 'POWERUPS', 'POWERUP_SHOW', 'QUESTION', 'LOCKED', 'RUNNING', 'REVEAL', 'DROP', 'NEXT_QUESTION', 'FINAL'];

export type AnswerResult = 'correct' | 'wrong' | 'none' | null;

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: AvatarId;
  photoVersion: number;
  ready: boolean;
  connected: boolean;
  isBot: boolean;
  score: number;
  /** Points earned for the last resolved question (shown after DROP). */
  lastDelta: number;
  answered: boolean;
  /** Hidden (null) while answers are still open. */
  answer: number | null;
  answerMs: number | null;
  /** Filled from LOCKED onwards. */
  result: AnswerResult;
  /** False in the lobby and until the intro card of this player: the host shows an anonymous "Игрок N". */
  revealed: boolean;
  /** Personal fact from the intro card; null until the player is revealed. */
  comment: string | null;
  /** Power-ups used against this player this round (attacker stays secret); visible from QUESTION on. */
  effects: PowerupType[];
  /** Correct answers in a row (revealed together with the result). */
  streak: number;
  /** Shield is up (shown as a shield in the robot's hand). */
  shield: boolean;
  /** A bet has been placed (shown as a money bag; the target stays secret). */
  bet: boolean;
}

export interface PublicQuestion {
  index: number;
  text: string;
  answers: string[];
}

/** One used power-up: who used what on whom (public only while it is shown on the big screen). */
export interface PowerupEvent {
  attackerId: string;
  targetId: string;
  type: PowerupType;
  /** The target's shield took the hit. */
  blocked: boolean;
}

export interface RoomState {
  roomId: string;
  phase: Phase;
  questionIndex: number;
  totalQuestions: number;
  question: PublicQuestion | null;
  /** Only revealed from REVEAL onwards. */
  correctAnswer: number | null;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  serverNow: number;
  hostConnected: boolean;
  paused: boolean;
  /** Time left in the current phase while paused. */
  pausedRemainingMs: number | null;
  players: PublicPlayer[];
  /** INTRO: null = rules card, otherwise the id of the player whose card is on screen. */
  introPlayerId: string | null;
  introIndex: number;
  introTotal: number;
  /** POWERUPS: how many power-ups were used this round so far. */
  powerupsUsed: number;
  /** POWERUP_SHOW: the used power-ups in the order they are played out. */
  powerupEvents: PowerupEvent[];
  /** Category of the current round (from CATEGORY on); null when the game has no categories. */
  category: string | null;
  /** All categories of this game, for the carousel. Empty = no carousel. */
  categories: string[];
  /** Rounds: the category changes every round. */
  round: number;
  totalRounds: number;
  roundQuestion: number;
  roundSize: number;
  /** True while the scoreboard after the last question of a round is shown. */
  roundEnd: boolean;
  /** Twist of the current question (from MUTATOR on). */
  mutator: MutatorId | null;
}

/** Data only the player themself receives (event `me`). */
export interface PlayerPrivate {
  inventory: Partial<Record<PowerupType, number>>;
  shield: boolean;
  /** Player the bet for the coming question is placed on. */
  betTargetId: string | null;
  comment: string;
  /** Personal answer window in ms (shorter than the phase when "Урезать время" hit this player). */
  answerWindowMs: number;
  /** Bomb exploded: no answer possible for this question. */
  blocked: boolean;
}

export interface Notice {
  kind: 'info' | 'good' | 'bad';
  text: string;
}

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface ServerToClientEvents {
  state: (state: RoomState) => void;
  me: (me: PlayerPrivate) => void;
  notice: (notice: Notice) => void;
  reaction: (r: { playerId: string; emoji: string }) => void;
  roomClosed: () => void;
}

export interface ClientToServerEvents {
  'host:create': (cb: (res: Ack<{ roomId: string; hostToken: string }>) => void) => void;
  'host:rejoin': (p: { roomId: string; hostToken: string }, cb: (res: Ack) => void) => void;
  'host:start': (cb?: (res: Ack) => void) => void;
  'host:next': (cb?: (res: Ack) => void) => void;
  'host:restart': (cb?: (res: Ack) => void) => void;
  'host:addBots': (p: { count: number }, cb?: (res: Ack) => void) => void;
  'host:close': (cb?: (res: Ack) => void) => void;
  'host:skip': (cb?: (res: Ack) => void) => void;
  'host:pause': (p: { paused: boolean }, cb?: (res: Ack) => void) => void;
  'player:join': (
    p: { roomId: string; token?: string },
    cb: (res: Ack<{ playerId: string; token: string }>) => void,
  ) => void;
  'player:profile': (p: { name?: string; avatar?: AvatarId; comment?: string }, cb?: (res: Ack) => void) => void;
  'player:photo': (p: { dataUrl: string }, cb?: (res: Ack) => void) => void;
  'player:ready': (p: { ready: boolean }, cb?: (res: Ack) => void) => void;
  'player:usePowerup': (p: { type: PowerupType; targetId?: string }, cb?: (res: Ack) => void) => void;
  'player:react': (p: { emoji: string }, cb?: (res: Ack) => void) => void;
  'player:sync': (cb?: (res: Ack) => void) => void;
  'player:bombed': (cb?: (res: Ack) => void) => void;
  'player:answer': (p: { questionIndex: number; answer: number }, cb?: (res: Ack) => void) => void;
}
