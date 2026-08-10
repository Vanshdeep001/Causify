/* -------------------------------------------------------
 * MarioSprites.jsx — Pixel art for the auto-fix agent
 *
 * Sprites are plain character grids rather than hand-written <rect> soup:
 * one char per pixel, one letter per colour. Editing the plumber's hat is
 * then a text edit, not an exercise in coordinate arithmetic.
 *
 * The palette borrows the app's own accents where it can — the coin gold and
 * pipe green are already --amber and --emerald — so the level reads as part
 * of this IDE rather than a sticker pasted onto it.
 * ------------------------------------------------------- */

import React from 'react';

export const PALETTE = {
  R: '#E5484D', // cap & shirt  (the app's --crimson)
  B: '#4263EB', // overalls
  F: '#F8C9A0', // skin
  H: '#6B3F23', // hair & boots
  Y: '#FFB224', // coin gold    (the app's --amber)
  G: '#3DD68C', // pipe green   (the app's --emerald)
  W: '#FFFFFF',
  K: '#0A0A0A',
};

/* ── The plumber, 12×16 ── */

export const MARIO_IDLE = [
  '....RRRR....',
  '...RRRRRRR..',
  '...HHHFFH...',
  '..HFHFFFHF..',
  '..HFHHFFFH..',
  '..HHFFFFFF..',
  '....FFFFF...',
  '...RRBRRR...',
  '..RRRBBBRRR.',
  '.RRRRBBBRRRR',
  '.FFRBBBBBRFF',
  '.FFFBBBBBFFF',
  '...BBBBBBB..',
  '..BBB...BBB.',
  '..HHH...HHH.',
  '.HHHH...HHHH',
];

export const MARIO_RUN = [
  '....RRRR....',
  '...RRRRRRR..',
  '...HHHFFH...',
  '..HFHFFFHF..',
  '..HFHHFFFH..',
  '..HHFFFFFF..',
  '....FFFFF...',
  '...RRBRRR...',
  '..RRRBBBRRR.',
  '.RRRRBBBRRRR',
  '.FFRBBBBBRFF',
  '.FFFBBBBBFFF',
  '...BBBBBBB..',
  '..BBBBBBB...',
  '.HHHHH.HH...',
  'HHHH...HHH..',
];

export const MARIO_JUMP = [
  '....RRRR....',
  '...RRRRRRR..',
  '...HHHFFH...',
  '..HFHFFFHF..',
  '..HFHHFFFH..',
  '..HHFFFFFF..',
  'R...FFFFF..R',
  'RR.RRBRRR.RR',
  '.RRRRBBBRRR.',
  '..RRRBBBRRR.',
  '..FFBBBBBFF.',
  '...FBBBBBF..',
  '...BBB.BBB..',
  '..BBB...BBB.',
  '.HHH.....HHH',
  'HHHH.....HHH',
];

/* ── A Goomba, for attempts that didn't make it, 12×12 ── */

export const GOOMBA = [
  '...HHHHHH...',
  '..HHHHHHHH..',
  '.HHHHHHHHHH.',
  'HHWWHHHHWWHH',
  'HHWKHHHHKWHH',
  'HHWKHHHHKWHH',
  'HHHHHHHHHHHH',
  '.HHHHHHHHHH.',
  '..HHHHHHHH..',
  '...FFFFFF...',
  '..FFF..FFF..',
  '.FFF....FFF.',
];

/**
 * Renders a character grid as crisp pixels.
 *
 * shapeRendering="crispEdges" is what keeps it pixel art — without it the
 * browser antialiases every rect and the whole thing turns to mush at small
 * sizes.
 */
export const PixelSprite = ({ rows, px = 2, palette = PALETTE, className, style, flip = false }) => {
  const w = rows[0].length;
  const h = rows.length;

  return (
    <svg
      className={className}
      style={{ ...style, transform: flip ? 'scaleX(-1)' : undefined }}
      width={w * px}
      height={h * px}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {rows.map((row, y) =>
        row.split('').map((ch, x) => {
          const fill = palette[ch];
          if (!fill) return null; // '.' is transparent
          return <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={fill} />;
        })
      )}
    </svg>
  );
};

/** A ? block that turns solid once bumped. */
export const QuestionBlock = ({ hit, px = 2 }) => (
  <svg
    className={`afx-block ${hit ? 'is-hit' : ''}`}
    width={16 * px}
    height={16 * px}
    viewBox="0 0 16 16"
    shapeRendering="crispEdges"
    aria-hidden="true"
  >
    <rect x="0" y="0" width="16" height="16" fill={hit ? '#6B4A2A' : '#E39B1F'} />
    <rect x="1" y="1" width="14" height="14" fill={hit ? '#8A6236' : '#FFB224'} />
    {/* rivets */}
    {[[2, 2], [13, 2], [2, 13], [13, 13]].map(([x, y]) => (
      <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#5A3A18" />
    ))}
    {!hit && (
      <g fill="#7A4B12">
        <rect x="6" y="4" width="4" height="1" />
        <rect x="5" y="5" width="2" height="1" />
        <rect x="9" y="5" width="2" height="1" />
        <rect x="8" y="6" width="2" height="2" />
        <rect x="7" y="8" width="2" height="1" />
        <rect x="7" y="10" width="2" height="2" />
      </g>
    )}
  </svg>
);

/** The flagpole — the whole point of the level. */
export const Flagpole = ({ raised, px = 2 }) => (
  <svg width={16 * px} height={40 * px} viewBox="0 0 16 40" shapeRendering="crispEdges" aria-hidden="true">
    <rect x="7" y="0" width="2" height="38" fill="#B8B8B8" />
    <rect x="6" y="0" width="4" height="2" fill="#3DD68C" />
    <g className={`afx-flag ${raised ? 'is-raised' : ''}`}>
      <rect x="2" y="4" width="5" height="5" fill="#3DD68C" />
      <rect x="1" y="5" width="1" height="3" fill="#3DD68C" />
    </g>
    <rect x="4" y="38" width="8" height="2" fill="#6B3F23" />
  </svg>
);

/** A coin, for the confidence meter and the block-bump pop. */
export const Coin = ({ px = 2, dim = false }) => (
  <svg width={8 * px} height={8 * px} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true">
    <rect x="2" y="0" width="4" height="8" fill={dim ? '#3A3A3A' : '#FFB224'} />
    <rect x="1" y="1" width="6" height="6" fill={dim ? '#3A3A3A' : '#FFB224'} />
    <rect x="0" y="2" width="8" height="4" fill={dim ? '#3A3A3A' : '#FFB224'} />
    <rect x="3" y="2" width="2" height="4" fill={dim ? '#2A2A2A' : '#C77E10'} />
  </svg>
);
