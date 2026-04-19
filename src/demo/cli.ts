import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHumanizerFromEnv } from '../core/humanize.js';
import { EngramLite } from '../engram/lite.js';
import { loadSeed } from '../engram/seed.js';
import { createTestMessenger } from '../messaging/test.js';
import { type ScenarioId, createOrchestrator } from './orchestrator.js';
import { createDemoServer } from './server.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SEED_PATH = join(REPO_ROOT, 'src', 'engram', 'seed.json');

interface CliArgs {
  scenario: ScenarioId;
  port: number;
  pause: number;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    scenario: 'double-yes',
    port: Number(process.env.DEMO_WS_PORT ?? 8787),
    pause: 1500,
  };
  for (const raw of argv) {
    if (raw.startsWith('--scenario=')) {
      const value = raw.slice('--scenario='.length);
      if (value === 'double-yes' || value === 'quiet-broadcast') args.scenario = value;
    } else if (raw.startsWith('--port=')) {
      const v = Number(raw.slice('--port='.length));
      if (Number.isFinite(v) && v > 0) args.port = v;
    } else if (raw.startsWith('--pause=')) {
      const v = Number(raw.slice('--pause='.length));
      if (Number.isFinite(v) && v >= 0) args.pause = v;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tempDir = mkdtempSync(join(tmpdir(), `entangle-demo-${args.scenario}-`));
  const dbPath = join(tempDir, 'demo.sqlite');
  const engram = new EngramLite(dbPath);
  loadSeed(engram, { path: SEED_PATH, profile: 'test' });

  const messenger = createTestMessenger();
  const humanize = createHumanizerFromEnv();
  const orchestrator = createOrchestrator({
    scenario: args.scenario,
    graph: engram,
    messenger,
    humanize,
    pauseMs: args.pause,
  });

  const server = createDemoServer({ orchestrator, port: args.port });

  process.stdout.write(`Demo WS running on ws://localhost:${server.port}\n`);
  process.stdout.write(`Open http://localhost:5173/${args.scenario}\n`);

  orchestrator.onEvent((e) => {
    const label = e.type === 'entangle' ? `entangle:${e.payload.type}` : e.payload.type;
    process.stdout.write(`event ${label}\n`);
  });

  const cleanup = async (): Promise<void> => {
    try {
      await server.close();
    } catch {
      // ignore
    }
    try {
      engram.close();
    } catch {
      // ignore
    }
    rmSync(tempDir, { recursive: true, force: true });
  };

  process.on('SIGINT', () => {
    void cleanup().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void cleanup().then(() => process.exit(0));
  });

  try {
    await orchestrator.play();
  } catch (err) {
    process.stderr.write(`orchestrator error: ${String(err)}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
