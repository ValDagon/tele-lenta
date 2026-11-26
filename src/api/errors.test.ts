import { describe, expect, it } from "vitest";

import { ApiError, toApiError } from "./errors";

describe("BFF error mapping", () => {
  it("reads the stable code from parameters", () => {
    expect(toApiError({ parameters: { code: "not_invited" } }).code).toBe(
      "not_invited",
    );
  });

  it("accepts a code on the error object", () => {
    expect(toApiError({ code: "rate_limited" }).code).toBe("rate_limited");
  });

  it("maps an unauthorized platform error to invalid init data", () => {
    expect(toApiError({ type: "UNAUTHORIZED" }).code).toBe(
      "init_data_invalid",
    );
  });

  it("maps a timeout to upstream_unavailable", () => {
    const timeout = new Error("timeout");
    timeout.name = "TimeoutError";
    expect(toApiError(timeout).code).toBe("upstream_unavailable");
  });

  it("fails closed for an unknown error", () => {
    expect(toApiError(new Error("boom")).code).toBe("upstream_unavailable");
  });

  it("preserves an existing ApiError", () => {
    const error = new ApiError("invalid_request");
    expect(toApiError(error)).toBe(error);
  });
});
