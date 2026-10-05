import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { ANSWER_LETTERS, MUTATORS, POWERUPS, THEME, categoryIcon, type PublicPlayer, type RoomState } from '@quiz/shared';
import { ArenaView } from '../../game/ArenaView';
import { createSocket, request } from '../../network/socket';
import { sessions, type HostSession } from '../../network/session';
import { trackServerClock, useSecondsLeft } from '../../network/useServerClock';
import { RobotIcon } from '../../ui/RobotIcon';
import { music, type TrackId } from '../../ui/music';
import { isMuted, setMuted, sfx, unlockAudio } from '../../ui/sound';

const photoUrl = (roomId: string, p: PublicPlayer) =>
  p.photoVersion > 0 ? `/api/rooms/${roomId}/photo/${p.id}?v=${p.photoVersion}` : null;

/** Until a player's intro card the host sees an anonymous "Игрок #N" and no photo. */
const shownName = (p: PublicPlayer, index: number) => (p.revealed ? p.name || '…' : `Игрок #${index + 1}`);
const shownPhoto = (roomId: string, p: PublicPlayer) => (p.revealed ? photoUrl(roomId, p) : null);
const effectIcons = (p: PublicPlayer) => p.effects.map((e) => POWERUPS[e].icon).join('');

async function resolveJoinBase(): Promise<string> {
  try {
    const info = await fetch('/api/info').then((r) => r.json());
    if (info.publicUrl) return String(info.publicUrl);
    const local = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    if (local && info.lanIps?.length) return `${location.protocol}//${info.lanIps[0]}${location.port ? `:${location.port}` : ''}`;
  } catch {
    /* fall back to the current origin */
  }
  return location.origin;
}

