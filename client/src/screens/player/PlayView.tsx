import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ANSWER_LETTERS, GAME_CONFIG, MUTATORS, POWERUPS, POWERUP_TYPES, REACTIONS, THEME, categoryIcon, type PlayerPrivate, type PublicPlayer, type RoomState } from '@quiz/shared';
import { request, type GameSocket } from '../../network/socket';
import { useSecondsLeft } from '../../network/useServerClock';
import { RobotIcon } from '../../ui/RobotIcon';
import { sfx } from '../../ui/sound';
import { BombLayer, PowerupPanel, SlimeLayer, Toasts, type Toast } from './Powerups';

interface Props {
  state: RoomState;
  me: PublicPlayer;
  priv: PlayerPrivate | null;
  notices: Toast[];
  photoUrl: string | null;
  socket: GameSocket;
}

export function PlayView({ state, me, priv, notices, photoUrl, socket }: Props) {
  const left = useSecondsLeft(state);
  const [picked, setPicked] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [taps, setTaps] = useState<number[]>([]);
  const [slimeGone, setSlimeGone] = useState(false);
  const [bombed, setBombed] = useState(false);
  const [cooling, setCooling] = useState(false);
  const lastPhase = useRef('');
  const lastNotice = useRef(0);

  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const place = ranked.findIndex((p) => p.id === me.id) + 1;
  const myAnswer = me.answer ?? picked;

  useEffect(() => {
    const key = `${state.phase}:${state.questionIndex}`;
    if (key === lastPhase.current) return;
    lastPhase.current = key;
    if (state.phase === 'QUESTION') {
      setPicked(null);
      setProblem(null);
      setTaps([GAME_CONFIG.FREEZE_TAPS, GAME_CONFIG.FREEZE_TAPS, GAME_CONFIG.FREEZE_TAPS, GAME_CONFIG.FREEZE_TAPS]);
      setSlimeGone(false);
      setBombed(false);
      navigator.vibrate?.(60);
    }
    if (state.phase === 'INTRO' && state.introPlayerId === me.id) sfx.intro();
    if (state.phase === 'REVEAL') {
      if (me.result === 'correct') sfx.correct();
      else if (me.result === 'wrong') sfx.wrong();
    }
  }, [state.phase, state.questionIndex, state.introPlayerId, me.result, me.id]);

  // sound for fresh toasts (power-up received, shield, bet, ...)
  useEffect(() => {
    const last = notices[notices.length - 1];
    if (!last || last.id === lastNotice.current) return;
    lastNotice.current = last.id;
    if (last.text.startsWith('Получен приём')) sfx.pickup();
    else if (last.text.startsWith('🛡')) sfx.shield();
  }, [notices]);

  const effects = me.effects;
  const frozen = effects.includes('freeze');
  const slimed = effects.includes('slime') && !slimeGone;
  const hasBombs = effects.includes('bombs');
  const catapulted = effects.includes('catapult');
  const blocked = bombed || Boolean(priv?.blocked) || catapulted;
  const phaseTotal = state.phaseEndsAt ? (state.phaseEndsAt - state.phaseStartedAt) / 1000 : 1;
  const windowSec = priv ? Math.min(phaseTotal, priv.answerWindowMs / 1000) : phaseTotal;
  const myLeft = Math.max(0, (left ?? 0) - (phaseTotal - windowSec));
  const timeUp = state.phase === 'QUESTION' && !state.paused && left !== null && myLeft <= 0;

  const react = (emoji: string) => {
    if (cooling) return;
    setCooling(true);
    window.setTimeout(() => setCooling(false), GAME_CONFIG.REACTION_COOLDOWN_MS);
    sfx.tap();
    navigator.vibrate?.(15);
    void request((cb) => socket.emit('player:react', { emoji }, cb));
  };

  const onCleared = useCallback(() => setSlimeGone(true), []);
  const onExplode = useCallback(() => {
    setBombed(true);
    void request((cb) => socket.emit('player:bombed', cb));
  }, [socket]);

  const answer = async (i: number) => {
    if (picked !== null || me.answered || blocked || timeUp) return;
    if (frozen && (taps[i] ?? 0) > 0) {
      sfx.iceCrack();
      setTaps((t) => t.map((n, k) => (k === i ? n - 1 : n)));
      if ((taps[i] ?? 0) > 1) return;
    }
    setPicked(i);
    sfx.select();
    navigator.vibrate?.(30);
    const res = await request((cb) => socket.emit('player:answer', { questionIndex: state.questionIndex, answer: i }, cb));
    if (!res.ok) {
      setProblem(res.error);
      if (!me.answered) setPicked(null);
    }
  };

  const q = state.question;
  const correct = state.correctAnswer;

  return (
    <div className="play">
      <header className="me-bar">
        <RobotIcon avatar={me.avatar} photoUrl={photoUrl} name={me.name} size={42} />
        <div className="me-name">
          <b>{me.name}</b>
          <span>{me.score} очков{state.phase !== 'LOBBY' && place > 0 ? ` · ${place} место` : ''}</span>
        </div>
        {priv && Object.entries(priv.inventory).length > 0 && state.phase !== 'POWERUPS' && (
          <span className="inv-chips" data-testid="inventory" title="Ваши спецприёмы">
            {POWERUP_TYPES.filter((t) => (priv.inventory[t] ?? 0) > 0).map((t) => (
              <span key={t}>
                {POWERUPS[t].icon}
                {(priv.inventory[t] ?? 0) > 1 ? `×${priv.inventory[t]}` : ''}
              </span>
            ))}
            {priv.shield && <span>🛡️</span>}
          </span>
        )}
        {me.streak >= 2 && (
          <span className="inv-chips" title="Серия верных ответов">
            🔥{me.streak}
          </span>
        )}
        {q && state.phase !== 'FINAL' && (
          <span className="q-counter">
            Р{state.round} · {state.roundQuestion}/{state.roundSize}
          </span>
        )}
      </header>

      {state.paused && (
        <div className="play-center paused-card" data-testid="phone-paused">
          <div className="place">⏸</div>
          <h2>Пауза</h2>
          <p className="hint">Ведущий приостановил игру. Сейчас продолжим!</p>
        </div>
      )}

      <Toasts items={notices} />

      {!state.paused && state.phase === 'INTRO' && (
        <div className="play-center" data-testid="phone-intro">
          {state.introPlayerId === me.id ? (
            <>
              <div className="place">🎉</div>
              <h2>Сейчас представляют вас!</h2>
              <p className="hint">Смотрите на большой экран.</p>
            </>
          ) : state.introPlayerId ? (
            <>
              <div className="place">👀</div>
              <h2>Знакомство</h2>
              <p className="hint">
                Игрок {state.introIndex + 1} из {state.introTotal}. Смотрите на большой экран.
              </p>
            </>
          ) : (
            <>
              <div className="place">📜</div>
              <h2>Правила игры</h2>
              <p className="hint">Смотрите на большой экран. Потом мы познакомимся со всеми игроками.</p>
            </>
          )}
        </div>
      )}

      {!state.paused && state.phase === 'CATEGORY' && (
        <div className="play-center" data-testid="phone-category">
          <div className="place">{left !== null && left < 1.5 && state.category ? categoryIcon(state.category) : '🎲'}</div>
          <h2>{left !== null && left < 1.5 && state.category ? state.category : 'Крутим категорию…'}</h2>
          <p className="hint">
            Раунд {state.round} из {state.totalRounds}. Смотрите на большой экран.
          </p>
        </div>
      )}

      {!state.paused && state.phase === 'MUTATOR' && state.mutator && (
        <div className="play-center" data-testid="phone-mutator">
          <div className="place">{MUTATORS[state.mutator].icon}</div>
          <h2>{MUTATORS[state.mutator].name}</h2>
          <p className="hint">{MUTATORS[state.mutator].description}</p>
        </div>
      )}

      {!state.paused && state.phase === 'POWERUP_SHOW' && (
        <div className="play-center" data-testid="phone-powerup-show">
          <div className="place">👀</div>
          <h2>Смотрите на экран!</h2>
          <p className="hint">Сейчас будет видно, кто на кого применил приёмы.</p>
        </div>
      )}

      {!state.paused && state.phase === 'POWERUPS' && <PowerupPanel state={state} me={me} priv={priv} socket={socket} left={left} />}

      {!state.paused && state.phase === 'LOBBY' && (
        <div className="play-center">
          <RobotIcon avatar={me.avatar} photoUrl={photoUrl} name={me.name} size={150} />
          <h2>Вы в игре!</h2>
          <p className="hint">Смотрите на большой экран. Ждём, когда ведущий начнёт.</p>
          <p className="hint">Игроков: {state.players.length}</p>
          <Link className="btn" to={`/join/${state.roomId}`}>
            Изменить профиль
          </Link>
        </div>
      )}

      {!state.paused && state.phase === 'QUESTION' && q && (
        <div className="question-view">
          <div className="timer-bar">
            <div style={{ width: `${Math.min(100, (myLeft / Math.max(1, phaseTotal)) * 100)}%` }} />
            <span>{Math.ceil(myLeft)}</span>
          </div>
          {(state.category || state.mutator) && (
            <div className="chip-row">
              {state.category && (
                <span className="cat-chip">
                  {categoryIcon(state.category)} {state.category}
                </span>
              )}
              {state.mutator && (
                <span className="cat-chip mut-chip">
                  {MUTATORS[state.mutator].icon} {MUTATORS[state.mutator].name}
                </span>
              )}
            </div>
          )}
          <h2 className="q-text">{q.text}</h2>
          {effects.length > 0 && myAnswer === null && !blocked && (
            <p className="effect-note" data-testid="effect-note">
              {effects.includes('freeze') && '❄️ Заморозка: разбейте лёд тремя тапами. '}
              {effects.includes('slime') && '🟢 Слизь: сотрите её пальцем. '}
              {hasBombs && '💣 Бомбы: не трогайте их! '}
              {catapulted && '🚀 Катапульта! '}
              {effects.includes('reduce_time') && `⏳ Времени меньше на ${GAME_CONFIG.REDUCE_TIME_SECONDS} с.`}
            </p>
          )}
          {blocked ? (
            catapulted ? (
              <div className="picked bombed" data-testid="catapulted">
                <span className="text">🚀 Вас катапультировали!</span>
                <small>В этом вопросе вы не участвуете. Очки не меняются.</small>
              </div>
            ) : (
              <div className="picked bombed" data-testid="bombed">
                <span className="text">💥 Бомба взорвалась!</span>
                <small>Ответ на этот вопрос потерян</small>
              </div>
            )
          ) : myAnswer !== null ? (
            <Picked index={myAnswer} text={q.answers[myAnswer]} note="Ответ принят! Изменить нельзя." />
          ) : timeUp ? (
            <div className="picked bombed" data-testid="time-up">
              <span className="text">⏱ Ваше время вышло</span>
              <small>Ждём остальных</small>
            </div>
          ) : (
            <div className="answer-wrap">
              <div className="answer-grid">
                {q.answers.map((a, i) => {
                  const ice = frozen && (taps[i] ?? 0) > 0;
                  return (
                    <button
                      key={i}
                      data-testid={`answer-${i}`}
                      className={`answer-btn ${ice ? 'frozen' : ''}`}
                      style={ice ? undefined : { background: THEME.platformColors[i], color: THEME.platformTextColors[i] }}
                      onClick={() => answer(i)}
                    >
                      <span className="letter">{ANSWER_LETTERS[i]}</span>
                      <span className="text">{a}</span>
                      {ice && <span className="ice-label">❄️ {taps[i]}</span>}
                    </button>
                  );
                })}
              </div>
              {slimed && <SlimeLayer onCleared={onCleared} />}
              {hasBombs && <BombLayer onExplode={onExplode} />}
            </div>
          )}
          {problem && <p className="hint warn">{problem}</p>}
        </div>
      )}

      {!state.paused && (state.phase === 'LOCKED' || state.phase === 'RUNNING' || state.phase === 'REVEAL' || state.phase === 'DROP') && q && (
        <div className="play-center">
          {me.answer === null ? (
            <h2 className="result none">{catapulted ? '🚀 Катапульта: вы вылетели из вопроса' : blocked ? '💥 Бомба — ответ потерян' : '⏱ Нет ответа'}</h2>
          ) : (
            <Picked index={me.answer} text={q.answers[me.answer]} note="Ваш ответ" />
          )}
          {state.phase === 'LOCKED' && <p className="hint">Ответы приняты. Смотрите на экран!</p>}
          {state.phase === 'RUNNING' && <p className="hint">🏃 Ваш робот бежит к платформе… Сейчас узнаем, правильно ли!</p>}
          {correct !== null && (
            <>
              <p className="hint">
                Правильно: <b>{ANSWER_LETTERS[correct]} — {q.answers[correct]}</b>
              </p>
              {me.result === 'correct' && <h2 className="result ok">✅ Верно!</h2>}
              {me.result === 'wrong' && (
                <h2 className="result bad">{state.phase === 'DROP' ? '😱 Вы провалились!' : '❌ Мимо… платформа откроется!'}</h2>
              )}
              {state.phase === 'DROP' && me.lastDelta !== 0 && (
                <div className={`delta ${me.lastDelta < 0 ? 'neg' : ''}`}>
                  {me.lastDelta > 0 ? '+' : '−'}
                  {Math.abs(me.lastDelta)}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!state.paused && state.phase === 'NEXT_QUESTION' && (
        <div className="play-center">
          <div className="place">{place}</div>
          <h2>место</h2>
          <p className="hint">{me.score} очков</p>
          <p className="hint">Следующий вопрос — скоро{left ? ` (${Math.ceil(left)} с)` : ''}</p>
        </div>
      )}

      {!state.paused && state.phase !== 'POWERUPS' && state.phase !== 'POWERUP_SHOW' && state.phase !== 'MUTATOR' && state.phase !== 'CATEGORY' && state.phase !== 'INTRO' && (
        <div className={`reaction-bar ${cooling ? 'cooling' : ''}`} data-testid="reaction-bar">
          {REACTIONS.map((e) => (
            <button key={e} data-testid={`react-${e}`} onClick={() => react(e)} aria-label={`Реакция ${e}`}>
              {e}
            </button>
          ))}
        </div>
      )}

      {!state.paused && state.phase === 'FINAL' && (
        <div className="play-center">
          {place === 1 ? <h1 className="winner-title">🏆 ПОБЕДА!</h1> : <h2>Игра окончена</h2>}
          <div className="place">{place}</div>
          <h2>место</h2>
          <p className="hint">{me.score} очков</p>
          {ranked[0] && place !== 1 && <p className="hint">Победитель: {ranked[0].name}</p>}
        </div>
      )}
    </div>
  );
}

function Picked({ index, text, note }: { index: number; text: string; note: string }) {
  return (
    <div className="picked" style={{ background: THEME.platformColors[index], color: THEME.platformTextColors[index] }}>
      <span className="letter">{ANSWER_LETTERS[index]}</span>
      <span className="text">{text}</span>
      <small>{note}</small>
    </div>
  );
}
