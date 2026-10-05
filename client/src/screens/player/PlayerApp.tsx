import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AVATARS, COMMENT_PROMPTS, GAME_CONFIG, type AvatarId } from '@quiz/shared';
import { request } from '../../network/socket';
import { RobotIcon } from '../../ui/RobotIcon';
import { unlockAudio } from '../../ui/sound';
import { PhotoStep } from './PhotoStep';
import { PlayView } from './PlayView';
import { usePlayerSession } from './usePlayerSession';

type Step = 'name' | 'photo' | 'avatar' | 'ready';

export function PlayerApp() {
  const { roomId = '' } = useParams();
  const code = roomId.toUpperCase();
  const location = useLocation();
  const navigate = useNavigate();
  const mode = location.pathname.startsWith('/play') ? 'play' : 'setup';
  const session = usePlayerSession(code);
  const { socket, state, me, priv, notices, error, connected, closed } = session;
  const [step, setStep] = useState<Step | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [commentTouched, setCommentTouched] = useState(false);
  const [prompt] = useState(() => COMMENT_PROMPTS[Math.floor(Math.random() * COMMENT_PROMPTS.length)]);

  useEffect(() => {
    if (priv && !commentTouched) setComment(priv.comment);
  }, [priv, commentTouched]);

  useEffect(() => {
    if (!me || step) return;
    if (!me.name) setStep('name');
    else if (me.photoVersion === 0) setStep('photo');
    else if (!me.ready) setStep('avatar');
    else setStep('ready');
  }, [me, step]);

  useEffect(() => {
    if (mode === 'play' && me && !me.name) navigate(`/join/${code}`, { replace: true });
  }, [mode, me, code, navigate]);

  if (closed) return <Message title="Игра завершена" text="Ведущий закрыл комнату." />;
  if (error) return <Message title="Не удалось подключиться" text={error} />;
  if (!state || !me) return <Message title="Подключаемся…" text={`Комната ${code}`} spinner />;

  const photoUrl = me.photoVersion > 0 ? `/api/rooms/${code}/photo/${me.id}?v=${me.photoVersion}` : null;

  const send = async (fn: (cb: (res: any) => void) => void) => {
    const res = await request(fn);
    if (!res.ok) setProblem(res.error);
    else setProblem(null);
    return res.ok;
  };

  if (mode === 'play') {
    return (
      <div className="phone">
        {!connected && <div className="banner warn">Связь потеряна — переподключаемся…</div>}
        <PlayView state={state} me={me} priv={priv} notices={notices} photoUrl={photoUrl} socket={socket} />
      </div>
    );
  }

  return (
    <div className="phone">
      {!connected && <div className="banner warn">Связь потеряна — переподключаемся…</div>}
      <header className="phone-head">
        <span className="logo-sm">Знание — сила</span>
        <span className="code-badge">Комната {code}</span>
      </header>
      <div className="steps-dots">
        {(['name', 'photo', 'avatar', 'ready'] as Step[]).map((s) => (
          <span key={s} className={s === step ? 'on' : ''} />
        ))}
      </div>
      {problem && <p className="hint warn">{problem}</p>}

      {step === 'name' && (
        <NameForm
          initial={me.name}
          onSubmit={async (name) => {
            unlockAudio();
            if (await send((cb) => socket.emit('player:profile', { name }, cb))) setStep('photo');
          }}
        />
      )}

      {step === 'photo' && (
        <PhotoStep
          onDone={async (dataUrl) => {
            if (await send((cb) => socket.emit('player:photo', { dataUrl }, cb))) setStep('avatar');
          }}
          onSkip={() => setStep('avatar')}
        />
      )}

      {step === 'avatar' && (
        <div className="step">
          <h2>Выберите робота</h2>
          <div className="avatar-grid">
            {AVATARS.map((a) => {
              // a colour already worn by another player cannot be picked
              const taken = state.players.some((p) => p.id !== me.id && p.avatar === a.id);
              return (
                <button
                  key={a.id}
                  data-testid={`avatar-${a.id}`}
                  disabled={taken}
                  className={`avatar-card ${me.avatar === a.id ? 'on' : ''} ${taken ? 'taken' : ''}`}
                  onClick={() => send((cb) => socket.emit('player:profile', { avatar: a.id as AvatarId }, cb))}
                >
                  <RobotIcon avatar={a.id} photoUrl={photoUrl} name={me.name} size={64} />
                  <span>{taken ? 'занят' : a.label}</span>
                </button>
              );
            })}
          </div>
          <button className="btn big primary" data-testid="avatar-next" onClick={() => setStep('ready')}>
            Дальше →
          </button>
        </div>
      )}

      {step === 'ready' && (
        <div className="step">
          <h2>Всё готово?</h2>
          <div className="ready-card">
            <RobotIcon avatar={me.avatar} photoUrl={photoUrl} name={me.name} size={140} />
            <NameForm
              compact
              initial={me.name}
              onSubmit={(name) => send((cb) => socket.emit('player:profile', { name }, cb))}
            />
          </div>
          <label className="comment-field">
            <span>Фраза о себе: её увидят все на экране знакомства</span>
            <input
              className="input"
              data-testid="comment-input"
              value={comment}
              maxLength={GAME_CONFIG.COMMENT_MAX_LENGTH}
              placeholder={prompt}
              onChange={(e) => {
                setComment(e.target.value);
                setCommentTouched(true);
              }}
            />
          </label>
          <div className="row">
            <button className="btn" onClick={() => setStep('photo')}>
              📷 Фото
            </button>
            <button className="btn" onClick={() => setStep('avatar')}>
              🤖 Робот
            </button>
          </div>
          <button
            className="btn huge primary"
            data-testid="ready"
            onClick={async () => {
              unlockAudio();
              if (commentTouched && !(await send((cb) => socket.emit('player:profile', { comment }, cb)))) return;
              if (await send((cb) => socket.emit('player:ready', { ready: true }, cb))) navigate(`/play/${code}`);
            }}
          >
            Я ГОТОВ!
          </button>
        </div>
      )}
    </div>
  );
}

function NameForm({ initial, onSubmit, compact }: { initial: string; onSubmit: (name: string) => void; compact?: boolean }) {
  const [name, setName] = useState(initial);
  const valid = name.trim().length > 0;
  return (
    <form
      className={compact ? 'name-form compact' : 'step'}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(name.trim());
      }}
    >
      {!compact && <h2>Введите имя</h2>}
      <input
        className="input big"
        data-testid="name-input"
        value={name}
        maxLength={GAME_CONFIG.NAME_MAX_LENGTH}
        autoFocus={!compact}
        placeholder="Ваше имя"
        onChange={(e) => setName(e.target.value)}
      />
      <button className={`btn ${compact ? '' : 'big primary'}`} data-testid="name-submit" disabled={!valid || (compact && name.trim() === initial)}>
        {compact ? 'Сохранить имя' : 'Дальше →'}
      </button>
    </form>
  );
}

function Message({ title, text, spinner }: { title: string; text: string; spinner?: boolean }) {
  return (
    <div className="phone center">
      {spinner && <div className="spinner" />}
      <h2>{title}</h2>
      <p className="hint">{text}</p>
      <Link className="btn" to="/">
        На главную
      </Link>
    </div>
  );
}
