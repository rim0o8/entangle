import { readFileSync, existsSync } from 'node:fs';
import pc from 'picocolors';

// runtime/tail-events.ts — reads .entangle/events.jsonl and prints it.
const path = process.argv[2] ?? '.entangle/events.jsonl';
if (!existsSync(path)) {
  console.error(`tail-events: no log at ${path}`);
  process.exit(1);
}

const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
if (lines.length === 0) {
  console.log(pc.dim('(log is empty)'));
  process.exit(0);
}

for (const line of lines) {
  try {
    const event = JSON.parse(line) as { kind: string; at: string; [k: string]: unknown };
    const stamp = pc.gray(event.at);
    const kind = colorKind(event.kind);
    const rest = formatRest(event);
    console.log(`${stamp} ${kind} ${rest}`);
  } catch (err) {
    console.log(pc.red(`parse error: ${line}`));
  }
}

function colorKind(kind: string): string {
  switch (kind) {
    case 'sealed':
      return pc.cyan(kind.padEnd(11));
    case 'matched':
      return pc.bold(pc.green(kind.padEnd(11)));
    case 'probed':
      return pc.blue(kind.padEnd(11));
    case 'suppressed':
      return pc.yellow(kind.padEnd(11));
    case 'response':
      return pc.magenta(kind.padEnd(11));
    case 'bubble-up':
      return pc.bold(pc.green(kind.padEnd(11)));
    default:
      return pc.dim(kind.padEnd(11));
  }
}

function formatRest(event: Record<string, unknown>): string {
  const skip = new Set(['kind', 'at']);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(event)) {
    if (skip.has(k)) continue;
    const val = Array.isArray(v) ? `[${(v as unknown[]).length}]` : JSON.stringify(v);
    parts.push(`${pc.dim(k)}=${val}`);
  }
  return parts.join(' ');
}
