import type { IpcError, IpcErrorCode, IpcResult } from '../types/ipc';

export function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(code: IpcErrorCode, message: string, details?: unknown): IpcResult<T> {
  const error: IpcError = details === undefined ? { code, message } : { code, message, details };
  return { ok: false, error };
}

/**
 * Wraps an async handler so that any escaped exception becomes a value-shaped
 * `IpcResult` instead of a rejected `invoke` (§6.3). The original stack stays in
 * the main-process log.
 */
export async function guard<T>(
  run: () => Promise<T> | T,
  onError: (error: unknown) => IpcResult<T>,
): Promise<IpcResult<T>> {
  try {
    return ok(await run());
  } catch (error) {
    return onError(error);
  }
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
