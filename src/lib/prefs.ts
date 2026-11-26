import { readString, writeString } from "./storage";

export const ONBOARDING_SEEN_KEY = "onboarding_seen";

export function hasSeenOnboarding(): boolean {
  return readString(ONBOARDING_SEEN_KEY) === "1";
}

export function markOnboardingSeen(): void {
  writeString(ONBOARDING_SEEN_KEY, "1");
}
