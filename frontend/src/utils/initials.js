/* Two letters always fit a circle and are enough to recognise someone.
 *
 * Shared rather than redefined per component: a person has to look identical
 * everywhere they appear — the header presence cluster, the lobby, the
 * collision hint — or the same two letters stop meaning the same person. */
export const initials = (name = '') => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export default initials;
