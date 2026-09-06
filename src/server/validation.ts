import { z } from "zod";
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T12:00:00Z");
    return !isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s;
  }, "Data inválida");
export const itemSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(["habit", "task"]),
    title: z.string().trim().min(1).max(100),
    notes: z.string().trim().max(500),
    frequency: z.enum(["Todos os dias", "Segunda a sexta", "Fins de semana"]),
    measure: z.enum(["check", "count"]),
    target: z.number().int().min(1).max(100000),
    unit: z.string().trim().max(30),
    date: dateSchema,
    time: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/),
    priority: z.enum(["Normal", "Alta", "Baixa"]),
    value: z.number().int().min(0).max(100000),
    done: z.boolean(),
    version: z.number().int().min(1).optional(),
  })
  .strict()
  .refine(
    (i) => i.measure !== "count" || i.unit.length > 0,
    "Informe a unidade",
  )
  .refine(
    (i) => i.kind !== "task" || i.measure === "check",
    "Tarefa deve ser checklist",
  );
export const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save-item"), item: itemSchema }).strict(),
  z
    .object({
      action: z.literal("archive-item"),
      id: z.string().uuid(),
      version: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("record"),
      id: z.string().uuid(),
      date: dateSchema,
      value: z.number().int().min(0).max(100000),
      done: z.boolean(),
      version: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      action: z.literal("save-plan"),
      date: dateSchema,
      prioridades: z.string().max(4000),
      horarios: z.string().max(4000),
      observacoes: z.string().max(4000),
      version: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      action: z.literal("profile"),
      name: z.string().trim().min(2).max(80),
    })
    .strict(),
]);
