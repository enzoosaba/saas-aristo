"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function ScrollEffects() {
  const pathname = usePathname();
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const animations = new Set<Animation>();
    const seen = new WeakSet<Element>();
    let observer: IntersectionObserver | undefined;
    function setup() {
      observer?.disconnect();
      animations.forEach(animation => animation.cancel());
      animations.clear();
      if (preference.matches || !window.IntersectionObserver) return;
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting || seen.has(entry.target)) return;
          seen.add(entry.target);
          observer?.unobserve(entry.target);
          const animation = entry.target.animate([
            { opacity: .65, transform: "translateY(12px)" },
            { opacity: 1, transform: "translateY(0)" },
          ], { duration: 420, easing: "cubic-bezier(.2,.7,.2,1)" });
          animations.add(animation);
          animation.onfinish = () => animations.delete(animation);
        });
      }, { threshold: .12, rootMargin: "0px 0px -16px 0px" });
      document.querySelectorAll("main .study-card, main .shortcut, main .lesson-banner, main .daily-quote").forEach(element => observer?.observe(element));
    }
    setup();
    preference.addEventListener("change", setup);
    return () => { observer?.disconnect(); preference.removeEventListener("change", setup); animations.forEach(animation => animation.cancel()); };
  }, [pathname]);
  return null;
}
