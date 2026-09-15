"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function ScrollEffects() {
  const pathname = usePathname();
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const animations = new Set<Animation>();
    const seen = new WeakSet<Element>();
    let mutations: MutationObserver | undefined;
    let observer: IntersectionObserver | undefined;
    function setup() {
      mutations?.disconnect();
      observer?.disconnect();
      animations.forEach((animation) => animation.cancel());
      animations.clear();
      if (preference.matches || !window.IntersectionObserver) return;
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting || seen.has(entry.target)) return;
            seen.add(entry.target);
            observer?.unobserve(entry.target);
            const animation = entry.target.animate(
              [
                { opacity: 0.65, transform: "translateY(12px)" },
                { opacity: 1, transform: "translateY(0)" },
              ],
              { duration: 420, easing: "cubic-bezier(.2,.7,.2,1)" },
            );
            animations.add(animation);
            animation.onfinish = () => animations.delete(animation);
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -16px 0px" },
      );
      const observe = () =>
        document
          .querySelectorAll(
            "main .study-card, main .shortcut, main .streak-highlight, main .daily-quote",
          )
          .forEach((element) => {
            if (!seen.has(element)) observer?.observe(element);
          });
      observe();
      mutations = new MutationObserver(observe);
      const main = document.querySelector("main");
      if (main) mutations.observe(main, { childList: true, subtree: true });
    }
    setup();
    preference.addEventListener("change", setup);
    return () => {
      mutations?.disconnect();
      observer?.disconnect();
      preference.removeEventListener("change", setup);
      animations.forEach((animation) => animation.cancel());
    };
  }, [pathname]);
  return null;
}
