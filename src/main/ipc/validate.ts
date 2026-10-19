import { fail } from '@shared/contracts/result';
import type { IpcResult } from '@shared/types/ipc';

import { createLogger } from '../logger';

const log = createLogger('ipc');

/**
 * Turns a rejected payload into the value-shaped error every handler returns
 * (§6.3). Shared by the registrator and the per-domain handler modules so the
 * shape and the log line stay identical whatever rejected the payload.
 */
export function invalid(channel: string, details: unknown): IpcResult<never> {
  log('payload rejected', channel, details);
  return fail('VALIDATION_FAILED', `Invalid payload for ${channel}`, details);
}
