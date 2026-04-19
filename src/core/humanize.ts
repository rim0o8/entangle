import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

export type Humanizer = (prompt: string) => Promise<string>;

const SYSTEM_PROMPT =
  'Convert this agent decision into a short natural human-facing message, under 50 tokens. Be warm but not gushing. No emojis.';

export interface AnthropicHumanizerOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export function createAnthropicHumanizer(opts: AnthropicHumanizerOptions): Humanizer {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? 'claude-sonnet-4-5';
  const maxTokens = opts.maxTokens ?? 80;
  const temperature = opts.temperature ?? 0.3;

  return async (prompt: string): Promise<string> => {
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
    logLLMCall('humanize', prompt, text);
    return text;
  };
}

export function createStubHumanizer(fn?: (prompt: string) => string): Humanizer {
  return async (prompt: string): Promise<string> => {
    const result = fn
      ? fn(prompt)
      : (prompt
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .slice(-1)[0] ?? prompt.trim());
    logLLMCall('humanize-stub', prompt, result);
    return result;
  };
}

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
