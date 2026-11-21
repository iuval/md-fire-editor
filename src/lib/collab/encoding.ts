export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function jsonToBase64(value: unknown): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(value)))
}

export function base64ToJson<T>(base64: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64ToBytes(base64))) as T
  } catch {
    return null
  }
}
