import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AVATAR_IDS, POWERUPS, type Phase, type PowerupEvent, type PowerupType, type PublicPlayer, type RoomState } from '@quiz/shared';
import { ArenaView } from '../../game/ArenaView';

/** Developer page: all power-up looks side by side, in a close-up camera (open /gallery on the host computer). */
const LOOKS: { name: string; effects: PowerupType[]; shield?: boolean; bet?: boolean; crown?: boolean }[] = [
  { name: 'Заморозка', effects: ['freeze'] },
  { name: 'Слизь', effects: ['slime'] },
  { name: 'Щит', effects: [], shield: true },
  { name: 'Бомбы', effects: ['bombs'] },
  { name: 'Время', effects: ['reduce_time'] },
  { name: 'Ставка', effects: [], bet: true },
  { name: 'Катапульта', effects: ['catapult'] },
  { name: 'Лидер', effects: [], crown: true },
];

/** A demo show: shield, slap, freeze, bet, a blocked bomb attack, slime, catapult. */
const DEMO_EVENTS: PowerupEvent[] = [
  { attackerId: 'g2', targetId: 'g2', type: 'shield', blocked: false },
  { attackerId: 'g7', targetId: 'g1', type: 'slap', blocked: false },
  { attackerId: 'g3', targetId: 'g0', type: 'freeze', blocked: false },
  { attackerId: 'g5', targetId: 'g4', type: 'bet', blocked: false },
  { attackerId: 'g1', targetId: 'g2', type: 'bombs', blocked: true },
  { attackerId: 'g0', targetId: 'g1', type: 'slime', blocked: false },
];

export function Gallery() {
  const [phase, setPhase] = useState<Phase>('QUESTION');
  const mounted = useMemo(() => Date.now(), []);

  const state: RoomState = useMemo(() => {
    const players: PublicPlayer[] = LOOKS.map((look, i) => ({
      id: `g${i}`,
      name: look.name,
      avatar: AVATAR_IDS[i % AVATAR_IDS.length],
      photoVersion: 0,
      ready: true,
      connected: true,
      isBot: false,
      score: look.crown ? 900 : 100 + i * 10,
      lastDelta: 0,
      answered: phase === 'RUNNING',
      answer: phase === 'RUNNING' && !look.effects.includes('catapult') ? i % 4 : null,
      answerMs: null,
      result: null,
      revealed: true,
      comment: null,
      effects: look.effects,
      streak: 0,
      shield: Boolean(look.shield),
      bet: Boolean(look.bet),
    }));
    return {
      roomId: 'GALLERY',
      phase,
      questionIndex: 0,
      totalQuestions: 5,
      question: { index: 0, text: 'Галерея эффектов', answers: ['A', 'B', 'C', 'D'] },
      correctAnswer: null,
      phaseStartedAt: mounted,
      phaseEndsAt: mounted + 3_600_000,
      serverNow: Date.now(),
      hostConnected: true,
      paused: false,
      pausedRemainingMs: null,
      players,
      introPlayerId: null,
      introIndex: -1,
      introTotal: 0,
      powerupsUsed: 0,
      category: null,
      categories: [],
      round: 1,
      totalRounds: 3,
      roundQuestion: 1,
      roundSize: 5,
      roundEnd: false,
      mutator: null,
      powerupEvents: phase === 'POWERUP_SHOW' ? DEMO_EVENTS : [],
    };
  }, [phase, mounted]);

  return (
    <div className="host" style={{ height: '100vh' }}>
      <div className="stage" style={{ height: '100vh' }}>
        <ArenaView state={state} closeUp />
        <div className="controls">
          <span className="hint">
            {Object.values(POWERUPS)
              .map((p) => `${p.icon} ${p.name}`)
              .join(' · ')}
          </span>
          <button className="btn" data-testid="gallery-question" onClick={() => setPhase('QUESTION')}>
            Вопрос (слизь стряхивает)
          </button>
          <button className="btn" data-testid="gallery-final" onClick={() => setPhase('FINAL')}>
            Финал (пьедестал)
          </button>
          <button className="btn" data-testid="gallery-show" onClick={() => setPhase('POWERUP_SHOW')}>
            Показ приёмов
          </button>
          <button className="btn" data-testid="gallery-running" onClick={() => setPhase('RUNNING')}>
            Бегут (катапульта)
          </button>
          <Link className="btn" to="/">
            Выход
          </Link>
        </div>
      </div>
    </div>
  );
}
