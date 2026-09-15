"use client";

import { useSyncExternalStore } from "react";
import { Sun, Moon } from "lucide-react";

const eventName = "aristo-theme-changed";
function applyTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
function subscribe(callback: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === "aristo-theme") {
      applyTheme(event.newValue === "light" ? "light" : "dark");
      callback();
    }
  }
  window.addEventListener(eventName, callback);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(eventName, callback); window.removeEventListener("storage", onStorage); };
}
function getTheme() { return document.documentElement.dataset.theme === "light" ? "light" : "dark"; }

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "dark");
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem("aristo-theme", next); } catch { /* The current tab can still switch themes. */ }
    window.dispatchEvent(new Event(eventName));
  }
  return <button type="button" className="theme-toggle" onClick={toggle}
    aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
    title={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}>
    <Sun size={20} className="theme-sun" aria-hidden="true"/>
    <Moon size={20} className="theme-moon" aria-hidden="true"/>
  </button>;
}
