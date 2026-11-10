// Types shared by the main process (pool.ts), the child process (host.cts),
// and the Environment of a test file (entry.cts).

/** The options of a child process, in VITEST_POOL_FASTFORKS_HOST. */
export interface HostOptions {
  /** The path of the native addon. */
  addon: string
  /** The URL of Vitest's fork entry (dist/workers/forks.js). */
  forksUrl: string
  /** process.argv[1] of a fork. */
  argv1: string
  /** Create the Environments with an inspector (for V8 coverage). */
  inspector: boolean
  /** Measurement only: a path prefix for the CPU time of the process. */
  cpu: string | undefined
}

export type ControlType = 'ready' | 'create' | 'created' | 'free' | 'freed'

/** A message that controls the Environments of a child process. */
export interface ControlMessage {
  __fastforks_ctl: ControlType
  id?: number
  /** In 'freed': the memory of the child process after it freed the Environment. */
  rss?: number
}

/** A message of Vitest between the main process and a test file. */
export interface WorkerMessage {
  __fastforks: number
  msg: unknown
}

export interface ResolvedModule {
  url: string
  format: string | null | undefined
}

export interface LoadedModule {
  format: string
  source: string
}

/** The modules that all Environments of a child process share. */
export interface ModuleCache {
  getResolved(key: string): ResolvedModule | undefined
  setResolved(key: string, url: string, format: string | null | undefined): void
  getLoaded(url: string): LoadedModule | undefined
  setLoaded(url: string, format: string, source: string): void
}

/** What the child process puts on the global object of an Environment. */
export interface Bridge {
  /** Sends a message of Vitest to the main process. */
  post(message: unknown): void
  /** Called when Vitest's fork entry listens for messages. */
  ready(deliver: (message: unknown) => void): void
  forksUrl: string
  moduleCache: ModuleCache
}

/** The native addon (addon/fastforks.cc). */
export interface Addon {
  /** Creates an Environment and returns its id. */
  create(flags: number, args: string[], execArgs: string[]): number
  /** Runs pre-execution and an embedder main script. */
  load(id: number, source: string): unknown
  /** Calls fn(arg) inside a callback scope of the Environment. */
  call(id: number, fn: (arg: unknown) => void, arg: unknown): unknown
  /** The global object of the Environment. */
  global(id: number): Record<string, unknown>
  free(id: number): void
}
