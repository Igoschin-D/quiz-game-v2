import { useEffect, useRef, useState } from 'react';
import { GAME_CONFIG } from '@quiz/shared';
import { BRUSH_COLORS, BRUSH_SIZE, FILTERS, STICKERS, STICKER_SPOTS, applyFilter, squareCanvas, type FilterId } from './photoFilters';

const SIZE = GAME_CONFIG.PHOTO_SIZE_PX;

interface Props {
  onDone: (dataUrl: string) => Promise<void> | void;
  onSkip: () => void;
}

export function PhotoStep({ onDone, onSkip }: Props) {
  const [shot, setShot] = useState<HTMLCanvasElement | null>(null);
  return shot ? (
    <PhotoEditor base={shot} onRetake={() => setShot(null)} onDone={onDone} />
  ) : (
    <Camera onShot={setShot} onSkip={onSkip} />
  );
}

function Camera({ onShot, onSkip }: { onShot: (c: HTMLCanvasElement) => void; onSkip: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      return; // no live preview here: the "camera of the phone" button below does the job
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const v = videoRef.current!;
        v.srcObject = s;
        v.play().catch(() => undefined);
        setLive(true);
      })
      .catch(() => setError('Нет доступа к камере. Разрешите доступ или снимите через камеру телефона.'));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    onShot(squareCanvas(v, v.videoWidth, v.videoHeight, SIZE));
  };

  const fromFile = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      onShot(squareCanvas(img, img.naturalWidth, img.naturalHeight, SIZE));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return (
    <div className="step">
      <h2>Сделайте фото</h2>
      <div className="photo-frame">
        <video ref={videoRef} playsInline muted className={live ? 'mirror' : 'hidden'} />
        {!live && <div className="photo-placeholder">📷</div>}
      </div>
      {error && <p className="hint warn">{error}</p>}
      {live && (
        <button className="btn big primary" data-testid="take-photo" onClick={capture}>
          📸 Сфотографировать
        </button>
      )}
      <button className="btn" onClick={() => fileRef.current?.click()}>
        {live ? 'Загрузить из галереи' : '📷 Снять через камеру телефона'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="user"
        hidden
        onChange={(e) => fromFile(e.target.files?.[0])}
      />
      <button className="btn link" onClick={onSkip}>
        Пропустить
      </button>
    </div>
  );
}

function PhotoEditor({ base, onRetake, onDone }: { base: HTMLCanvasElement; onRetake: () => void; onDone: Props['onDone'] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [filter, setFilter] = useState<FilterId>('none');
  const [mirror, setMirror] = useState(true);
  const [stickers, setStickers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [color, setColor] = useState(BRUSH_COLORS[0]);
  const [strokes, setStrokes] = useState(0);
  // Drawing lives on its own layer above the filtered photo, so changing the filter keeps the drawing.
  const layer = useRef<HTMLCanvasElement | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!layer.current) {
      layer.current = document.createElement('canvas');
      layer.current.width = layer.current.height = SIZE;
    }
    const c = ref.current!;
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d')!;
    ctx.save();
    if (mirror) {
      ctx.translate(SIZE, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(base, 0, 0);
    ctx.restore();
    ctx.putImageData(applyFilter(ctx.getImageData(0, 0, SIZE, SIZE), filter), 0, 0);
    ctx.drawImage(layer.current, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    stickers.forEach((emoji, i) => {
      const [x, y, k] = STICKER_SPOTS[i % STICKER_SPOTS.length];
      ctx.font = `${Math.round(SIZE * 0.24 * k)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.fillText(emoji, x * SIZE, y * SIZE);
    });
  }, [base, filter, mirror, stickers, strokes]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * SIZE, y: ((e.clientY - rect.top) / rect.height) * SIZE };
  };
  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = layer.current!.getContext('2d')!;
    ctx.strokeStyle = color;
    ctx.lineWidth = BRUSH_SIZE;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    setStrokes((n) => n + 1);
  };

  const save = async () => {
    setSaving(true);
    try {
      await onDone(ref.current!.toDataURL('image/jpeg', 0.82));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="step">
      <h2>Украсьте фото</h2>
      <div className="photo-frame">
        <canvas
          ref={ref}
          data-testid="photo-canvas"
          style={drawing ? { touchAction: 'none', cursor: 'crosshair' } : undefined}
          onPointerDown={(e) => {
            if (!drawing) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            last.current = pos(e);
            stroke(last.current, last.current);
          }}
          onPointerMove={(e) => {
            if (!drawing || !last.current) return;
            const p = pos(e);
            stroke(last.current, p);
            last.current = p;
          }}
          onPointerUp={() => (last.current = null)}
          onPointerCancel={() => (last.current = null)}
        />
      </div>
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
        <button className={`chip ${mirror ? 'on' : ''}`} onClick={() => setMirror(!mirror)}>
          ⇋ Зеркало
        </button>
      </div>
      <div className="chips draw-tools">
        <button className={`chip ${drawing ? 'on' : ''}`} data-testid="draw-toggle" onClick={() => setDrawing(!drawing)}>
          ✏️ Рисовать
        </button>
        {drawing &&
          BRUSH_COLORS.map((c) => (
            <button
              key={c}
              aria-label={`Цвет ${c}`}
              className={`chip color ${color === c ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        {strokes > 0 && (
          <button
            className="chip"
            onClick={() => {
              layer.current?.getContext('2d')?.clearRect(0, 0, SIZE, SIZE);
              setStrokes(0);
            }}
          >
            ✕ Стереть рисунок
          </button>
        )}
      </div>
      <div className="chips stickers">
        {STICKERS.map((s) => (
          <button
            key={s}
            className="chip sticker"
            onClick={() => setStickers((list) => (list.length >= STICKER_SPOTS.length ? list : [...list, s]))}
          >
            {s}
          </button>
        ))}
        {stickers.length > 0 && (
          <button className="chip" onClick={() => setStickers([])}>
            ✕ Убрать
          </button>
        )}
      </div>
      <button className="btn big primary" data-testid="photo-done" onClick={save} disabled={saving}>
        {saving ? 'Сохраняем…' : 'Готово ✓'}
      </button>
      <button className="btn" onClick={onRetake}>
        ↺ Переснять
      </button>
    </div>
  );
}
