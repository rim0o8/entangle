import * as z from 'zod/v3';

export const IntentKindSchema = z.enum(['collaborate', 'reconnect', 'custom']);
export type IntentKind = z.infer<typeof IntentKindSchema>;

export const UrgencySchema = z.enum(['low', 'med', 'high']);
export type Urgency = z.infer<typeof UrgencySchema>;

export const IntentStateSchema = z.enum(['sealed', 'matched', 'expired', 'revealed']);
export type IntentState = z.infer<typeof IntentStateSchema>;

export const SealedIntentSchema = z.object({
  id: z.string().min(1),
  ownerPersonId: z.string().min(1),
  targetPersonId: z.string().min(1),
  kind: IntentKindSchema,
  payload: z.string().min(1),
  urgency: UrgencySchema,
  createdAt: z.date(),
  expiresAt: z.date(),
  state: IntentStateSchema,
});
export type SealedIntent = z.infer<typeof SealedIntentSchema>;

export const IntentInputSchema = z.object({
  from: z.object({ id: z.string().min(1) }).passthrough(),
  to: z.object({ id: z.string().min(1) }).passthrough(),
  payload: z.string().min(1),
  kind: IntentKindSchema,
  urgency: UrgencySchema.optional(),
  ttlMs: z.number().int().positive().optional(),
});

export const BroadcastConstraintsSchema = z.object({
  when: z.string().min(1),
  where: z.string().min(1).optional(),
});
export type BroadcastConstraints = z.infer<typeof BroadcastConstraintsSchema>;

export const BroadcastResponseSchema = z.enum(['yes', 'no', 'silent']);
export type BroadcastResponse = z.infer<typeof BroadcastResponseSchema>;

export const BroadcastProbeSchema = z.object({
  id: z.string().min(1),
  ownerPersonId: z.string().min(1),
  candidatePersonIds: z.array(z.string().min(1)),
  payload: z.string().min(1),
  constraints: BroadcastConstraintsSchema,
  createdAt: z.date(),
  responses: z.record(z.string(), BroadcastResponseSchema),
});
export type BroadcastProbe = z.infer<typeof BroadcastProbeSchema>;

export const BroadcastInputSchema = z.object({
  owner: z.object({ id: z.string().min(1) }).passthrough(),
  candidates: z.array(z.object({ id: z.string().min(1) }).passthrough()),
  payload: z.string().min(1),
  constraints: BroadcastConstraintsSchema,
});

export type EntangleEvent =
  | { type: 'sealed'; at: Date; intent: SealedIntent }
  | { type: 'mutual-detected'; at: Date; a: SealedIntent; b: SealedIntent }
  | { type: 'reveal'; at: Date; intentId: string; to: string; message: string }
  | { type: 'broadcast-started'; at: Date; probeId: string; candidateCount: number }
  | { type: 'suppressed'; at: Date; probeId: string; candidateId: string; reason: string }
  | { type: 'probed'; at: Date; probeId: string; candidateId: string; message: string }
  | { type: 'response'; at: Date; probeId: string; from: string; response: 'yes' | 'no' }
  | { type: 'bubble-up'; at: Date; probeId: string; yesResponders: string[] }
  | { type: 'thread-opened'; at: Date; participants: string[]; context: string };

export type EntangleEventType = EntangleEvent['type'];
