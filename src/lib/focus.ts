import type { FocusTimerState } from "./domain";

export type FocusVisualState = "IDLE" | "RUNNING" | "PAUSED";

export type FocusControl = "start" | "pause" | "resume" | "end";

export function focusVisualState(focus: FocusTimerState): FocusVisualState {
  return focus.active?.status ?? "IDLE";
}

export function focusControls(focus: FocusTimerState): FocusControl[] {
  if (!focus.active) return ["start"];
  return focus.active.status === "RUNNING"
    ? ["pause", "end"]
    : ["resume", "end"];
}

export function elapsedFocusSeconds(
  focus: FocusTimerState,
  now: number,
): number {
  if (!focus.active) return 0;
  const live =
    focus.active.status === "RUNNING"
      ? Math.max(0, Math.floor((now - Date.parse(focus.active.measuredAt)) / 1000))
      : 0;
  return focus.active.elapsedSeconds + live;
}

export function formatFocusTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return [hours, minutes, remainder]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
