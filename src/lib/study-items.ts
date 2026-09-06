"use client";

import { useMemo, useSyncExternalStore } from "react";

export type StudyItem = {
  id: string;
  kind: "habit" | "task";
  title: string;
  notes: string;
  frequency: string;
  measure: "check" | "count";
  target: number;
  unit: string;
  value: number;
  date: string;
  time: string;
  priority: string;
  done: boolean;
};
const key = "coelho-study-items";
const event = "coelho-study-items-changed";
function snapshot() { try { return localStorage.getItem(key) || "[]"; } catch { return "[]"; } }
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(event, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(event, callback); };
}
function parse(raw: string): StudyItem[] {
  try {
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? data.filter((item): item is StudyItem =>
      item && typeof item.id === "string" && typeof item.title === "string" &&
      (item.kind === "habit" || item.kind === "task") &&
      (item.measure === "check" || item.measure === "count") &&
      typeof item.target === "number" && Number.isFinite(item.target) && item.target >= 1 &&
      typeof item.value === "number" && Number.isFinite(item.value) && typeof item.done === "boolean" &&
      ["notes", "frequency", "unit", "date", "time", "priority"].every(field => typeof item[field] === "string")
    ) : [];
  } catch { return []; }
}
export function useStudyItems() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  return useMemo(() => parse(raw), [raw]);
}
export function saveStudyItem(item: StudyItem) {
  const items = parse(snapshot());
  const existing = items.some(entry => entry.id === item.id);
  localStorage.setItem(key, JSON.stringify(existing ? items.map(entry => entry.id === item.id ? item : entry) : [...items, item]));
  window.dispatchEvent(new Event(event));
}
export function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}
