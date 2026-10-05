import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GAME_CONFIG, POWERUPS, POWERUP_TYPES, type Notice, type PlayerPrivate, type PowerupType, type PublicPlayer, type RoomState } from '@quiz/shared';
import { request, type GameSocket } from '../../network/socket';
import { RobotIcon } from '../../ui/RobotIcon';
import { sfx } from '../../ui/sound';

export type Toast = Notice & { id: number };

export function Toasts({ items }: { items: Toast[] }) {
  if (items.length === 0) return null;
  return (
    <div className="toast-stack" data-testid="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

interface PanelProps {
  state: RoomState;
  me: PublicPlayer;
  priv: PlayerPrivate | null;
  socket: GameSocket;
  left: number | null;
}

/** POWERUPS window: choose a power-up and (for attacks and bets) a target. */
export function PowerupPanel({ state, me, priv, socket, left }: PanelProps) {
  const [picking, setPicking] = useState<PowerupType | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const owned = POWERUP_TYPES.filter((t) => (priv?.inventory[t] ?? 0) > 0);
  const others = state.players.filter((p) => p.id !== me.id);

  const use = async (type: PowerupType, targetId?: string) => {
    setPicking(null);
    const res = await request((cb) => socket.emit('player:usePowerup', { type, targetId }, cb));
    if (res.ok) sfx.powerup();
    setProblem(res.ok ? null : res.error);
  };

  const pick = (type: PowerupType) => {
    setProblem(null);
    if (POWERUPS[type].kind === 'self') void use(type);
    else setPicking(type);
  };

  const betTarget = priv?.betTargetId ? state.players.find((p) => p.id === priv.betTargetId) : null;

  return (
    <div className="play-center powerup-panel" data-testid="powerup-panel">
      <h2>⚡ Этап спецприёмов</h2>
      <p className="hint">Осталось {Math.ceil(left ?? 0)} с. Приёмы действуют на следующий вопрос.</p>

      {owned.length === 0 ? (
        <p className="hint">У вас пока нет приёмов. Их можно получить за правильные ответы.</p>
      ) : (
        <div className="powerup-list">
          {owned.map((t) => (
            <button key={t} className="powerup-btn" data-testid={`powerup-${t}`} onClick={() => pick(t)}>
              <span className="pu-icon">{POWERUPS[t].icon}</span>
              <span className="pu-body">
                <b>{POWERUPS[t].name}</b>
                <small>{POWERUPS[t].hint}</small>
              </span>
              <span className="pu-count">×{priv?.inventory[t]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="powerup-status">
        {priv?.shield && <span className="pu-chip">🛡️ Щит активен</span>}
        {priv?.betTargetId && (
          <span className="pu-chip">💰 Ставка на {priv.betTargetId === me.id ? 'себя' : betTarget?.name ?? 'игрока'}</span>
        )}
      </div>
      {problem && <p className="hint warn">{problem}</p>}

      {picking && (
        <div className="target-picker" data-testid="target-picker" role="dialog">
          <div className="target-card">
            <h3>
              {POWERUPS[picking].icon} {POWERUPS[picking].name}: выберите цель
            </h3>
            <div className="target-list">
              {POWERUPS[picking].kind === 'bet' && (
                <button className="target-row" data-testid="target-self" onClick={() => use(picking, me.id)}>
                  <span className="target-name">Я сам(а)</span>
                </button>
              )}
              {others.map((p) => (
                <button key={p.id} className="target-row" data-testid="target-row" onClick={() => use(picking, p.id)}>
                  <RobotIcon
                    avatar={p.avatar}
                    photoUrl={p.photoVersion > 0 ? `/api/rooms/${state.roomId}/photo/${p.id}?v=${p.photoVersion}` : null}
                    name={p.name}
                    size={32}
                  />
                  <span className="target-name">{p.name}</span>
                </button>
              ))}
              {others.length === 0 && <p className="hint">Больше никого нет.</p>}
            </div>
            <button className="btn" onClick={() => setPicking(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Slime: wipe it with a finger until enough of the answers is visible again. */
export function SlimeLayer({ onCleared }: { onCleared: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const done = useRef(false);

  useLayoutEffect(() => {
    const canvas = ref.current;
    const box = canvas?.parentElement;
    if (!canvas || !box) return;
    const rect = box.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.fillStyle = 'rgba(60, 200, 90, 0.94)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // drips
    ctx.fillStyle = 'rgba(30, 150, 60, 0.9)';
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * canvas.width, Math.random() * canvas.height, 8 + Math.random() * 22, 0, Math.PI * 2);
      ctx.fill();
    }

    const width = Math.max(18, Math.min(54, Math.min(canvas.width, canvas.height) * 0.1));
    let dragging = false;
    let last = { x: 0, y: 0 };
    let lastSound = 0;

    const pos = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
    };
    const cleared = () => {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let clear = 0;
      let total = 0;
      for (let i = 3; i < data.length; i += 24) {
        total++;
        if (data[i] < 40) clear++;
      }
      return total ? clear / total : 0;
    };
    const down = (e: PointerEvent) => {
      e.preventDefault();
      dragging = true;
      last = pos(e);
    };
    const move = (e: PointerEvent) => {
      if (!dragging || done.current) return;
      e.preventDefault();
      const p = pos(e);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      const now = performance.now();
      if (now - lastSound > 150) {
        lastSound = now;
        sfx.squelch();
      }
      if (cleared() >= GAME_CONFIG.SLIME_CLEAR_RATIO) {
        done.current = true;
        onCleared();
      }
    };
    const up = () => {
      dragging = false;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', up);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', up);
    };
  }, [onCleared]);

  return <canvas ref={ref} className="slime-layer" data-testid="slime" />;
}

const BOMB_SIZE = 68;

/** Bombs: a tap on any of them blows up and costs the answer. */
export function BombLayer({ onExplode }: { onExplode: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [spots, setSpots] = useState<{ x: number; y: number }[]>(() =>
    Array.from({ length: GAME_CONFIG.BOMB_COUNT }, () => ({ x: 10, y: 10 })),
  );

  useEffect(() => {
    const move = () => {
      const box = boxRef.current;
      if (!box) return;
      const w = Math.max(0, box.clientWidth - BOMB_SIZE);
      const h = Math.max(0, box.clientHeight - BOMB_SIZE);
      setSpots(Array.from({ length: GAME_CONFIG.BOMB_COUNT }, () => ({ x: Math.random() * w, y: Math.random() * h })));
    };
    move();
    const id = window.setInterval(move, 1100);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="bomb-layer" ref={boxRef} data-testid="bombs">
      {spots.map((s, i) => (
        <button
          key={i}
          className="bomb"
          data-testid="bomb"
          style={{ transform: `translate(${s.x}px, ${s.y}px)` }}
          onClick={() => {
            sfx.explosion();
            onExplode();
          }}
        >
          💣
        </button>
      ))}
    </div>
  );
}
