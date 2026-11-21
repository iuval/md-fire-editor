// Argument parsing kept separate so it can be tested without running a command.
// `--flag value` and `--flag` are both supported; --find/--replace accumulate.
export function parseArgs(argv) {
  const args = { _: [], find: [], replace: [], all: false }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--all') {
      args.all = true
      continue
    }
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        args[key] = true
        continue
      }
      i++
      if (key === 'find') args.find.push(value)
      else if (key === 'replace') args.replace.push(value)
      else args[key] = value
      continue
    }
    args._.push(token)
  }
  return args
}
