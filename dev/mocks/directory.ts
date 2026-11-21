// Visual-review stub for the email directory (no Firestore).
export interface DirectoryEntry {
  uid: string
  name: string
}

const NAMES: Record<string, string> = {
  'u-owner': 'Iuval',
  'u-ana': 'Ana Rodríguez',
  'u-bruno': 'Bruno Silva',
}

export async function getProfileName(uid: string): Promise<string | null> {
  return NAMES[uid] ?? null
}

export async function lookupByEmail(email: string): Promise<DirectoryEntry | null> {
  const key = email.trim().toLowerCase()
  if (key === 'ana@example.com') return { uid: 'u-ana', name: 'Ana Rodríguez' }
  return null
}

export async function emailHash(email: string): Promise<string> {
  return email
}

export async function publishOwnDirectoryEntry(): Promise<void> {}
