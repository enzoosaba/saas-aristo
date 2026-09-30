export type FocusCommand =
  | { action: "focus-start"; commandId: string; studySessionId?: string }
  | {
      action: "focus-pause" | "focus-end" | "focus-abandon";
      commandId: string;
      sessionId: string;
    }
  | {
      action: "focus-resume";
      commandId: string;
      sessionId: string;
      reason: string;
    };

type FocusDependencies = {
  transaction: <T>(work: () => Promise<T>) => Promise<T>;
  call: (
    command: "start" | "pause" | "resume" | "end" | "abandon" | "sync",
    values: string[],
  ) => Promise<void>;
};

export function focusConflictMessage(code: string, message = "") {
  if (code === "P0002")
    return "Esta ação já foi enviada com dados diferentes. Atualize a página e tente novamente.";
  if (code === "P0001")
    return message.includes("already active")
      ? "Você já tem uma sessão de foco ativa. Retome ou encerre essa sessão."
      : "O estado da sessão mudou. Atualize a página e tente novamente.";
  return null;
}

export async function executeFocusCommand(
  userId: string,
  data: FocusCommand,
  dependencies: FocusDependencies,
) {
  await dependencies.transaction(async () => {
    if (data.action === "focus-start")
      return dependencies.call("start", [data.commandId, data.studySessionId || ""]);
    if (data.action === "focus-pause")
      return dependencies.call("pause", [data.commandId, data.sessionId]);
    if (data.action === "focus-resume")
      return dependencies.call("resume", [
        data.commandId,
        data.sessionId,
        data.reason,
      ]);
    return dependencies.call(data.action === "focus-abandon" ? "abandon" : "end", [data.commandId, data.sessionId]);
  });

  // This second transaction starts only after focus_end_session committed.
  if (data.action === "focus-end")
    await dependencies.transaction(() =>
      dependencies.call("sync", [userId]),
    );
}
