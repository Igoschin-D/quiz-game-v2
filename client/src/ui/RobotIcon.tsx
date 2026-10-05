import { useId } from 'react';
import { avatarById } from '@quiz/shared';

interface Props {
  avatar: string;
  photoUrl?: string | null;
  name?: string;
  size?: number;
}

/** Flat 2D robot used on phones and in the host UI (no WebGL needed). */
export function RobotIcon({ avatar, photoUrl, name, size = 120 }: Props) {
  const s = avatarById(avatar);
  const clipId = `screen${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 100 125" role="img" aria-label={s.label}>
      <line x1="50" y1="6" x2="50" y2="18" stroke="#1b1b28" strokeWidth="3" />
      <circle cx="50" cy="6" r="5" fill={s.eye} />
      <rect x="28" y="16" width="44" height="24" rx="9" fill={s.body} />
      <rect x="33" y="24" width="34" height="9" rx="4" fill="#1b1b28" />
      <circle cx="42" cy="28.5" r="3.4" fill={s.eye} />
      <circle cx="58" cy="28.5" r="3.4" fill={s.eye} />
      <rect x="8" y="50" width="10" height="34" rx="5" fill={s.accent} />
      <rect x="82" y="50" width="10" height="34" rx="5" fill={s.accent} />
      <rect x="20" y="42" width="60" height="58" rx="14" fill={s.body} />
      <rect x="20" y="46" width="60" height="5" fill={s.accent} />
      <rect x="20" y="92" width="60" height="5" fill={s.accent} />
      <rect x="31" y="55" width="38" height="34" rx="4" fill="#1b1b28" />
      <clipPath id={clipId}>
        <rect x="33" y="57" width="34" height="30" rx="3" />
      </clipPath>
      {photoUrl ? (
        <image href={photoUrl} x="33" y="55" width="34" height="34" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId})`} />
      ) : (
        <text x="50" y="79" textAnchor="middle" fontSize="20" fontWeight="900" fill="#fff">
          {(name || '?').charAt(0).toUpperCase()}
        </text>
      )}
      <rect x="30" y="100" width="12" height="18" rx="4" fill="#1b1b28" />
      <rect x="58" y="100" width="12" height="18" rx="4" fill="#1b1b28" />
      <rect x="26" y="115" width="20" height="8" rx="3" fill={s.body} />
      <rect x="54" y="115" width="20" height="8" rx="3" fill={s.body} />
    </svg>
  );
}
