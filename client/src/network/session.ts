const HOST_KEY = 'zsa:host';
const playerKey = (roomId: string) => `zsa:player:${roomId.toUpperCase()}`;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: session simply won't survive a reload */
  }
}

export interface HostSession {
  roomId: string;
  hostToken: string;
}

export interface PlayerSession {
  playerId: string;
  token: string;
}

export const sessions = {
  host: () => read<HostSession>(HOST_KEY),
  setHost: (s: HostSession | null) => write(HOST_KEY, s),
  player: (roomId: string) => read<PlayerSession>(playerKey(roomId)),
  setPlayer: (roomId: string, s: PlayerSession | null) => write(playerKey(roomId), s),
};
