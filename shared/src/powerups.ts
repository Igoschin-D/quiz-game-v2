export type PowerupType = 'freeze' | 'reduce_time' | 'shield' | 'bet' | 'slime' | 'bombs' | 'catapult' | 'slap';

/** `emote` = just for fun: it never changes the game or the score. */
export type PowerupKind = 'attack' | 'self' | 'bet' | 'emote';

export interface PowerupInfo {
  name: string;
  icon: string;
  kind: PowerupKind;
  /** Short explanation shown on the phone. */
  hint: string;
}

export const POWERUPS: Record<PowerupType, PowerupInfo> = {
  freeze: { name: 'Заморозка', icon: '❄️', kind: 'attack', hint: 'Кнопки ответов покрываются льдом: каждую надо разбить тремя тапами.' },
  reduce_time: { name: 'Урезать время', icon: '⏳', kind: 'attack', hint: 'У цели на 3 секунды меньше времени на ответ.' },
  shield: { name: 'Щит', icon: '🛡️', kind: 'self', hint: 'Отражает следующий приём, который применят против вас.' },
  bet: { name: 'Ставка', icon: '💰', kind: 'bet', hint: 'Ставка на игрока: если он ответит верно, вы получите половину его очков за вопрос.' },
  slime: { name: 'Слизь', icon: '🟢', kind: 'attack', hint: 'Ответы закрывает слизь: её нужно стереть пальцем.' },
  slap: {
    name: 'Пощечина',
    icon: '👋',
    kind: 'emote',
    hint: 'Эмоция для смеха: ваш робот подбегает к игроку и даёт ему пощечину, у того кружится голова. На игру не влияет.',
  },
  catapult: {
    name: 'Катапульта',
    icon: '🚀',
    kind: 'attack',
    hint: 'Редкий приём: робота цели катапультирует в экран, и в этом вопросе он не отвечает и не получает очков.',
  },
  bombs: { name: 'Бомбы', icon: '💣', kind: 'attack', hint: 'По экрану летают бомбы. Тапнул по бомбе — ответ потерян.' },
};

export const POWERUP_TYPES = Object.keys(POWERUPS) as PowerupType[];

export const COMMENT_PROMPTS = [
  'Любимая фраза',
  'Один факт о себе',
  'Чем ты гордишься?',
  'Девиз по жизни',
  'Что скажешь о себе?',
  'Твоя суперспособность',
  'Любимое блюдо',
  'Как тебя называют друзья?',
];
