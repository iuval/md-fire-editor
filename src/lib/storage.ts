/**
 * Storage keys carried the old app name (`mdfire-…`). The app is FireMD now, so
 * the keys are `firemd-…`. Copying them once keeps what the user already had —
 * the open note, the pane layout, the sidebar width, the theme — instead of
 * dropping them on the rename.
 *
 * The old keys are left in place: they are small, and a rollback still finds
 * them. New keys always win, so this never overwrites a later preference.
 */
export function migrateLegacyKeys(storage: Storage): string[] {
  const legacy: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key && key.startsWith('mdfire')) legacy.push(key)
  }

  const moved: string[] = []
  for (const key of legacy) {
    const next = `firemd${key.slice('mdfire'.length)}`
    if (storage.getItem(next) !== null) continue
    const value = storage.getItem(key)
    if (value === null) continue
    storage.setItem(next, value)
    moved.push(next)
  }
  return moved
}
