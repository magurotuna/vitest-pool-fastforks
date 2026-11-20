// A child process that does not exit on SIGTERM.
process.on("SIGTERM", () => {})