export function HostScreen() {
  const [params] = useSearchParams();
  const testPlayers = Math.min(19, Number(params.get('testPlayers')) || 0);
  const fresh = params.has('fresh');
  const navigate = useNavigate();
  const socket = useMemo(createSocket, []);
  // phone reactions are forwarded to the 3D arena through this tiny event bus
  const bus = useMemo(() => new EventTarget(), []);
  const [session, setSession] = useState<HostSession | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [joinBase, setJoinBase] = useState(location.origin);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (socket.disconnected) socket.connect();
    void resolveJoinBase().then(setJoinBase);
    socket.on('connect', async () => {
      setConnected(true);
      if (fresh) {
        // Launched from the desktop shortcut: always start with a clean room (no leftover bots).
        sessions.setHost(null);
        return;
      }
      const saved = sessions.host();
      if (!saved) return;
      const res = await request((cb) => socket.emit('host:rejoin', saved, cb));
      if (res.ok) setSession(saved);
      else {
        sessions.setHost(null);
        setSession(null);
      }
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', (st) => {
      trackServerClock(st);
      setState(st);
    });
    socket.on('reaction', (r) => bus.dispatchEvent(new CustomEvent('reaction', { detail: r })));
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  const joinUrl = session ? `${joinBase}/join/${session.roomId}` : '';
  useEffect(() => {
    if (!joinUrl) return;
    QRCode.toDataURL(joinUrl, { width: 420, margin: 1, color: { dark: '#160c35', light: '#ffffff' } }).then(setQr);
  }, [joinUrl]);

  const act = useCallback(
    async (fn: (cb: (res: any) => void) => void) => {
      unlockAudio();
      const res = await request(fn);
      setProblem(res.ok ? null : res.error);
      return res;
    },
    [],
  );

  const create = useCallback(async () => {
    const res = await act((cb) => socket.emit('host:create', cb));
    if (!res.ok) return;
    const s = { roomId: (res as any).roomId as string, hostToken: (res as any).hostToken as string };
    sessions.setHost(s);
    setSession(s);
    if (testPlayers > 0) await act((cb) => socket.emit('host:addBots', { count: testPlayers }, cb));
  }, [act, socket, testPlayers]);

  const newGame = async () => {
    if (session) await act((cb) => socket.emit('host:close', cb));
    sessions.setHost(null);
    setSession(null);
    setState(null);
    await create();
  };

  useHostSounds(state);
  useHostMusic(state);
  const [muted, setMutedState] = useState(isMuted());

  if (!session || !state) {
    return (
      <div className="host host-empty">
        <h1 className="logo">
          Знание — сила<span>Arena</span>
        </h1>
        <p className="hint">{connected ? 'Экран ведущего. Создайте комнату — игроки подключатся по QR-коду.' : 'Подключение к серверу…'}</p>
        <button className="btn huge primary" data-testid="create-game" onClick={create} disabled={!connected}>
          Создать игру
        </button>
        {testPlayers > 0 && <p className="hint">Тестовый режим: добавим {testPlayers} ботов</p>}
        {problem && <p className="hint warn">{problem}</p>}
        <button className="btn" data-testid="questions-link" onClick={() => navigate('/questions')}>
          📝 Вопросы
        </button>
        <Link className="btn link" to="/">
          На главную
        </Link>
      </div>
    );
  }

  const { phase } = state;
  const canStart = phase === 'LOBBY' && state.players.length > 0;
  const canNext = phase === 'NEXT_QUESTION' && !state.paused;
  const canPause = phase !== 'LOBBY' && phase !== 'FINAL';
  const canSkip = (phase === 'INTRO' || phase === 'CATEGORY' || phase === 'MUTATOR' || phase === 'POWERUPS' || phase === 'POWERUP_SHOW') && !state.paused;

  return (
    <div className="host">
      <TopBar state={state} />
      <div className="stage">
        <ArenaView state={state} bus={bus} />
        {phase === 'LOBBY' && <LobbyPanel state={state} qr={qr} joinUrl={joinUrl} />}
        <PhaseBanner state={state} />
        {phase === 'INTRO' && <IntroOverlay state={state} />}
        {phase === 'MUTATOR' && state.mutator && <MutatorOverlay state={state} />}
        {phase === 'CATEGORY' && state.category && <CategoryCarousel key={state.questionIndex} state={state} />}
        {phase === 'FINAL' && <FinalOverlay state={state} />}
        {state.paused && (
          <div className="pause-overlay" data-testid="paused">
            <div>ПАУЗА</div>
            <small>Игроки ждут. Нажмите «Продолжить», чтобы вернуться в игру.</small>
          </div>
        )}
        <div className="controls">
          {phase === 'LOBBY' && (
            <button className="btn primary" data-testid="start-game" disabled={!canStart} onClick={() => act((cb) => socket.emit('host:start', cb))}>
              ▶ Начать игру
            </button>
          )}
          <button
            className="btn"
            data-testid="mute"
            title={muted ? 'Включить звук' : 'Выключить звук'}
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
              unlockAudio();
            }}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          {canSkip && (
            <button className="btn" data-testid="skip" onClick={() => act((cb) => socket.emit('host:skip', cb))}>
              ⏩ {phase === 'INTRO' ? 'Дальше' : 'Пропустить'}
            </button>
          )}
          {canPause && (
            <button
              className={`btn ${state.paused ? 'primary' : ''}`}
              data-testid="pause"
              onClick={() => act((cb) => socket.emit('host:pause', { paused: !state.paused }, cb))}
            >
              {state.paused ? '▶ Продолжить' : '⏸ Пауза'}
            </button>
          )}
          <button className="btn" data-testid="next-question" disabled={!canNext} onClick={() => act((cb) => socket.emit('host:next', cb))}>
            ⏭ Следующий вопрос
          </button>
          <button className="btn" data-testid="restart" onClick={() => act((cb) => socket.emit('host:restart', cb))}>
            ↺ Перезапустить
          </button>
          <button className="btn" data-testid="new-game" onClick={newGame}>
            ✚ Новая игра
          </button>
          {phase === 'LOBBY' && (
            <button className="btn" data-testid="questions-link" onClick={() => navigate('/questions')}>
              📝 Вопросы
            </button>
          )}
          {phase === 'LOBBY' && (
            <button className="btn ghost" onClick={() => act((cb) => socket.emit('host:addBots', { count: 3 }, cb))}>
              + 3 бота
            </button>
          )}
        </div>
        {!connected && <div className="banner warn floating">Связь с сервером потеряна — переподключаемся…</div>}
        {problem && <div className="banner warn floating low">{problem}</div>}
      </div>
      <Scoreboard state={state} />
    </div>
  );
}

