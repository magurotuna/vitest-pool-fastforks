// A child process that does not exit on SIGTERM: process.exit() runs this
// listener, and the listener blocks.
process.on("exit", () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0))
