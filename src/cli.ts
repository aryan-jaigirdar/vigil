#!/usr/bin/env node
/**
 * CLI entrypoint.
 *
 *   vigil run --config vigil.yaml       start the monitor and dashboard
 *   vigil validate --config vigil.yaml  check a config file and exit
 */

import { createRequire } from 'node:module';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createLogger } from './logger.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const USAGE = `vigil ${version}, a self-hosted synthetic uptime monitor

Usage:
  vigil run [--config <path>]       start the monitor and status dashboard
  vigil validate [--config <path>]  validate a config file and exit

Options:
  -c, --config <path>  path to the YAML config file (default: vigil.yaml)
  -h, --help           show this help
  -v, --version        print the version
`;

interface CliArgs {
  command: 'run' | 'validate' | 'help' | 'version';
  configPath: string;
}

export function parseArgs(argv: string[]): CliArgs {
  let command: CliArgs['command'] | null = null;
  let configPath = 'vigil.yaml';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    switch (arg) {
      case '-h':
      case '--help':
        return { command: 'help', configPath };
      case '-v':
      case '--version':
        return { command: 'version', configPath };
      case '-c':
      case '--config': {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('-')) {
          throw new Error(`${arg} requires a path argument`);
        }
        configPath = value;
        i += 1;
        break;
      }
      case 'run':
      case 'validate':
        if (command !== null) {
          throw new Error(`unexpected extra command "${arg}"`);
        }
        command = arg;
        break;
      default:
        throw new Error(`unknown argument "${arg}"`);
    }
  }

  if (command === null) {
    throw new Error('missing command, expected "run" or "validate"');
  }
  return { command, configPath };
}

function validateCommand(configPath: string): number {
  try {
    const config = loadConfig(configPath);
    process.stdout.write(`${configPath} is valid: ${config.checks.length} checks\n`);
    for (const check of config.checks) {
      process.stdout.write(`  - ${check.name} (${check.type}, every ${check.intervalSeconds}s)\n`);
    }
    return 0;
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`config error: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

async function runCommand(configPath: string): Promise<number> {
  const log = createLogger();
  let config;
  try {
    config = loadConfig(configPath);
  } catch (err) {
    if (err instanceof ConfigError) {
      log.error(`config error: ${err.message}`);
      return 1;
    }
    throw err;
  }

  const app = createApp(config, log);
  await app.start();

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      log.warn('forced exit');
      process.exit(1);
    }
    shuttingDown = true;
    log.info(`received ${signal}, shutting down`);
    // Do not hang forever if a connection refuses to close.
    const deadline = setTimeout(() => {
      log.error('shutdown timed out, exiting');
      process.exit(1);
    }, 10_000);
    deadline.unref();
    void app.stop().then(
      () => process.exit(0),
      (err) => {
        log.error(`shutdown failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      },
    );
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  return 0;
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  switch (args.command) {
    case 'help':
      process.stdout.write(USAGE);
      return;
    case 'version':
      process.stdout.write(`${version}\n`);
      return;
    case 'validate':
      process.exitCode = validateCommand(args.configPath);
      return;
    case 'run': {
      const code = await runCommand(args.configPath);
      if (code !== 0) process.exitCode = code;
      return;
    }
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
