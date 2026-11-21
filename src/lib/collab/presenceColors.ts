/**
 * Presence colors, darkened until white text on them clears 4.5:1 — they are
 * painted behind 10px initials and a 10px name tag, which is small text.
 * Measured: #a84e00 5.6, #2563eb 5.3, #067a55 5.4, #7c3aed 5.7, #c21f68 5.7,
 * #0b6f88 5.8.
 */
const CURSOR_COLORS = ['#a84e00', '#2563eb', '#067a55', '#7c3aed', '#c21f68', '#0b6f88']

export function colorForUid(uid: string): string {
  let hash = 0
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) | 0
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length]
}
