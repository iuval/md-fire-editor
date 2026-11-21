const CURSOR_COLORS = ['#c25e00', '#2563eb', '#059669', '#7c3aed', '#db2777', '#0891b2']

export function colorForUid(uid: string): string {
  let hash = 0
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) | 0
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length]
}
