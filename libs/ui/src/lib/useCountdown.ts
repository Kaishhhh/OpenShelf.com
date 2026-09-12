import { useCallback, useEffect, useRef, useState } from 'react';

export interface Countdown {
  /** Seconds remaining, counting down to 0. */
  secondsLeft: number;
  /** Starts again from the initial value (or `seconds`, if given). */
  restart: (seconds?: number) => void;
}

/**
 * A once-a-second countdown, used to hold a resend button shut until the server's
 * cooldown has elapsed.
 *
 * The deadline is kept as a timestamp rather than by decrementing a counter, so a
 * backgrounded tab — where browsers throttle timers badly — resumes showing the real
 * remaining time instead of however many ticks happened to fire.
 */
export function useCountdown(initialSeconds: number): Countdown {
  const [deadline, setDeadline] = useState(
    () => Date.now() + initialSeconds * 1000
  );
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);

  // Read inside restart without making restart change identity every render.
  const initialRef = useRef(initialSeconds);
  initialRef.current = initialSeconds;

  useEffect(() => {
    const tick = () =>
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const restart = useCallback((seconds?: number) => {
    setDeadline(Date.now() + (seconds ?? initialRef.current) * 1000);
  }, []);

  return { secondsLeft, restart };
}
