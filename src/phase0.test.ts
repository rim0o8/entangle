import { test, expect } from 'bun:test';

test('phase 0 scaffolding: bun test runs green on an empty suite', () => {
  expect(true).toBe(true);
});

test('phase 0 scaffolding: HUMANIZE_STUB defaults safe in test env', () => {
  // bun test is run with HUMANIZE_STUB=1 and ANTHROPIC_API_KEY blank.
  expect(process.env.HUMANIZE_STUB).toBe('1');
  expect(process.env.ANTHROPIC_API_KEY ?? '').toBe('');
});
