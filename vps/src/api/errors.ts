/**
 * The stable error envelope every `/v1/*` route returns:
 *
 *   { "error": { "code": "invalid_request", "message": "…" } }
 *
 * The Mini App owns the Russian copy for each code; the server sends a short
 * English diagnostic message that is safe to log but never rendered.
 */

import type { FastifyReply } from 'fastify';

export type ErrorCode =
  | 'init_data_invalid'
  | 'init_data_expired'
  | 'not_invited'
  | 'access_check_failed'
  | 'not_found'
  | 'invalid_request'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'internal_error';

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
  };
}

/** Thrown by route handlers; the app's error handler renders the envelope. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;

  constructor(code: ErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function invalidRequest(message: string): ApiError {
  return new ApiError('invalid_request', message, 400);
}

export function notFound(message: string): ApiError {
  return new ApiError('not_found', message, 404);
}

export function sendError(
  reply: FastifyReply,
  code: ErrorCode,
  message: string,
  statusCode: number,
): FastifyReply {
  const body: ErrorBody = { error: { code, message } };
  return reply.code(statusCode).type('application/json').send(body);
}