function TopBar({ state }: { state: RoomState }) {
  const left = useSecondsLeft(state);
  const q = state.question;
  const showQuestion = q && state.phase !== 'LOBBY' && state.phase !== 'FINAL';
  const idleTitle = { LOBBY: 'Ждём игроков', INTRO: 'Знакомство', CATEGORY: '🎲 Выбираем категорию', MUTATOR: '🎲 Особый вопрос', POWERUPS: '⚡ Этап спецприёмов', POWERUP_SHOW: '👀 Кто на кого?', FINAL: 'Финал!' } as Partial<Record<RoomState['phase'], string>>;
  const total = state.phaseEndsAt ? (state.phaseEndsAt - state.phaseStartedAt) / 1000 : 1;
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo small">
          Знание — сила<span>Arena</span>
        </div>
        <div className="room-code" data-testid="room-code">
          {state.roomId}
        </div>
      </div>
      <div className="question-area">
        {showQuestion && state.phase === 'QUESTION' ? (
          <>
            <div className="q-meta">
              Раунд {state.round} из {state.totalRounds} · Вопрос {state.roundQuestion} из {state.roundSize}
              {state.category && (
                <span className="cat-badge" data-testid="category-badge">
                  {categoryIcon(state.category)} {state.category}
                </span>
              )}
              {state.mutator && (
                <span className="cat-badge mut-badge" data-testid="mutator-badge">
                  {MUTATORS[state.mutator].icon} {MUTATORS[state.mutator].name}
                </span>
              )}
            </div>
            <div className="q-title q-hidden" data-testid="host-question-hidden">
              📱 Вопрос и варианты — на ваших телефонах
            </div>
          </>
        ) : showQuestion ? (
          <>
            <div className="q-meta">
              Раунд {state.round} из {state.totalRounds} · Вопрос {state.roundQuestion} из {state.roundSize}
              {state.category && (
                <span className="cat-badge" data-testid="category-badge">
                  {categoryIcon(state.category)} {state.category}
                </span>
              )}
              {state.mutator && (
                <span className="cat-badge mut-badge" data-testid="mutator-badge">
                  {MUTATORS[state.mutator].icon} {MUTATORS[state.mutator].name}
                </span>
              )}
            </div>
            <div className="q-title" data-testid="host-question">
              {q.text}
            </div>
            <div className="q-answers">
              {q.answers.map((a, i) => (
                <span
                  key={i}
                  className={`q-chip ${state.correctAnswer === i ? 'correct' : ''} ${state.correctAnswer !== null && state.correctAnswer !== i ? 'dim' : ''}`}
                  style={{ background: THEME.platformColors[i], color: THEME.platformTextColors[i] }}
                >
                  <b>{ANSWER_LETTERS[i]}</b> {a}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="q-title">{idleTitle[state.phase] ?? 'Ждём игроков'}</div>
        )}
      </div>
      <div className={`timer ${state.phase === 'QUESTION' && !state.paused && (left ?? 99) <= 5 ? 'hot' : ''}`} data-testid="phase" data-phase={state.phase} data-q={state.questionIndex}>
        {(state.phase === 'QUESTION' || state.phase === 'POWERUPS') && left !== null ? (
          <>
            <svg viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="44" className="track" />
              <circle cx="50" cy="50" r="44" className="bar" style={{ strokeDashoffset: 276.5 * (1 - left / total) }} />
            </svg>
            <span>{Math.ceil(left)}</span>
          </>
        ) : (
          <span className="phase-label">{PHASE_LABEL[state.phase]}</span>
        )}
      </div>
    </header>
  );
}

const PHASE_LABEL: Record<RoomState['phase'], string> = {
  LOBBY: 'Лобби',
  INTRO: 'Игроки',
  CATEGORY: 'Тема',
  MUTATOR: 'Твист',
  POWERUPS: 'Приёмы',
  POWERUP_SHOW: 'Показ',
  QUESTION: 'Вопрос',
  LOCKED: 'Стоп!',
  RUNNING: 'Бегут!',
  REVEAL: 'Ответ',
  DROP: 'Люки!',
  NEXT_QUESTION: 'Итоги',
  FINAL: 'Финал',
};

function LobbyPanel({ state, qr, joinUrl }: { state: RoomState; qr: string | null; joinUrl: string }) {
  const ready = state.players.filter((p) => p.ready).length;
  return (
    <div className="lobby-panel">
      <div className="qr-card">
        {qr ? <img src={qr} alt="QR-код для подключения" data-testid="qr" /> : <div className="spinner" />}
        <div className="qr-code-text">{state.roomId}</div>
        <div className="qr-url">{joinUrl}</div>
      </div>
      <div className="lobby-list">
        <h3>
          Игроки: {state.players.length} <small>готовы {ready}</small>
        </h3>
        <ul>
          {state.players.map((p, i) => (
            <li key={p.id} className={p.connected || p.isBot ? '' : 'offline'}>
              <RobotIcon avatar={p.avatar} photoUrl={shownPhoto(state.roomId, p)} name={shownName(p, i)} size={34} />
              <span className="pname">{p.name ? shownName(p, i) : 'Настраивается…'}</span>
              <span className={`pill ${p.ready ? 'ok' : ''}`}>{p.ready ? 'Ready' : '…'}</span>
            </li>
          ))}
          {state.players.length === 0 && <li className="empty">Сканируйте QR-код телефоном</li>}
        </ul>
        <p className="hint lobby-anon">Имена и фото раскроются на знакомстве.</p>
      </div>
    </div>
  );
}

function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Slot-machine style strip that slows down and stops on the category chosen by the server. */
function CategoryCarousel({ state }: { state: RoomState }) {
  const winner = state.category!;
  const total = Math.max(1.8, ((state.phaseEndsAt ?? 0) - state.phaseStartedAt) / 1000);
  const { seq, winnerIndex } = useMemo(() => {
    const cards: string[] = [];
    for (let i = 0; i < 4; i++) cards.push(...shuffled(state.categories));
    const at = cards.length;
    cards.push(winner);
    for (let i = 0; i < 3; i++) cards.push(...shuffled(state.categories));
    return { seq: cards, winnerIndex: at };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const viewport = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const vp = viewport.current;
    const st = strip.current;
    if (!vp || !st) return;
    const card = st.children[winnerIndex] as HTMLElement;
    const stride = (st.children[1] as HTMLElement).offsetLeft - (st.children[0] as HTMLElement).offsetLeft;
    const target = vp.clientWidth / 2 - (card.offsetLeft + card.offsetWidth / 2);
    const duration = (total - 1.3) * 1000;
    const start = performance.now();
    let lastIdx = -1;
    let raf = 0;
    const frame = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const x = target * (1 - Math.pow(1 - p, 4));
      st.style.transform = `translateX(${x}px)`;
      const idx = Math.floor((vp.clientWidth / 2 - x) / stride);
      if (idx !== lastIdx) {
        lastIdx = idx;
        sfx.tick();
      }
      if (p < 1) raf = requestAnimationFrame(frame);
      else {
        setDone(true);
        sfx.chime();
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="category-overlay" data-testid="category-carousel" data-winner={winner}>
      <div className="category-title">
        Раунд {state.round} из {state.totalRounds}
        <b>{done ? 'Тема раунда' : '🎲 Выбираем категорию…'}</b>
      </div>
      <div className="carousel-viewport" ref={viewport}>
        <div className="carousel-marker" />
        <div className="carousel-strip" ref={strip}>
          {seq.map((name, i) => (
            <div key={i} className={`carousel-card ${done && i === winnerIndex ? 'winner' : ''}`}>
              <span className="cc-icon">{categoryIcon(name)}</span>
              <span className="cc-name">{name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MutatorOverlay({ state }: { state: RoomState }) {
  const m = MUTATORS[state.mutator!];
  return (
    <div className="mutator-overlay" data-testid="mutator-card" data-mutator={state.mutator}>
      <div className="mutator-card" key={state.questionIndex}>
        <div className="mutator-kicker">Особый вопрос раунда</div>
        <div className="mutator-icon">{m.icon}</div>
        <div className="mutator-name">{m.name}</div>
        <div className="mutator-desc">{m.description}</div>
      </div>
    </div>
  );
}

function IntroOverlay({ state }: { state: RoomState }) {
  const index = state.players.findIndex((p) => p.id === state.introPlayerId);
  const p = index >= 0 ? state.players[index] : null;
  if (!p) {
    return (
      <div className="intro-overlay" data-testid="intro-rules">
        <div className="intro-card rules">
          <h2>Как играть</h2>
          <ul>
            <li>Отвечайте с телефона: чем быстрее верно, тем больше очков.</li>
            <li>Ваш робот бежит на платформу выбранного ответа. Под неверными откроются люки!</li>
            <li>
              За верные ответы выпадают спецприёмы: {Object.values(POWERUPS).map((x) => x.icon).join(' ')} Применяйте их перед вопросом.
            </li>
            <li>Сейчас познакомимся: каждый игрок появится на экране.</li>
          </ul>
        </div>
      </div>
    );
  }
  return (
    <div className="intro-overlay" data-testid="intro-card" data-player={p.id}>
      <div className="intro-card" key={p.id}>
        <div className="intro-count">
          Знакомство · {state.introIndex + 1} из {state.introTotal}
        </div>
        <div className="intro-people">
          <div className="intro-photo" data-testid="intro-photo">
            {photoUrl(state.roomId, p) ? (
              <img src={photoUrl(state.roomId, p)!} alt={p.name} />
            ) : (
              <span>{(p.name || '?').charAt(0).toUpperCase()}</span>
            )}
          </div>
          <RobotIcon avatar={p.avatar} photoUrl={photoUrl(state.roomId, p)} name={p.name} size={135} />
        </div>
        <div className="intro-name">{p.name || 'Игрок'}</div>
        {p.comment ? <div className="intro-comment">«{p.comment}»</div> : <div className="intro-comment muted">Без комментариев</div>}
      </div>
    </div>
  );
}

function PhaseBanner({ state }: { state: RoomState }) {
  const q = state.question;
  const answered = state.players.filter((p) => p.answered).length;
  let text: string | null = null;
  let cls = '';
  if (state.phase === 'QUESTION') {
    text = `Ответили ${answered} из ${state.players.length}`;
    const hit = state.players.filter((p) => p.effects.length > 0);
    if (hit.length > 0) {
      text += ` · ${hit.map((p) => `${effectIcons(p)} ${shownName(p, state.players.indexOf(p))}`).join('  ')}`;
    }
  }
  if (state.phase === 'POWERUP_SHOW') text = '👀 Кто на кого применил приём?';
  if (state.phase === 'POWERUPS') text = `⚡ Этап спецприёмов · применено: ${state.powerupsUsed}`;
  if (state.phase === 'INTRO') text = state.introPlayerId ? '👋 Знакомьтесь!' : '📜 Правила';
  if (state.phase === 'LOCKED') text = 'Ответы приняты!';
  if (state.phase === 'RUNNING') text = 'Бегут к своим ответам…';
  if ((state.phase === 'REVEAL' || state.phase === 'DROP') && q && state.correctAnswer !== null) {
    text = `Правильный ответ: ${ANSWER_LETTERS[state.correctAnswer]} — ${q.answers[state.correctAnswer]}`;
    cls = 'correct';
  }
  if (state.phase === 'NEXT_QUESTION') text = state.roundEnd ? `🏁 Конец раунда ${state.round} из ${state.totalRounds}` : 'Следующий вопрос — скоро';
  if (!text) return null;
  return (
    <div className={`phase-banner ${cls}`} data-testid="phase-banner">
      {text}
    </div>
  );
}

function Scoreboard({ state }: { state: RoomState }) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  return (
    <footer className="scoreboard" data-testid="scoreboard">
      {ranked.map((p, i) => {
        const orig = state.players.indexOf(p);
        const status =
          state.phase === 'QUESTION' ? (p.answered ? '✓' : '…') : p.result === 'correct' ? '✅' : p.result === 'wrong' ? '❌' : p.result === 'none' ? '⏱' : '';
        return (
          <div key={p.id} className={`score-item ${!p.connected && !p.isBot ? 'offline' : ''}`}>
            <span className="rank">{i + 1}</span>
            <RobotIcon avatar={p.avatar} photoUrl={shownPhoto(state.roomId, p)} name={shownName(p, orig)} size={30} />
            <span className="sname">{shownName(p, orig)}</span>
            {p.effects.length > 0 && <span className="seffects">{effectIcons(p)}</span>}
            {p.streak >= 2 && <span className="seffects" title="Серия верных ответов">🔥{p.streak}</span>}
            <span className="sscore">{p.score}</span>
            {status && <span className="sstatus">{status}</span>}
          </div>
        );
      })}
      {ranked.length === 0 && <div className="score-empty">Табло появится, когда подключатся игроки</div>}
    </footer>
  );
}

/** Final screen: the podium itself is 3D (see ArenaScene.finale); here are the title, the winners' names and the ranking. */
function FinalOverlay({ state }: { state: RoomState }) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <div className="final-overlay final3d" data-testid="final">
      <div className="final-banner">
        <div className="podium-title">🏆 Итоги игры</div>
        <div className="final-top" data-testid="podium">
          {ranked.slice(0, 3).map((p, i) => (
            <span key={p.id} className={i === 0 ? 'winner-name' : ''} data-testid={`podium-${i + 1}`}>
              {medals[i]} {p.name} · {p.score}
            </span>
          ))}
        </div>
      </div>
      <ol className="final-list">
        {ranked.map((p, i) => (
          <li key={p.id}>
            <span className="rank">{i + 1}</span>
            <span className="sname">{p.name}</span>
            <span className="sscore">{p.score}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function useHostSounds(state: RoomState | null) {
  const prev = useRef<{ key: string; answered: number }>({ key: '', answered: 0 });
  const left = useSecondsLeft(state);
  const lastTick = useRef<number | null>(null);

  useEffect(() => {
    if (!state) return;
    const key = `${state.phase}:${state.questionIndex}:${state.introPlayerId ?? ''}`;
    const answered = state.players.filter((p) => p.answered).length;
    if (key !== prev.current.key) {
      if (state.phase === 'QUESTION') sfx.questionStart();
      if (state.phase === 'INTRO' || state.phase === 'POWERUPS') sfx.intro();
      if (state.phase === 'QUESTION' && state.players.some((p) => p.effects.length > 0)) setTimeout(() => sfx.powerup(), 500);
      if (state.phase === 'RUNNING') {
        sfx.whoosh();
        sfx.drumroll();
      }
      if (state.phase === 'CATEGORY') sfx.whoosh();
      if (state.phase === 'MUTATOR') sfx.mutator();
      if (state.phase === 'QUESTION' && state.questionIndex > 0 && !state.category) sfx.nextRound();
      if (state.phase === 'LOCKED') sfx.lock();
      if (state.phase === 'REVEAL') sfx.correct();
      if (state.phase === 'DROP') {
        sfx.platformOpen();
        sfx.thud();
        if (state.players.some((p) => p.result === 'correct' && p.streak >= 3)) setTimeout(() => sfx.streak(), 600);
        if (state.players.some((p) => p.result === 'wrong')) sfx.fall();
      }
      if (state.phase === 'FINAL') {
        sfx.victory();
        setTimeout(() => sfx.applause(), 900);
      }
    } else if (state.phase === 'QUESTION' && answered > prev.current.answered) {
      sfx.select();
    }
    prev.current = { key, answered };
  }, [state]);

  const wasPaused = useRef(false);
  useEffect(() => {
    if (!state) return;
    if (state.paused !== wasPaused.current) {
      wasPaused.current = state.paused;
      if (state.paused) sfx.pause();
      else sfx.resume();
    }
  }, [state?.paused]);

  useEffect(() => {
    if (state?.phase !== 'QUESTION' || state.paused || left === null) return;
    const s = Math.ceil(left);
    if (s <= 3 && s >= 1 && lastTick.current !== s) {
      lastTick.current = s;
      sfx.countdown(s === 1);
    }
    if (s > 3) lastTick.current = null;
  }, [left, state?.phase]);
}

/** Every stage of the game has its own track; the volume drops under the questions and while paused. */
function useHostMusic(state: RoomState | null) {
  useEffect(() => {
    if (!state) return music.play('lobby', 0.3);
    const stage: Record<RoomState['phase'], [TrackId, number]> = {
      LOBBY: ['lobby', 0.3],
      INTRO: ['intro', 0.2],
      CATEGORY: ['category', 0.2],
      MUTATOR: ['mutator', 0.22],
      POWERUPS: ['powerups', 0.2],
      POWERUP_SHOW: ['powerups', 0.2],
      QUESTION: ['question', 0.14],
      LOCKED: ['running', 0.2],
      RUNNING: ['running', 0.2],
      REVEAL: ['results', 0.2],
      DROP: ['results', 0.2],
      NEXT_QUESTION: ['next', 0.18],
      FINAL: ['final', 0.5],
    };
    const [track, volume] = stage[state.phase];
    music.play(track, state.paused ? volume * 0.25 : volume);
  }, [state?.phase, state?.paused, state === null]);
}
