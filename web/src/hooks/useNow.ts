"use client";
import { useEffect, useState } from "react";

/** Unix seconds, ticking every second on the client. 0 during prerender. */
export function useNow(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
