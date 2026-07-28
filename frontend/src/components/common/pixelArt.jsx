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
