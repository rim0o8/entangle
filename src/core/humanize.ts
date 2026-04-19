import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { Person } from '../engram/types.js';
import type { BroadcastProbe, Humanizer, SealedIntent } from './types.js';

const SYSTEM_PROMPT =
  'Convert this agent decision into a short natural human-facing message, under 50 tokens. Be warm but not gushing. No emojis.';

const LLM_LOG_PATH = '.entangle/llm.log';

export function logLLMCall(promptFile: string, prompt: string, response: string): void {
  const level = process.env.LOG_LEVEL ?? 'info';
  if (level === 'silent') return;

  const dir = dirname(LLM_LOG_PATH);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const entry = {
    at: new Date().toISOString(),
    promptFile,
    prompt,
    response,
  };
  try {
    appendFileSync(LLM_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // best-effort logging
  }
}

/**
 * Deterministic stub humanizer. Produces canned strings tests can assert on
 * without ever hitting the network.
 */
export function createStubHumanizer(): Humanizer {
  const renderReveal = async (intent: SealedIntent, counterpart: SealedIntent): Promise<string> => {
    return `[reveal: ${intent.ownerPersonId} ↔ ${counterpart.ownerPersonId}]`;
  };

  const renderProbe = async (probe: BroadcastProbe, candidate: Person): Promise<string> => {
    return `[probe to ${candidate.id}: ${probe.payload}]`;
  };

  const renderBubbleUp = async (
    _probe: BroadcastProbe,
    yesResponders: Person[]
  ): Promise<string> => {
    return `[bubble-up: ${yesResponders.map((p) => p.id).join(', ')}]`;
  };

  return { renderReveal, renderProbe, renderBubbleUp };
}

export interface AnthropicHumanizerOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

function buildRevealPrompt(intent: SealedIntent, counterpart: SealedIntent): string {
  return [
    `Mutual intent detected between ${intent.ownerPersonId} and ${counterpart.ownerPersonId}.`,
    `Owner (${intent.ownerPersonId}) phrasing: "${intent.payload}".`,
    `Kind: ${intent.kind}. Urgency: ${intent.urgency}.`,
    `Address the counterpart (${counterpart.ownerPersonId}). Reveal that ${intent.ownerPersonId} independently said the same. Invite opening a thread.`,
  ].join('\n');
}

function buildProbePrompt(probe: BroadcastProbe, candidate: Person): string {
  const where = probe.constraints.where ? ` in ${probe.constraints.where}` : '';
  return [
    `Quiet broadcast probe to ${candidate.displayName}.`,
    `Context: ${probe.payload}${where} ${probe.constraints.when}. No pressure.`,
    'Write a gentle, low-pressure probe.',
  ].join('\n');
}

function buildBubbleUpPrompt(probe: BroadcastProbe, yesResponders: Person[]): string {
  const names = yesResponders.map((p) => p.displayName).join(' and ');
  const where = probe.constraints.where ? ` in ${probe.constraints.where}` : '';
  return [
    'Bubble-up summary to the broadcast owner.',
    `${names} said yes to: ${probe.payload}${where} ${probe.constraints.when}.`,
    'Write a short confirmation that surfaces only the yes responders.',
  ].join('\n');
}

/**
 * LLM-backed Humanizer. Calls Anthropic Claude Sonnet at temp 0.3, max 80
 * tokens. Each call is appended to .entangle/llm.log.
 */
export function createAnthropicHumanizer(opts: AnthropicHumanizerOptions): Humanizer {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? 'claude-sonnet-4-5';
  const maxTokens = opts.maxTokens ?? 80;
  const temperature = opts.temperature ?? 0.3;

  const call = async (tag: string, prompt: string): Promise<string> => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    logLLMCall(tag, prompt, text);
    return text;
  };

  return {
    renderReveal: (intent, counterpart) => call('reveal', buildRevealPrompt(intent, counterpart)),
    renderProbe: (probe, candidate) => call('probe', buildProbePrompt(probe, candidate)),
    renderBubbleUp: (probe, yesResponders) =>
      call('bubble-up', buildBubbleUpPrompt(probe, yesResponders)),
  };
}

/**
 * Returns a Humanizer based on environment:
 *   - Stub if HUMANIZE_STUB=1 OR NODE_ENV=test OR no ANTHROPIC_API_KEY.
 *   - Anthropic otherwise.
 */
export function createHumanizerFromEnv(env: NodeJS.ProcessEnv = process.env): Humanizer {
  const forceStub = env.HUMANIZE_STUB === '1' || env.NODE_ENV === 'test';
  const apiKey = env.ANTHROPIC_API_KEY;
  if (forceStub || !apiKey) {
    return createStubHumanizer();
  }
  return createAnthropicHumanizer({ apiKey });
}
