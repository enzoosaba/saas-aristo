import { z } from "zod";
import { requireUser } from "@/server/auth";
import { body, failure, HttpError, json, limit } from "@/server/http";
import {
  roster,
  dailySummary,
  addStudent,
  removeStudent,
} from "@/server/mentor";
import { localDate } from "@/lib/domain";
import type { User } from "@/lib/domain";
import { dateSchema } from "@/server/validation";
export const runtime = "nodejs";
function requireMentor(user: User) {
  if (user.role !== "mentor")
    throw new HttpError(403, "Área exclusiva para mentores.");
  return user;
}
export async function GET(request: Request) {
  try {
    const user = requireMentor(await requireUser());
    const url = new URL(request.url);
    const studentId = url.searchParams.get("student");
    if (!studentId) return json({ students: await roster(user.id) });
    const dateParam = url.searchParams.get("date");
    const date = dateParam ? dateSchema.parse(dateParam) : localDate();
    if (date > localDate())
      throw new HttpError(400, "Selecione uma data até hoje.");
    return json(await dailySummary(user.id, studentId, date));
  } catch (e) {
    return failure(e);
  }
}
const mentorMutation = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("add-student"),
      email: z.string().trim().toLowerCase().email().max(254),
    })
    .strict(),
  z
    .object({
      action: z.literal("remove-student"),
      studentId: z.string().min(1).max(100),
    })
    .strict(),
]);
export async function POST(request: Request) {
  try {
    const user = requireMentor(await requireUser());
    await limit("mentor:" + user.id, 60);
    const data = mentorMutation.parse(await body(request));
    if (data.action === "add-student") await addStudent(user.id, data.email);
    else await removeStudent(user.id, data.studentId);
    return json({ students: await roster(user.id) });
  } catch (e) {
    return failure(e);
  }
}
