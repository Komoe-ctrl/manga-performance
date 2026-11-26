"use client";

import { useEffect, useRef, useState } from "react";
import { COUNT_UP_MS, countUpAt, parseCountUp } from "@/lib/utils/count-up";

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Texte qui se tape puis s'efface, phrase après phrase. Le texte complet reste lisible par les lecteurs d'écran. */
export function Typewriter({ phrases, className }: { phrases: string[]; className?: string }) {
  const [text, setText] = useState(phrases[0]);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let phrase = 0;
    let len = phrases[0].length;
    let deleting = true; // on part du texte déjà affiché (rendu serveur), qu'on efface d'abord
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = phrases[phrase];
      if (deleting) {
        len--;
        if (len <= 0) {
          deleting = false;
          phrase = (phrase + 1) % phrases.length;
          timer = setTimeout(tick, 250);
          setText("");
          return;
        }
      } else {
        len++;
        if (len >= current.length) {
          deleting = true;
          setText(current);
          timer = setTimeout(tick, 1800);
          return;
        }
      }
      setText(current.slice(0, len));
      timer = setTimeout(tick, deleting ? 35 : 75);
    };
    timer = setTimeout(tick, 2200);
    return () => clearTimeout(timer);
  }, [phrases]);

  return (
    <span className={className}>
      <span className="sr-only">{phrases.join(", ")}</span>
      <span aria-hidden="true">
        {text}
        <span className="caret ml-0.5 inline-block w-[3px] translate-y-[3px] bg-accent">&nbsp;</span>
      </span>
    </span>
  );
}

/**
 * Compteur animé au premier affichage à l'écran (« 10+ » → 0…10 puis « + »). Sans animation (mouvement réduit, texte non
 * numérique, animation terminée), c'est toujours la valeur configurée qui est affichée, jamais une valeur intermédiaire.
 */
export function CountUp({ value }: { value: string }) {
  const parsed = parseCountUp(value);
  const target = parsed?.target ?? null;
  // `null` = pas d'animation en cours : on montre la vraie valeur.
  const [animated, setAnimated] = useState<number | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || target === null || prefersReducedMotion()) return;
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const step = (now: number) => {
          const elapsed = now - start;
          if (elapsed >= COUNT_UP_MS) return setAnimated(null);
          setAnimated(countUpAt(target, elapsed));
          frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      setAnimated(null);
    };
  }, [target]);

  if (!parsed) return <span>{value}</span>;
  return (
    <span ref={ref}>
      {animated ?? parsed.target}
      {parsed.suffix}
    </span>
  );
}
