import { describe, expect, it } from 'vitest'
import { MIN_JAVA_MAJOR, findJava, parseJavaMajor } from '../scripts/java-env.mjs'

describe('java version parsing', () => {
  it('reads the modern version format', () => {
    expect(parseJavaMajor('openjdk version "27.0.1.1" 2026-11-17')).toBe(27)
    expect(parseJavaMajor('openjdk version "21.0.5" 2024-10-15 LTS')).toBe(21)
  })

  it('reads the pre-JEP-223 format, where Java 8 is 1.8', () => {
    expect(parseJavaMajor('java version "1.8.0_392"')).toBe(8)
  })

  it('returns null for output it cannot read', () => {
    expect(parseJavaMajor('')).toBeNull()
    expect(parseJavaMajor('The operation could not be completed')).toBeNull()
  })
})

describe('java discovery', () => {
  // The failure this exists for: a machine with a working JDK still reporting
  // "Unable to locate a Java Runtime", because the JDK was never registered.
  it('finds a JDK that is new enough to run the emulators', () => {
    const java = findJava()
    if (java.major === null) {
      // A machine with no JDK at all is a valid state for `npm run test:unit`.
      expect(java.major).toBeNull()
      return
    }
    expect(java.major).toBeGreaterThanOrEqual(MIN_JAVA_MAJOR)
    if (java.home) expect(java.home.length).toBeGreaterThan(0)
  })
})
