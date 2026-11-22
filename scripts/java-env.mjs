#!/usr/bin/env node
/**
 * Runs a command with a JDK the Firebase emulators can use.
 *
 * `firebase-tools` needs Java >= 21 to run the Firestore and Realtime Database
 * emulators, and it looks for it the same way the OS does. macOS ships only a
 * stub at `/usr/bin/java`, and Homebrew installs `openjdk` keg-only, so a machine
 * with a perfectly good JDK still fails with "Unable to locate a Java Runtime —
 * please visit java.com", which sends you to install a second copy of what you
 * already have. This costs five minutes and one test suite that nobody runs.
 *
 * Resolution order, first usable match wins:
 *   1. `JAVA_HOME` (CI sets this, and so does anyone who already fixed it)
 *   2. `/usr/libexec/java_home -v 21` (macOS registers JVMs here)
 *   3. the Homebrew/Linux/SDKMAN locations a JDK usually lands in
 *   4. whatever `java` is on `PATH`
 *
 * Usage: node scripts/java-env.mjs <command> [args...]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MIN_JAVA_MAJOR = 21

/** "openjdk version \"27.0.1.1\"" / "java version \"1.8.0_392\"" -> 27 / 8. */
export function parseJavaMajor(output) {
  const match = /version "(\d+)(?:\.(\d+))?/.exec(String(output ?? ''))
  if (!match) return null
  const first = Number(match[1])
  // Before JEP 223 the version was "1.<major>", so 1.8.0_392 is Java 8.
  return first === 1 ? Number(match[2] ?? 0) : first
}

function javaHomeDirs() {
  const homes = []

  if (process.env.JAVA_HOME) homes.push(process.env.JAVA_HOME)

  if (existsSync('/usr/libexec/java_home')) {
    const found = spawnSync('/usr/libexec/java_home', ['-v', String(MIN_JAVA_MAJOR)], {
      encoding: 'utf8',
    })
    if (found.status === 0 && found.stdout.trim()) homes.push(found.stdout.trim())
  }

  const brew = ['/opt/homebrew/opt', '/usr/local/opt']
  for (const prefix of brew) {
    for (const keg of ['openjdk', `openjdk@${MIN_JAVA_MAJOR}`, 'openjdk@25']) {
      homes.push(join(prefix, keg, 'libexec/openjdk.jdk/Contents/Home'))
    }
  }

  // A per-user JVM directory works without sudo and is what this repo documents.
  const perUser = join(process.env.HOME ?? '', 'Library/Java/JavaVirtualMachines')
  for (const entry of safeReaddir(perUser)) {
    homes.push(join(perUser, entry, 'Contents/Home'))
  }

  for (const entry of safeReaddir(join(process.env.HOME ?? '', '.sdkman/candidates/java'))) {
    homes.push(join(process.env.HOME, '.sdkman/candidates/java', entry))
  }

  for (const base of ['/usr/lib/jvm', '/usr/java']) {
    for (const entry of safeReaddir(base)) homes.push(join(base, entry))
  }

  return [...new Set(homes.filter(Boolean))]
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function versionOf(javaBin) {
  const result = spawnSync(javaBin, ['-version'], { encoding: 'utf8' })
  if (result.status !== 0) return null
  return parseJavaMajor(`${result.stdout}${result.stderr}`)
}

/** The JDK to use, with enough detail to say why the others were skipped. */
export function findJava() {
  const skipped = []

  for (const home of javaHomeDirs()) {
    const javaBin = join(home, 'bin', 'java')
    if (!existsSync(javaBin)) continue
    const major = versionOf(javaBin)
    if (major === null) continue
    if (major < MIN_JAVA_MAJOR) {
      skipped.push(`${home} (Java ${major})`)
      continue
    }
    return { home, major, skipped, fromPath: false }
  }

  // Last resort: a `java` that is already on PATH and new enough.
  const onPath = spawnSync('java', ['-version'], { encoding: 'utf8' })
  if (onPath.status === 0) {
    const major = parseJavaMajor(`${onPath.stdout}${onPath.stderr}`)
    if (major !== null && major >= MIN_JAVA_MAJOR) return { home: null, major, skipped, fromPath: true }
    if (major !== null) skipped.push(`java on PATH (Java ${major})`)
  }

  return { home: null, major: null, skipped, fromPath: false }
}

const HINT = `Los emuladores de Firestore necesitan Java ${MIN_JAVA_MAJOR} o superior.

  macOS:   brew install openjdk
           ln -sfn /opt/homebrew/opt/openjdk/libexec/openjdk.jdk \\
             ~/Library/Java/JavaVirtualMachines/openjdk.jdk
  Debian:  sudo apt-get install openjdk-${MIN_JAVA_MAJOR}-jre-headless
  o bien:  export JAVA_HOME=/ruta/al/jdk`

function main(argv) {
  const [command, ...args] = argv
  if (!command) {
    process.stderr.write(`uso: node scripts/java-env.mjs <comando> [args...]\n\n${HINT}\n`)
    return 2
  }

  const java = findJava()
  if (java.major === null) {
    const seen = java.skipped.length > 0 ? `\nIgnorados: ${java.skipped.join(', ')}` : ''
    process.stderr.write(`${HINT}${seen}\n`)
    return 1
  }

  const env = { ...process.env }
  if (java.home) {
    env.JAVA_HOME = java.home
    env.PATH = `${join(java.home, 'bin')}:${env.PATH ?? ''}`
  }

  const result = spawnSync(command, args, { stdio: 'inherit', env })
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`)
    return 1
  }
  return result.status ?? 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main(process.argv.slice(2)))
}
