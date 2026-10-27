import { useCallback, useRef, useState } from "react";

/**
 * A setting that saves as soon as it changes. A failed save puts the last saved value back and
 * rejects, unless a newer change has replaced it; the newer save then decides what is kept.
 */
export function useInstantSetting<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const saved = useRef(initial);
  const savedChange = useRef(0);
  const latestChange = useRef(0);

  /** Show a value read from the server as the saved one. */
  const load = useCallback((next: T) => {
    latestChange.current += 1;
    savedChange.current = latestChange.current;
    saved.current = next;
    setValue(next);
  }, []);

  const change = useCallback(async (next: T, save: (next: T) => Promise<unknown>) => {
    const id = ++latestChange.current;
    setValue(next);
    try {
      await save(next);
    } catch (error) {
      if (id !== latestChange.current) return;
      setValue(saved.current);
      throw error;
    }
    // Saves can finish out of order; an older one must not become the value to fall back to.
    if (id > savedChange.current) {
      savedChange.current = id;
      saved.current = next;
    }
  }, []);

  return { value, load, change };
}
