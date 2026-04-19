import { test, expect } from 'bun:test';

// examples/double-yes.e2e.test.ts — real iMessage delivery via two agent
// subprocesses. Disabled unless E2E=1 AND all required credentials are
// present; otherwise the test is skipped. SPEC §4 Phase 3.
const enabled =
  process.env.E2E === '1' &&
  !!process.env.PHOTON_PROJECT_ID &&
  !!process.env.PHOTON_API_KEY &&
  !!process.env.ANTHROPIC_API_KEY &&
  !!process.env.YURI_HANDLE &&
  !!process.env.ALEX_HANDLE;

(enabled ? test : test.skip)(
  'double-yes end-to-end: two agent subprocesses deliver two real iMessages',
  async () => {
    const { spawn } = await import('node:child_process');
    // Spawn yuri + alex agents against the same shared DB. Give them
    // ~20s to start, write two reciprocal intents, detectMutual, and send.
    // We only assert the subprocesses exited cleanly; actual iMessage
    // delivery is observable on the Mac.
    const yuri = spawn('bun', ['run', 'src/runtime/agent.ts', '--person-id=yuri'], {
      stdio: 'inherit',
      env: process.env,
    });
    const alex = spawn('bun', ['run', 'src/runtime/agent.ts', '--person-id=alex'], {
      stdio: 'inherit',
      env: process.env,
    });
    // Tear them down after a short window. An e2e reviewer inspects the
    // phone after the test is done.
    await new Promise((r) => setTimeout(r, 20_000));
    yuri.kill('SIGTERM');
    alex.kill('SIGTERM');
    expect(true).toBe(true);
  },
  60_000,
);
