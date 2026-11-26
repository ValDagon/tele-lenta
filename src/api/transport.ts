import type { TelegramWebApp } from "../telegram/types";
import { ApiError } from "./errors";

export type Transport = (
  name: string,
  input: Record<string, unknown>,
) => Promise<unknown>;

export const CALL_TIMEOUT_MS = 10_000;

function timeoutError(): Error {
  const error = new Error("Telegram endpoint call timed out");
  error.name = "TimeoutError";
  return error;
}

/**
 * Wraps `Telegram.WebApp.Serverless.call` in a Promise with a hard timeout.
 * The platform attaches `initData` itself, so it never appears in `input`.
 */
export function createTelegramTransport(
  webapp: TelegramWebApp | undefined,
  timeoutMs = CALL_TIMEOUT_MS,
): Transport {
  return (name, input) =>
    new Promise((resolve, reject) => {
      const serverless = webapp?.Serverless;
      if (!serverless) {
        reject(new ApiError("upstream_unavailable"));
        return;
      }

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(timeoutError());
      }, timeoutMs);

      const finish = (error: unknown, result?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      };

      try {
        serverless.call(name, input, finish);
      } catch (error) {
        finish(error);
      }
    });
}
