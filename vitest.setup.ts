// Force deterministic stub humanizer in every test; guarantees zero network
// calls to Claude during `pnpm test`.
process.env.HUMANIZE_STUB = '1';
