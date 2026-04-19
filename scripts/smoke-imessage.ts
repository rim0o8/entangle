/**
 * scripts/smoke-imessage.ts — Phase -1 sanity check.
 *
 * Sends a single iMessage from the Spectrum project identified by
 * PHOTON_PROJECT_ID/PHOTON_API_KEY to YURI_HANDLE, then waits up to
 * 30s for an inbound reply before shutting down.
 *
 * This file is NOT part of the library. It requires a configured Photon
 * project with iMessage enabled and a real Apple ID handle. It is gated
 * behind real credentials and will throw if any are missing.
 *
 * Run:   bun run smoke:imessage
 */
import { Spectrum, text } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';

function must(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === '') {
    console.error(`smoke: missing env var ${key}`);
    process.exit(2);
  }
  return v.trim();
}

const projectId = must('PHOTON_PROJECT_ID');
const projectSecret = must('PHOTON_API_KEY');
const to = must('YURI_HANDLE');

console.log(`smoke: booting Spectrum (project=${projectId.slice(0, 8)}..., sending to ${to.slice(0, 4)}...)`);

const spectrum = await Spectrum({
  projectId,
  projectSecret,
  providers: [imessage.config({ local: false })],
});

try {
  const iMessagePlatform = imessage(spectrum);
  const space = await iMessagePlatform.space({ users: [{ id: to }] });
  await spectrum.send(space, text('entangle smoke: hello from spectrum-ts'));
  console.log('smoke: sent one iMessage; waiting up to 30s for a reply...');

  const timer = setTimeout(() => {
    console.log('smoke: no reply within 30s — exiting.');
    void spectrum.stop().then(() => process.exit(0));
  }, 30_000);

  for await (const [, message] of spectrum.messages) {
    clearTimeout(timer);
    const block = message.content;
    const preview = block.type === 'text' ? block.text : `<${block.type}>`;
    console.log(`smoke: received reply: ${preview}`);
    break;
  }

  await spectrum.stop();
  console.log('smoke: done.');
} catch (err) {
  console.error('smoke: error', err);
  try {
    await spectrum.stop();
  } catch {
    // ignore
  }
  process.exit(1);
}
