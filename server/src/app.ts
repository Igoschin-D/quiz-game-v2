import { existsSync } from 'node:fs';
import { createServer as createHttp, type Server as HttpServer } from 'node:http';
import { createServer as createHttps } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import selfsigned from 'selfsigned';
import { Server } from 'socket.io';
import { GAME_CONFIG } from '@quiz/shared';
import { RoomManager } from './room/RoomManager';
import { QuestionStore } from './questions/QuestionStore';
import { GameError } from './game/Room';
import { broadcast, registerHandlers, type GameServer } from './websocket/handlers';
import { lanAddresses } from './util/net';

export interface AppOptions {
  port: number;
  https?: boolean;
  timeScale?: number;
  publicUrl?: string | null;
  questionsFile?: string;
}

export interface RunningApp {
  port: number;
  close: () => Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(here, '../../client/dist');
export const DEFAULT_QUESTIONS_FILE = path.resolve(here, '../../data/questions.json');

const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Question editing is allowed only from the host computer itself (not from phones, not through a tunnel). */
function isLocalRequest(req: express.Request) {
  if (!LOCAL.has(req.socket.remoteAddress ?? '')) return false;
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (req.headers['cf-connecting-ip']) return false;
  return forwarded.every((ip) => LOCAL.has(ip));
}

async function certificate(hosts: string[]) {
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...hosts.map((ip) => ({ type: 7, ip })),
  ];
  const pems = await Promise.resolve(
    selfsigned.generate([{ name: 'commonName', value: 'znanie-sila-arena.local' }], {
      days: 30,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames }],
    }),
  );
  return { key: pems.private, cert: pems.cert };
}

export async function startApp(opts: AppOptions): Promise<RunningApp> {
  const app = express();
  let io: GameServer | null = null;
  const questions = new QuestionStore(opts.questionsFile ?? DEFAULT_QUESTIONS_FILE);
  questions.load();
  const rooms = new RoomManager((room) => io && broadcast(io, room), opts.timeScale ?? 1, () => questions.load());

  app.use('/api/questions', express.json({ limit: '1mb' }), (req, res, next) => {
    if (!isLocalRequest(req)) {
      res.status(403).json({ error: 'Редактор вопросов доступен только на компьютере ведущего' });
      return;
    }
    next();
  });
  app.get('/api/questions', (_req, res) => res.json(questions.load()));
  app.put('/api/questions', (req, res) => {
    try {
      res.json(questions.save(req.body));
    } catch (err) {
      res.status(400).json({ error: err instanceof GameError ? err.message : 'Не удалось сохранить вопросы' });
    }
  });

  app.get('/api/info', (_req, res) => {
    res.json({
      publicUrl: opts.publicUrl ?? null,
      lanIps: lanAddresses(),
      port: opts.port,
      https: Boolean(opts.https),
      config: GAME_CONFIG,
    });
  });

  app.get('/api/rooms/:roomId/photo/:playerId', (req, res) => {
    const room = rooms.get(req.params.roomId);
    const player = room?.players.get(req.params.playerId);
    if (!player?.photo) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', player.photoMime);
    res.setHeader('Cache-Control', 'no-store');
    res.end(player.photo);
  });

  if (existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST, { index: false }));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
  } else {
    app.get('/', (_req, res) =>
      res.type('text').send('Клиент не собран. В режиме разработки откройте Vite (npm run dev, порт 5173) или выполните npm run build.'),
    );
  }

  const server: HttpServer = opts.https
    ? (createHttps(await certificate(lanAddresses()), app) as unknown as HttpServer)
    : createHttp(app);

  io = new Server(server, {
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: GAME_CONFIG.PHOTO_MAX_BYTES * 2,
  }) as GameServer;
  registerHandlers(io, rooms);

  await new Promise<void>((resolve) => server.listen(opts.port, '0.0.0.0', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;

  return {
    port,
    close: async () => {
      rooms.dispose();
      await new Promise<void>((resolve) => io!.close(() => resolve()));
    },
  };
}
