import { useEffect, useState } from "preact/hooks";

/**
 * A coarse clock for relative labels and day dividers. One minute is enough:
 * the feed's freshness is minutes, not seconds.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
