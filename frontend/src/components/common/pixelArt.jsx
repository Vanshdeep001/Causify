/* -------------------------------------------------------
 * pixelArt.jsx — Shared 8-bit sprites
 *
 * The git history draws Mario climbing a level; the terminal is styled as a
 * level HUD. Both need the same sprites, so they live here rather than being
 * copied — one palette, one renderer, one place to change them.
 * ------------------------------------------------------- */

import React from 'react';

/* NES-era palette. R red, S skin, N outline/brown, B blue, Y yellow. */
export const MARIO_PAL = { R: '#E52521', S: '#FCB985', N: '#5C2E00', B: '#2A6DE0', Y: '#FBD000' };

/**
 * The same sprite with the colour taken out.
 *
 * Causify's chrome is monochrome by design — the palette spends its colour on
 * file-type icons and on git state, where hue carries meaning. A full-colour
 * Mario sitting in the header outranked everything around it, including the
 * primary action next to him.
 *
 * The greys are picked by luminance, not by hue: cap and overalls stay distinct
 * because one is light and the other dark, so the silhouette survives at 16px
 * exactly as the coloured one does.
 */
export const MARIO_MONO = { R: '#F2F2F2', S: '#9A9A9A', N: '#2A2A2A', B: '#5E5E5E', Y: '#1A1A1A' };

/**
 * The same idea for the 12×16 animation frames in Output/MarioSprites.jsx,
 * whose palette uses different keys.
 *
 * Assigned by luminance so the read survives losing hue: the cap and shirt go
 * brightest because they are what identifies him at a glance, boots and hair
 * go near-black, and the overalls sit in between. Flatten these to one grey and
 * he becomes an unreadable blob — the whole silhouette is carried by the three
 * steps between them.
 */
export const MARIO_FRAME_MONO = {
  R: '#F5F5F5', // cap & shirt — the identifying shape
  B: '#5C5C5C', // overalls
  F: '#B0B0B0', // skin
  H: '#1F1F1F', // hair & boots
  Y: '#FFFFFF',
  G: '#8A8A8A',
  W: '#FFFFFF',
  K: '#0A0A0A',
};

export const MARIO_ROWS = [
  '....RRRRRRR.....',
  '...RRRRRRRRR....',
  '..RRRRRRRRRRR...',
  '..NNNSSSSNSS....',
  '.NSNSSSSSNSSS...',
  '.NSNNSSSSNNNN...',
  '.NNSSSSSSNNN....',
  '...SSSSSSSS.....',
  '..RRRBBBBRRR....',
  '.RRRRBYBBYBRRRR.',
  '.SSRBBBBBBBBSS..',
  '.SSBBBBBBBBBBSS.',
  '..BBBBB..BBBBB..',
  '..BBB......BBB..',
  '.NNNN......NNNN.',
  '.NNNN......NNNN.',
];

/* Coin — the terminal's "running" indicator. G gold, H highlight, N outline. */
export const COIN_PAL = { G: '#FBD000', H: '#FFF089', N: '#9C6A00' };
export const COIN_ROWS = [
  '..NNNN..',
  '.NGGGGN.',
  'NGGHHGGN',
  'NGHGGHGN',
  'NGHGGHGN',
  'NGGHHGGN',
  '.NGGGGN.',
  '..NNNN..',
];

/* Question block — marks the prompt gutter. */
export const BLOCK_PAL = { O: '#E39D25', D: '#8B4513', W: '#FFFFFF', N: '#3A2200' };
export const BLOCK_ROWS = [
  'NNNNNNNN',
  'NOOOOOON',
  'NOOWWOON',
  'NOOWWOON',
  'NOOOWOON',
  'NOOOWOON',
  'NOOOOOON',
  'NNNNNNNN',
];

/**
 * Render a character-grid sprite as crisp 1×1 pixel rects.
 *
 * shapeRendering="crispEdges" is what keeps the pixels hard — without it the
 * browser antialiases the rect edges and an 8-bit sprite turns to mush.
 */
export const PixelSprite = ({ rows, palette, px = 1.5, style, className }) => {
  const w = rows[0].length, h = rows.length;
  const cells = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const fill = palette[row[x]];
      if (fill) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={fill} />);
    }
  });
  return (
    <svg
      width={w * px}
      height={h * px}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      className={className}
      style={{ display: 'block', ...style }}
    >
      {cells}
    </svg>
  );
};
