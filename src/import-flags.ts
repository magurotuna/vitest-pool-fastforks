// Node.js loads the --import modules only before a main entry point, and the
// embedder's main script of an Environment is not one. Load them like
// Node.js does: in order, resolved from the current working directory.
import { pathToFileURL } from 'node:url'
import { splitNodeOptions } from './node-options.ts'

export async function importFlagModules(): Promise<void> {
  const parentURL = pathToFileURL(`${process.cwd()}/`).href
  for (const specifier of importFlags(process.env.NODE_OPTIONS ?? '', process.execArgv)) {
    await import(import.meta.resolve(specifier, parentURL))
  }
}

/** The values of --import, NODE_OPTIONS first, as in Node.js. */
export function importFlags(nodeOptions: string, execArgv: string[]): string[] {
  const args = [...splitNodeOptions(nodeOptions), ...execArgv]
  const result: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--import' && i + 1 < args.length) result.push(args[++i]!)
    else if (arg.startsWith('--import=')) result.push(arg.slice('--import='.length))
  }
  return result
}
