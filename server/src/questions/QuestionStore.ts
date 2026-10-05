import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GAME_CONFIG, QUESTIONS, type Question } from '@quiz/shared';
import { GameError } from '../game/Room';

export function validateQuestions(input: unknown): Question[] {
  if (!Array.isArray(input)) throw new GameError('Ожидался список вопросов');
  if (input.length === 0) throw new GameError('Нужен хотя бы один вопрос');
  if (input.length > GAME_CONFIG.MAX_QUESTIONS) throw new GameError(`Не больше ${GAME_CONFIG.MAX_QUESTIONS} вопросов`);
  return input.map((raw, i) => {
    const n = i + 1;
    const q = raw as Partial<Question>;
    const text = String(q?.question ?? '').trim();
    if (!text) throw new GameError(`Вопрос ${n}: пустой текст вопроса`);
    if (text.length > GAME_CONFIG.QUESTION_MAX_LENGTH) throw new GameError(`Вопрос ${n}: слишком длинный текст`);
    if (!Array.isArray(q.answers) || q.answers.length !== 4) throw new GameError(`Вопрос ${n}: нужно ровно 4 варианта ответа`);
    const answers = q.answers.map((a) => String(a ?? '').trim()) as Question['answers'];
    answers.forEach((a, k) => {
      if (!a) throw new GameError(`Вопрос ${n}: пустой вариант ${'ABCD'[k]}`);
      if (a.length > GAME_CONFIG.ANSWER_MAX_LENGTH) throw new GameError(`Вопрос ${n}: слишком длинный вариант ${'ABCD'[k]}`);
    });
    const correct = Number(q.correctAnswer);
    if (![0, 1, 2, 3].includes(correct)) throw new GameError(`Вопрос ${n}: не выбран правильный ответ`);
    const category = String(q.category ?? '').replace(/\s+/g, ' ').trim();
    if (category.length > GAME_CONFIG.CATEGORY_MAX_LENGTH) throw new GameError(`Вопрос ${n}: слишком длинное название категории`);
    return { id: n, ...(category ? { category } : {}), question: text, answers, correctAnswer: correct as Question['correctAnswer'] };
  });
}

/** Questions live in a JSON file so they can be edited in the UI or by hand. */
export class QuestionStore {
  constructor(private readonly file: string) {}

  load(): Question[] {
    if (!existsSync(this.file)) {
      this.write(QUESTIONS);
      return QUESTIONS.map((q) => ({ ...q, answers: [...q.answers] as Question['answers'] }));
    }
    try {
      return validateQuestions(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch (err) {
      console.error(`Не удалось прочитать ${this.file}, использую стандартные вопросы:`, (err as Error).message);
      return QUESTIONS;
    }
  }

  save(input: unknown): Question[] {
    const list = validateQuestions(input);
    this.write(list);
    return list;
  }

  private write(list: Question[]) {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n', 'utf8');
    renameSync(tmp, this.file);
  }
}
