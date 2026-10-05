import { randomInt } from 'node:crypto';
import { GAME_CONFIG } from '@quiz/shared';
import { Room, type QuestionSource } from '../game/Room';

const ALPHABET = '0123456789';

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly onChange: (room: Room) => void,
    private readonly timeScale = 1,
    private readonly questionSource?: QuestionSource,
  ) {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }

  create(): Room {
    let id = '';
    do {
      id = Array.from({ length: GAME_CONFIG.ROOM_CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    } while (this.rooms.has(id));
    const room = new Room(id, this.onChange, this.timeScale, this.questionSource);
    this.rooms.set(id, room);
    return room;
  }

  get(id: string | undefined): Room | undefined {
    if (!id) return undefined;
    return this.rooms.get(id.trim().toUpperCase());
  }

  remove(id: string) {
    const room = this.rooms.get(id);
    if (!room) return;
    room.close();
    this.rooms.delete(id);
  }

  dispose() {
    clearInterval(this.sweeper);
    for (const id of [...this.rooms.keys()]) this.remove(id);
  }

  private sweep() {
    const ttl = GAME_CONFIG.ROOM_IDLE_TTL_MINUTES * 60_000;
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (!room.hasConnections() && now - room.lastActivity > ttl) this.remove(room.id);
    }
  }
}
