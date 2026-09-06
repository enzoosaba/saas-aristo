"use client";
import { useStudy } from "@/components/StudyProvider";
export { localDate } from "./domain";
export type { StudyItem } from "./domain";
export function useStudyItems() {
  const { data } = useStudy();
  return data.items.map((item) => {
    const record = data.records.find(
      (r) =>
        r.itemId === item.id && (item.kind === "task" || r.date === data.today),
    );
    return { ...item, value: record?.value || 0, done: record?.done || false };
  });
}
