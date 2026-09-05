import type { operations } from '../generated/monitor-api';

export type ApiJson<Op extends keyof operations> =
  operations[Op]['responses'] extends { 200: { content: { 'application/json': infer Body } } }
    ? Body
    : never;
