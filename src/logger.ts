/**
 * Minimal leveled logger. Kept as an interface so modules can be exercised
 * in tests without writing to the real console.
 */

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

function line(level: string, message: string): string {
  return `${new Date().toISOString()} ${level.padEnd(5)} ${message}`;
}

export function createLogger(): Logger {
  return {
    info(message) {
      process.stdout.write(`${line('INFO', message)}\n`);
    },
    warn(message) {
      process.stderr.write(`${line('WARN', message)}\n`);
    },
    error(message) {
      process.stderr.write(`${line('ERROR', message)}\n`);
    },
  };
}

/** Logger that discards everything. Useful in tests. */
export const nullLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};
