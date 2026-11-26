import { isApiError } from '../api/client';

/** An error as shown to the operator: the message, plus technical details on demand. */
export interface ShownError {
  message: string;
  detail?: string;
  ref?: string;
  code?: string;
  leg?: string;
  /** HTTP status; 0 when the server could not be reached. */
  status?: number;
}

const FALLBACK = 'Something went wrong. Try again.';

export function toShownError(error: unknown, fallback = FALLBACK): ShownError {
  if (isApiError(error)) {
    return { message: error.message || fallback, detail: error.detail, ref: error.ref, code: error.code, leg: error.leg, status: error.status };
  }
  if (error instanceof Error) return { message: error.message || fallback };
  if (typeof error === 'string' && error.trim()) return { message: error };
  return { message: fallback };
}
