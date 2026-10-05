export const GAME_CONFIG = {
  ANSWER_TIME_SECONDS: 15,
  LOCK_SECONDS: 1,
  /** Characters run to the platform of their answer (correct answer still hidden). */
  RUN_SECONDS: 3.5,
  /** Correct answer is shown while everybody stands on their platforms (~1.5 s+ pause before the trapdoors). */
  REVEAL_SECONDS: 2.5,
  DROP_SECONDS: 4,
  /** Auto-advance to the next question after the scoreboard; 0 = only the host button. */
  NEXT_QUESTION_AUTO_SECONDS: 3,
  /** A bit longer after the last question of a round: the scoreboard is worth a look. */
  ROUND_END_SECONDS: 6,
  CORRECT_POINTS: 100,
  SPEED_BONUS_MAX: 50,
  MAX_PLAYERS: 20,
  PHOTO_SIZE_PX: 320,
  PHOTO_MAX_BYTES: 300_000,
  /** The game code is typed on a phone: digits only (numeric keypad). */
  ROOM_CODE_LENGTH: 4,
  ROOM_IDLE_TTL_MINUTES: 60,
  NAME_MAX_LENGTH: 16,
  MAX_QUESTIONS: 120,
  QUESTION_MAX_LENGTH: 200,
  ANSWER_MAX_LENGTH: 60,
  COMMENT_MAX_LENGTH: 80,
  CATEGORY_MAX_LENGTH: 30,
  /** A game = rounds of questions; every round has its own category (and one mutator question). */
  ROUNDS: 3,
  QUESTIONS_PER_ROUND: 5,
  MUTATOR_SECONDS: 4,
  BLITZ_SECONDS: 7,
  ALLIN_PENALTY: 100,
  /** Streak of correct answers: bonus starts with the 3rd in a row. */
  STREAK_MIN: 3,
  STREAK_BONUS_STEP: 20,
  STREAK_BONUS_MAX: 80,
  REACTION_COOLDOWN_MS: 700,
  /** Category carousel before every round (only when the game has two or more categories). */
  CATEGORY_SECONDS: 6,
  /** Intro: rules card first, then one card per player. */
  INTRO_RULES_SECONDS: 8,
  INTRO_PLAYER_SECONDS: 5,
  /** Window before a question where players can use power-ups (only if somebody has one). */
  POWERUP_WINDOW_SECONDS: 7,
  /** After the window: everybody lines up and one power-up after another is played out on the big screen. */
  SHOW_LINEUP_SECONDS: 2.4,
  SHOW_EVENT_SECONDS: 3.2,
  SHOW_END_SECONDS: 1.2,
  SHOW_MAX_EVENTS: 8,
  /** Chance to get a power-up after a correct answer (env QUIZ_POWERUP_CHANCE overrides it). */
  POWERUP_GRANT_CHANCE: 0.4,
  MAX_INVENTORY: 3,
  REDUCE_TIME_SECONDS: 3,
  MIN_ANSWER_WINDOW_SECONDS: 4,
  /** Bet pays this share of the target's points for the question. */
  BET_BONUS_RATIO: 0.5,
  FREEZE_TAPS: 3,
  BOMB_COUNT: 3,
  SLIME_CLEAR_RATIO: 0.6,
} as const;
