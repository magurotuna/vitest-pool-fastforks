/**
 * Splits NODE_OPTIONS like Node.js: options are separated by spaces, and
 * double quotes keep spaces in a value.
 */
export function splitNodeOptions(value: string): string[] {
  return [...value.matchAll(/"((?:\\.|[^"\\])*)"|(\S+)/g)].map(([, quoted, plain]) =>
    quoted !== undefined ? quoted.replace(/\\(.)/g, '$1') : plain!,
  )
}
