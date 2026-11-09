// Node.js loads the --import modules only before a main entry point, and the
// embedder's main script of an Environment is not one. Load them like
// Node.js does: in order, resolved from the current working directory.
import { pathToFileURL } from 'node:url'

export async function importFlagModules() {
  const parentURL = pathToFileURL(`${process.cwd()}/`).href
  for (const specifier of importFlags()) {
    await import(import.meta.resolve(specifier, parentURL))
  }
}

function importFlags() {
  // NODE_OPTIONS comes before the command line, as in Node.js.
  const args = [...splitNodeOptions(process.env.NODE_OPTIONS ?? ''), ...process.execArgv]
  const result = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--import') result.push(args[++i])
    else if (args[i].startsWith('--import=')) result.push(args[i].slice('--import='.length))
  }
  return result
}

// NODE_OPTIONS separates options with spaces, and double quotes keep spaces
// in a value.
function splitNodeOptions(value) {
  return [...value.matchAll(/"((?:\\.|[^"\\])*)"|(\S+)/g)].map(([, quoted, plain]) =>
    quoted !== undefined ? quoted.replace(/\\(.)/g, '$1') : plain,
  )
}
