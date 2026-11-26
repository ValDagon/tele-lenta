/** localStorage can throw (private mode, blocked site data). Never let it. */

export function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* the value simply is not persisted */
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to do */
  }
}
