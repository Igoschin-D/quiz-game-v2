export type MutatorId = 'double' | 'allin' | 'blitz';

export interface MutatorInfo {
  name: string;
  icon: string;
  description: string;
}

/** One question per round is played with a twist. */
export const MUTATORS: Record<MutatorId, MutatorInfo> = {
  double: { name: 'Двойные очки', icon: '✨', description: 'Все очки за этот вопрос удваиваются.' },
  allin: { name: 'Ва-банк', icon: '🎰', description: 'Верный ответ приносит вдвое больше, а ошибка или молчание отнимает 100 очков.' },
  blitz: { name: 'Блиц', icon: '⏱️', description: 'Всего 7 секунд на ответ. Думайте быстро!' },
};

export const MUTATOR_IDS = Object.keys(MUTATORS) as MutatorId[];

export const REACTIONS = ['🔥', '😂', '😱', '👏', '❤️', '🤔'] as const;
