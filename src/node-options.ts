/**
 * Splits NODE_OPTIONS like Node.js (`ParseNodeOptionsEnvVar` in
 * src/node_options.cc): spaces separate the options, a double quote anywhere
 * starts or ends a part that keeps its spaces, and in that part a backslash
 * escapes the next character.
 */
export function splitNodeOptions(value: string): string[] {
  const args: string[] = []
  let quoted = false
  let newArg = true
  for (let i = 0; i < value.length; i++) {
    let c = value[i]!
    if (c === '\\' && quoted) {
      // Node.js does not start with a backslash at the end.
      if (i + 1 === value.length) break
      c = value[++i]!
    } else if (c === ' ' && !quoted) {
      newArg = true
      continue
    } else if (c === '"') {
      quoted = !quoted
      continue
    }
    if (newArg) {
      args.push(c)
      newArg = false
    } else {
      args[args.length - 1] += c
    }
  }
  return args
}
