'use strict';
// The child process. Creates one Node.js Environment per test file with the
// addon and runs vitest's worker (init() from vitest/worker) inside it.
// Messages from the main process are routed by worker id.
// { addon, workerUrl, argv1, inspector, cpu }, set by pool.mjs.
const options = JSON.parse(process.env.VITEST_POOL_FASTFORKS_HOST);
delete process.env.VITEST_POOL_FASTFORKS_HOST;
const addon = require(options.addon);

// EnvironmentFlags: kOwnsProcessState, and kNoCreateInspector unless the
// tests need node:inspector (V8 coverage). Without kOwnsProcessState,
// process.chdir() in a test fails a CHECK and aborts this process, because
// the restored context keeps the main thread's methods.
const FLAGS = (1 << 1) | (options.inspector ? 0 : 1 << 9);
if (options.inspector) {
  // V8 shares compiled functions between the Environments through its
  // compilation cache. When each test file starts and stops precise
  // coverage, the counts of the shared functions get lost, so V8 coverage
  // differs from a fork.
  require('node:v8').setFlagsFromString('--no-compilation-cache');
}

// The Environment sees the same process.argv and process.execArgv as a fork.
const argv = [process.argv[0], options.argv1];
const execArgv = withoutSnapshotBlob(process.execArgv);

// Shared by all Environments in this process. See entry.cjs.
const moduleCache = { resolve: new Map(), load: new Map() };

const entry = require('node:path').join(__dirname, 'entry.cjs');
// The embedder main script can import only built-in modules, so it loads
// entry.cjs through the Environment's own CommonJS loader.
const LOAD = `return require('module').createRequire(${JSON.stringify(entry)})(${JSON.stringify(entry)})`;

const environments = new Map();

function create(id) {
  const sid = addon.create(FLAGS, argv, execArgv);
  const s = { sid, listeners: new Set(), queue: [] };
  addon.global(sid).__vitestPoolFastForks = {
    post: (v) => process.send({ __fastforks: id, msg: v }),
    on: (cb) => {
      s.listeners.add(cb);
      // Deliver the messages that arrived before init() listened.
      for (const m of s.queue.splice(0)) cb(m);
    },
    off: (cb) => s.listeners.delete(cb),
    teardown: () => s.listeners.clear(),
    workerUrl: options.workerUrl,
    moduleCache,
  };
  addon.load(sid, LOAD);
  environments.set(id, s);
  process.send({ __fastforks_ctl: 'created', id });
}

// Environments share the process: cwd, environment variables, and umask that
// a test file changes would stay for the next file. Put them back after each
// file, so that every file starts like a new fork.
const baseline = { cwd: process.cwd(), env: { ...process.env }, umask: process.umask() };
function restoreProcessState() {
  // Always: each Environment caches process.cwd(), so this Environment does
  // not see a chdir() in another one.
  process.chdir(baseline.cwd);
  for (const key of Object.keys(process.env)) {
    if (!Object.hasOwn(baseline.env, key)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(baseline.env)) {
    if (process.env[key] !== value) process.env[key] = value;
  }
  if (process.umask() !== baseline.umask) process.umask(baseline.umask);
}

function free(id) {
  const s = environments.get(id);
  environments.delete(id);
  if (s) {
    addon.free(s.sid);
    restoreProcessState();
  }
  process.send({ __fastforks_ctl: 'freed', id });
}

function deliver({ listeners, msg }) {
  for (const cb of listeners) cb(msg);
}

function withoutSnapshotBlob(args) {
  const result = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--snapshot-blob') i++;
    else if (!args[i].startsWith('--snapshot-blob=')) result.push(args[i]);
  }
  return result;
}

process.on('SIGTERM', () => process.exit(0));
// The main process exited without stopping this process.
process.on('disconnect', () => process.exit(0));

if (options.cpu) {
  // Measurement only: the main process does not wait for this process, so a
  // time(1) of the main process misses its CPU time.
  const prefix = options.cpu;
  process.on('exit', () => {
    const { user, system } = process.cpuUsage();
    require('node:fs').writeFileSync(`${prefix}.${process.pid}.json`, JSON.stringify({ user, system }));
  });
}

process.on('message', (m) => {
  if (m.__fastforks_ctl === 'create') create(m.id);
  else if (m.__fastforks_ctl === 'free') free(m.id);
  else if (m.__fastforks !== undefined) {
    const s = environments.get(m.__fastforks);
    if (!s) return;
    if (s.listeners.size === 0) s.queue.push(m.msg);
    // Run the listeners inside the Environment's callback scope, so that the
    // nextTick callbacks they schedule run now, not at the Environment's next
    // timer or I/O callback.
    else addon.call(s.sid, deliver, { listeners: [...s.listeners], msg: m.msg });
  }
});

process.send({ __fastforks_ctl: 'ready' });
