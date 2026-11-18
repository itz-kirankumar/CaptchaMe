'use client';
import { useEffect, useRef } from 'react';

// Mounts the existing vanilla JS engines, in order, after the DOM is up.
// The engines are served verbatim from /public/engines - behavior unchanged.
export default function ScriptEngine({ srcs }) {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const els = [];
    (async () => {
      for (const src of srcs) {
        await new Promise((res) => {
          const s = document.createElement('script');
          s.src = src;
          s.onload = res;
          s.onerror = res;
          document.body.appendChild(s);
          els.push(s);
        });
      }
    })();
    // leaving a page also removes the admin-key box a script may have put into <main>
    return () => { els.forEach(s => s.remove()); document.querySelectorAll('.admingate').forEach(n => n.remove()); };
  }, [srcs]);
  return null;
}
