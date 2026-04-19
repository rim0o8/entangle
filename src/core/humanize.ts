import Anthropic from '@anthropic-ai/sdk';
import type { Person } from '../engram/types.ts';
import type { BroadcastProbe, Humanizer, SealedIntent } from './types.ts';

// Humanizer — the only place Entangle talks to an LLM.
// Two modes. Stub is deterministic for tests. Real uses Claude Sonnet.

export function stubHumanizer(): Humanizer {
  return {
    async renderReveal(self: SealedIntent, counterpart: SealedIntent): Promise<string> {
      return `[reveal: ${self.id} <-> ${counterpart.id}]`;
    },
    async renderProbe(probe: BroadcastProbe, candidate: Person): Promise<string> {
      return `[probe: ${probe.id} -> ${candidate.id}]`;
    },
    async renderBubbleUp(probe: BroadcastProbe, yesResponders: Person[]): Promise<string> {
      const ids = yesResponders.map((p) => p.id).join(',');
      return `[bubble-up: ${probe.id} yes=[${ids}]]`;
    },
  };
}

const MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 120;
const TEMPERATURE = 0.3;

export function realHumanizer(client: Anthropic): Humanizer {
  async function complete(prompt: string): Promise<string> {
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = r.content[0];
    if (!block || block.type !== 'text') return '';
    return block.text.trim();
  }

  return {
    async renderReveal(self, counterpart) {
      const prompt = `Two people independently sealed a private intent to work with each other. You are writing a short, warm iMessage notifying the recipient that the other person said the same thing. Keep it to one or two sentences. Do not include quotes, greetings, or names.

Self intent: ${self.payload}
Counterpart intent: ${counterpart.payload}

Message:`;
      return complete(prompt);
    },
    async renderProbe(probe, candidate) {
      const where = probe.constraints.where ? ` in ${probe.constraints.where}` : '';
      const prompt = `Write a short, quiet iMessage to ${candidate.displayName} asking if they're around${where} on ${probe.constraints.when}. Context: ${probe.payload}. One sentence. No greeting.

Message:`;
      return complete(prompt);
    },
    async renderBubbleUp(probe, yesResponders) {
      const names = yesResponders.map((p) => p.displayName).join(', ');
      const prompt = `The following people said yes to a quiet broadcast: ${names}. The probe was: "${probe.payload}". Write a one-sentence iMessage to the owner telling them who's in, and suggest connecting them. No greeting.

Message:`;
      return complete(prompt);
    },
  };
}

export function humanize(): Humanizer {
  if (process.env.HUMANIZE_STUB === '1') return stubHumanizer();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.trim() === '') {
    // No key → stub. This keeps \`bun test\` from ever hitting the network
    // even if HUMANIZE_STUB isn't explicitly set, and mirrors the CI contract.
    return stubHumanizer();
  }
  return realHumanizer(new Anthropic({ apiKey: key }));
}
