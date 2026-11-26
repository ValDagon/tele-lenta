import { toApiError, type ApiErrorCode } from "../api/errors";
import type { SessionResponse } from "../api/types";

export type GateStatus =
  | { kind: "checking" }
  | { kind: "outside" }
  | { kind: "invited" }
  | { kind: "error"; code: ApiErrorCode }
  | { kind: "allowed"; session: SessionResponse };

/**
 * A denied user is not an error: it is the invite-only screen. An invalid or
 * expired initData means the page is not usable outside Telegram, so it gets
 * the same "open from Telegram" message as an empty session.
 */
export function gateStatusForError(error: unknown): GateStatus {
  const apiError = toApiError(error);
  if (apiError.code === "not_invited") return { kind: "invited" };
  if (
    apiError.code === "init_data_invalid" ||
    apiError.code === "init_data_expired"
  ) {
    return { kind: "outside" };
  }
  return { kind: "error", code: apiError.code };
}
