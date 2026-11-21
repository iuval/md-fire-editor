export type Role = 'owner' | 'editor' | 'viewer'
export type Access = 'restricted' | 'link-view' | 'link-edit'

export interface Acl {
  memberIds: string[]
  roles: Record<string, Role>
  access: Access
}

export const ACCESS_LABELS: Record<Access, string> = {
  restricted: 'Privada',
  'link-view': 'Enlace de lectura',
  'link-edit': 'Enlace de escritura',
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Dueño',
  editor: 'Escritura',
  viewer: 'Lectura',
}

const RANK: Record<string, number> = { owner: 3, editor: 2, viewer: 1 }

export function roleOf(acl: Acl, uid: string | undefined): Role | null {
  if (!uid) return null
  const role = acl.roles[uid]
  return role ?? null
}

export function canReadAcl(acl: Acl, uid: string | undefined): boolean {
  if (!uid) return false
  if ((RANK[roleOf(acl, uid) ?? ''] ?? 0) >= 1) return true
  return acl.access === 'link-view' || acl.access === 'link-edit'
}

export function canWriteAcl(acl: Acl, uid: string | undefined): boolean {
  if (!uid) return false
  if ((RANK[roleOf(acl, uid) ?? ''] ?? 0) >= 2) return true
  return acl.access === 'link-edit'
}

export function isAclOwner(acl: Acl, uid: string | undefined): boolean {
  return roleOf(acl, uid) === 'owner'
}

export function aclMembers(acl: Acl): Array<{ uid: string; role: Role }> {
  return acl.memberIds.map((uid) => ({ uid, role: acl.roles[uid] ?? 'viewer' }))
}
