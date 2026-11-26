/**
 * Stable error codes from the BFF contract. The Mini App owns the Russian
 * copy; this module only classifies `err.parameters.code` (or a platform
 * error type) into one of the codes below.
 */

export const ERROR_CODES = [
  "init_data_invalid",
  "init_data_expired",
  "not_invited",
  "access_check_failed",
  "not_found",
  "invalid_request",
  "rate_limited",
  "upstream_unavailable",
] as const;

export type ApiErrorCode = (typeof ERROR_CODES)[number];

const knownCodes = new Set<string>(ERROR_CODES);

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && knownCodes.has(value);
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly detail: unknown;

  constructor(code: ApiErrorCode, detail?: unknown) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.detail = detail;
  }
}

interface ErrorLike {
  name?: unknown;
  type?: unknown;
  code?: unknown;
  parameters?: unknown;
}

function parameterCode(error: ErrorLike): unknown {
  const parameters = error.parameters;
  if (typeof parameters !== "object" || parameters === null) return undefined;
  return (parameters as Record<string, unknown>).code;
}

/**
 * Maps an `err` from `Telegram.WebApp.Serverless.call` (or a transport
 * failure) to a typed code. Unknown shapes fail closed as
 * `upstream_unavailable`, which has a retry path in the UI.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (typeof error === "object" && error !== null) {
    const candidate = error as ErrorLike;
    const code = parameterCode(candidate);
    if (isApiErrorCode(code)) return new ApiError(code, error);

    if (isApiErrorCode(candidate.code)) {
      return new ApiError(candidate.code, error);
    }

    if (candidate.type === "UNAUTHORIZED") {
      return new ApiError("init_data_invalid", error);
    }

    if (
      candidate.name === "TimeoutError" ||
      candidate.name === "AbortError"
    ) {
      return new ApiError("upstream_unavailable", error);
    }
  }

  return new ApiError("upstream_unavailable", error);
}
