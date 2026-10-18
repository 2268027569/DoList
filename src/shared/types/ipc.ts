/**
 * Uniform result envelope for every IPC handler (docs/ARCHITECTURE.md §6.3).
 * Errors travel as values, never as thrown exceptions across the IPC boundary.
 */
export type IpcErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IO_ERROR'
  | 'DB_ERROR'
  | 'PERMISSION_DENIED'
  | 'UNSUPPORTED'
  /** Unexpected exception: a bug, not user input. Details stay in the local log. */
  | 'INTERNAL';

export interface IpcError {
  code: IpcErrorCode;
  message: string;
  details?: unknown;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };
