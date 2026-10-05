import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ANSWER_LETTERS, GAME_CONFIG, THEME, type Question } from '@quiz/shared';

type Status = { kind: 'loading' } | { kind: 'error'; text: string } | { kind: 'ready' };

const blank = (id: number): Question => ({ id, question: '', answers: ['', '', '', ''], correctAnswer: 0 });

/** Host-only page: edit the question list stored in data/questions.json. */
export function QuestionsEditor() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Question[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/questions')
      .then(async (r) => {
        if (r.status === 403) throw new Error('Редактировать вопросы можно только на компьютере, где запущена игра.');
        if (!r.ok) throw new Error(`Сервер ответил ошибкой ${r.status}.`);
        setItems((await r.json()) as Question[]);
        setStatus({ kind: 'ready' });
      })
      .catch((e: Error) => setStatus({ kind: 'error', text: e.message }));
  }, []);

  const change = (i: number, fn: (q: Question) => Question) => {
    setItems((list) => list.map((q, k) => (k === i ? fn(q) : q)));
    setDirty(true);
    setMessage(null);
  };
  const move = (i: number, d: -1 | 1) => {
    setItems((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  };
  const remove = (i: number) => {
    if (!window.confirm(`Удалить вопрос №${i + 1}?`)) return;
    setItems((list) => list.filter((_, k) => k !== i));
    setDirty(true);
  };
  const add = () => {
    setItems((list) => [...list, blank(Math.max(0, ...list.map((q) => q.id)) + 1)]);
    setDirty(true);
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const questions = items.map((q, i) => ({ ...q, id: i + 1 }));
      const r = await fetch('/api/questions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(questions),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? `Ошибка ${r.status}`);
      setItems(Array.isArray(data) ? data : questions);
      setDirty(false);
      setMessage({ ok: true, text: 'Сохранено. Новые вопросы будут в следующей игре («Новая игра» или «Перезапустить»).' });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const back = () => {
    if (dirty && !window.confirm('Есть несохранённые изменения. Выйти без сохранения?')) return;
    navigate('/host');
  };

  return (
    <div className="qe">
      <datalist id="qe-categories">
        {[...new Set(items.map((q) => q.category).filter(Boolean))].map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <header className="qe-head">
        <button className="btn ghost" onClick={back}>
          ← К игре
        </button>
        <h1>Вопросы</h1>
        <span className="hint">
          {items.length} / {GAME_CONFIG.MAX_QUESTIONS} · игра: {GAME_CONFIG.ROUNDS} раунда по {GAME_CONFIG.QUESTIONS_PER_ROUND} вопросов
        </span>
        <div className="qe-actions">
          <button className="btn" onClick={add} disabled={status.kind !== 'ready' || items.length >= GAME_CONFIG.MAX_QUESTIONS}>
            + Добавить вопрос
          </button>
          <button className="btn primary" data-testid="save-questions" onClick={save} disabled={!dirty || saving || status.kind !== 'ready'}>
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>
      </header>

      {message && <p className={`qe-msg ${message.ok ? 'ok' : 'bad'}`}>{message.text}</p>}
      {status.kind === 'loading' && <div className="spinner" />}
      {status.kind === 'error' && <p className="qe-msg bad">{status.text}</p>}

      {status.kind === 'ready' && (
        <ol className="qe-list">
          {items.map((q, i) => (
            <li key={`${q.id}-${i}`} className="qe-card">
              <div className="qe-row">
                <span className="qe-num">{i + 1}</span>
                <textarea
                  className="input qe-q"
                  placeholder="Текст вопроса"
                  maxLength={GAME_CONFIG.QUESTION_MAX_LENGTH}
                  value={q.question}
                  onChange={(e) => change(i, (x) => ({ ...x, question: e.target.value }))}
                />
                <div className="qe-tools">
                  <button className="btn ghost" title="Выше" disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button className="btn ghost" title="Ниже" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  <button className="btn ghost" title="Удалить" disabled={items.length <= 1} onClick={() => remove(i)}>
                    🗑
                  </button>
                </div>
              </div>
              <label className="qe-category">
                <span>Категория</span>
                <input
                  className="input"
                  list="qe-categories"
                  data-testid="category-input"
                  placeholder="Например: География (необязательно)"
                  maxLength={GAME_CONFIG.CATEGORY_MAX_LENGTH}
                  value={q.category ?? ''}
                  onChange={(e) => change(i, (x) => ({ ...x, category: e.target.value }))}
                />
              </label>
              <div className="qe-answers">
                {q.answers.map((a, k) => (
                  <label key={k} className={`qe-answer ${q.correctAnswer === k ? 'correct' : ''}`}>
                    <input
                      type="radio"
                      name={`correct-${i}`}
                      checked={q.correctAnswer === k}
                      onChange={() => change(i, (x) => ({ ...x, correctAnswer: k as Question['correctAnswer'] }))}
                      title="Правильный ответ"
                    />
                    <span className="qe-letter" style={{ background: THEME.platformColors[k], color: THEME.platformTextColors[k] }}>
                      {ANSWER_LETTERS[k]}
                    </span>
                    <input
                      className="input"
                      placeholder={`Ответ ${ANSWER_LETTERS[k]}`}
                      maxLength={GAME_CONFIG.ANSWER_MAX_LENGTH}
                      value={a}
                      onChange={(e) =>
                        change(i, (x) => {
                          const answers = [...x.answers] as Question['answers'];
                          answers[k] = e.target.value;
                          return { ...x, answers };
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="hint">Отметьте кружком правильный ответ.</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
