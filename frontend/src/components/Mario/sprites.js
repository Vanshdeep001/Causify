/* -------------------------------------------------------
 * sprites.js — the companion's own pixel art, drawn for monochrome
 *
 * The frames in Output/MarioSprites.jsx were drawn for colour: a red cap, blue
 * overalls, and no outline, because on a bright NES background hue does all the
 * separating. Desaturate them and the character collapses — every shape becomes
 * a similar grey against a dark editor, and what is left reads as a smudge.
 *
 * These are drawn the other way round: dark background, no colour at all.
 *
 * ── The three rules that make it work ──
 *
 * 1. A hard black outline on every silhouette edge. Colour art can skip this;
 *    monochrome cannot, because the outline is the only thing guaranteeing the
 *    figure separates from whatever is behind it.
 *
 * 2. Regions that share a colour in the original share a value here. The cap
 *    and the shirt are both red, so they are both L — splitting them invents a
 *    distinction the character does not have and reads as armour plating.
 *
 * 3. The FACE is the lightest thing on him. Faces are where people look, and
 *    the brightest value is what pulls the eye there. Making the cap brightest
 *    instead — the obvious move, since it is white in a lot of art — turns him
 *    into a slab with a dark hole under it.
 *
 * 16×20 at px=4 is 64×80 on screen: big enough for the eyes, the moustache and
 * the overall buttons to actually resolve, which is what separates a character
 * from a smudge that happens to be person-shaped.
 * ------------------------------------------------------- */

/**
 * Four values and transparent. Deliberately few and widely spaced — a
 * monochrome sprite dies from having six greys that all look alike, not from
 * having too few.
 */
export const AGENT_PAL = {
  K: '#0A0A0A', // outline, hair, moustache, boots
  L: '#B4B4B4', // cap and shirt (one red in the original, so one value here)
  W: '#F5F5F5', // skin — the lightest, so the face is where the eye lands
  D: '#3A3A3A', // overalls
};

/* The cap: a rounded crown and a brim that overhangs it by one column each
   side, with a dark underside. The brim is what makes a cap read as a cap, but
   run it the full width and it becomes a horizontal slab that outweighs
   everything below it. */
const CAP = [
  '.....KKKKKK.....',
  '....KLLLLLLK....',
  '...KLLLLLLLLK...',
  '.KKLLLLLLLLLLKK.',
  '.KKKKKKKKKKKKKK.',
];

/* The face is ten columns of the lightest value, held by a single-pixel
   outline. An earlier draft framed it with two columns of black on each side
   as "hair" — at this size that is a quarter of the head, and it read as a
   face peering out of a box rather than as a face.
 *
 * Eyes are two rows tall so that dropping the upper row reads as a lid closing
 * rather than as the eyes blinking out of existence. */
const FACE_OPEN = [
  '..KWWWWWWWWWWK..',
  '..KWWKWWWWKWWK..',
  '..KWWKWWWWKWWK..',
  '..KWWWWWWWWWWK..',
];
const FACE_SHUT = [
  '..KWWWWWWWWWWK..',
  '..KWWWWWWWWWWK..',
  '..KWWKWWWWKWWK..',
  '..KWWWWWWWWWWK..',
];

/* The moustache carries more recognition than any other feature here, so it
   gets a full six columns — but with a lit pixel either side, so it reads as
   sitting ON the face rather than cutting the head in half. */
const JAW = [
  '..KKWKKKKKKWKK..',
  '...KWWWWWWWWK...',
];

/* Arms down at the sides, overalls with two buttons, hands at the ends.
 *
 * The arms run straight down out of the shoulder line with no outline between
 * them and the body. An earlier draft boxed each sleeve in its own outline —
 * `.KLLKDD…DDKLLK.` — and the result was two grey squares floating either side
 * of him rather than arms, because a hard black edge on the INSIDE of a limb
 * reads as a gap. Outlines belong on the silhouette, not within it. */
const TORSO = [
  '..KLLLLLLLLLLK..',
  '.KLLLDLDDLDLLLK.',
  '.KLLLDDDDDDLLLK.',
  '.KWWWDDDDDDWWWK.',
  '..KKKDDDDDDKKK..',
];

const LEGS_STAND = [
  '....KDDDDDDK....',
  '....KDDKKDDK....',
  '...KKKK..KKKK...',
  '...KKKK..KKKK...',
];

/* One leg carried forward. Paired with LEGS_STAND this is a two-frame walk —
   the minimum that reads as walking rather than as juddering. */
const LEGS_STEP = [
  '...KDDDDDDK.....',
  '..KDDKKDDK......',
  '.KKKK..KKKK.....',
  '.KKKK..KKKK.....',
];

/* Legs apart, for the hop. */
const LEGS_AIR = [
  '...KDDDDDDDDK...',
  '..KDDK....KDDK..',
  '.KKKK......KKKK.',
  '.KKKK......KKKK.',
];

const build = (face, legs) => [...CAP, ...face, ...JAW, ...TORSO, ...legs];

export const AGENT_IDLE  = build(FACE_OPEN, LEGS_STAND);
export const AGENT_BLINK = build(FACE_SHUT, LEGS_STAND);
export const AGENT_WALK  = build(FACE_OPEN, LEGS_STEP);
export const AGENT_JUMP  = build(FACE_OPEN, LEGS_AIR);

export const AGENT_COLS = 16;
export const AGENT_ROWS = 20;
