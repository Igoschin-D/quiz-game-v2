import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GAME_CONFIG } from '@quiz/shared';
import { RobotIcon } from '../ui/RobotIcon';

export function Home() {
  const navigate = useNavigate();
  const [joining, setJoining] = useState(location.pathname.startsWith('/join'));
  const [code, setCode] = useState('');
  const valid = code.trim().length === GAME_CONFIG.ROOM_CODE_LENGTH;

  return (
    <div className="home">
      <div className="home-robots">
        <RobotIcon avatar="red" size={70} name="З" />
        <RobotIcon avatar="metal" size={90} name="С" />
        <RobotIcon avatar="blue" size={70} name="A" />
      </div>
      <h1 className="logo">
        Знание — сила<span>Arena</span>
      </h1>
      <p className="hint">ТВ-квиз для компании: ведущий на большом экране, игроки — с телефонов.</p>
      {!joining ? (
        <div className="home-actions">
          <Link className="btn huge primary" to="/host">
            📺 Создать игру
          </Link>
          <button className="btn huge" onClick={() => setJoining(true)}>
            📱 Подключиться
          </button>
          <Link className="btn link" to="/host?testPlayers=6">
            Тестовая игра с 6 ботами
          </Link>
        </div>
      ) : (
        <form
          className="home-actions"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) navigate(`/join/${code.trim()}`);
          }}
        >
          <input
            className="input big code"
            placeholder="Код игры"
            autoFocus
            // numeric keypad on phones
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={code}
            maxLength={GAME_CONFIG.ROOM_CODE_LENGTH}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <button className="btn huge primary" disabled={!valid}>
            Войти в игру
          </button>
          <button type="button" className="btn link" onClick={() => setJoining(false)}>
            Назад
          </button>
        </form>
      )}
    </div>
  );
}
