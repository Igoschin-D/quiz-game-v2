export const ANSWER_LETTERS = ['A', 'B', 'C', 'D'] as const;

export const THEME = {
  /** Platform colours for answers A, B, C, D. */
  platformColors: ['#e53935', '#1e88e5', '#fdd835', '#43a047'],
  platformTextColors: ['#ffffff', '#ffffff', '#3b2a00', '#ffffff'],
  correct: '#3dff8a',
  wrong: '#ff3d3d',
  background: '#160c35',
  floor: '#2b2066',
  floorAlt: '#33287a',
  accent: '#ffcc00',
  accent2: '#ff4fd8',
} as const;

/** 20 robot colours: nobody can pick a colour that is already taken, so the arena stays colourful. */
export const AVATARS = [
  { id: 'metal', label: 'Железный', body: '#9aa6b5', accent: '#dfe6ee', eye: '#4fc3f7' },
  { id: 'red', label: 'Красный', body: '#d63a3a', accent: '#ffc2b3', eye: '#fff176' },
  { id: 'yellow', label: 'Жёлтый', body: '#f2c230', accent: '#fff6c8', eye: '#1e88e5' },
  { id: 'blue', label: 'Синий', body: '#2f6fd6', accent: '#a9cbff', eye: '#ffeb3b' },
  { id: 'green', label: 'Зелёный', body: '#2fa84f', accent: '#c8f2cf', eye: '#fff176' },
  { id: 'purple', label: 'Фиолетовый', body: '#8a4fd6', accent: '#ddc8ff', eye: '#7fffd4' },
  { id: 'orange', label: 'Оранжевый', body: '#f08a24', accent: '#ffe0b8', eye: '#1e3a8a' },
  { id: 'pink', label: 'Розовый', body: '#ec5fa8', accent: '#ffd0e6', eye: '#fff59d' },
  { id: 'cyan', label: 'Бирюзовый', body: '#1fb8c9', accent: '#c4f4fa', eye: '#ff6f61' },
  { id: 'lime', label: 'Лаймовый', body: '#9acd32', accent: '#ecf8c0', eye: '#6a1b9a' },
  { id: 'white', label: 'Белый', body: '#e8ebf0', accent: '#ffffff', eye: '#e53935' },
  { id: 'black', label: 'Чёрный', body: '#3a3d48', accent: '#8a90a0', eye: '#76ff03' },
  { id: 'brown', label: 'Коричневый', body: '#8d5a34', accent: '#e0c3a0', eye: '#ffd54f' },
  { id: 'teal', label: 'Изумрудный', body: '#12806a', accent: '#b2eadf', eye: '#ffab40' },
  { id: 'maroon', label: 'Бордовый', body: '#8e1f3d', accent: '#f0b8c6', eye: '#80deea' },
  { id: 'navy', label: 'Тёмно-синий', body: '#1f3a8a', accent: '#aebcf0', eye: '#ff9800' },
  { id: 'gold', label: 'Золотой', body: '#c9a227', accent: '#fff0b0', eye: '#d32f2f' },
  { id: 'coral', label: 'Коралловый', body: '#ff7a6b', accent: '#ffd9d3', eye: '#1a237e' },
  { id: 'mint', label: 'Мятный', body: '#6fdba8', accent: '#d8fbe9', eye: '#8e24aa' },
  { id: 'sky', label: 'Небесный', body: '#5ab0f5', accent: '#d3ebff', eye: '#ff7043' },
] as const;

export type AvatarId = (typeof AVATARS)[number]['id'];

export const AVATAR_IDS: AvatarId[] = AVATARS.map((a) => a.id);

export function avatarById(id: string) {
  return AVATARS.find((a) => a.id === id) ?? AVATARS[0];
}
