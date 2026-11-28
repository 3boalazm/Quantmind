import "server-only";
import { fail } from "./api";

/**
 * The check every cron route starts with. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`;
 * without CRON_SECRET in the environment the route stays closed. Returns a refusal, or null to go on.
 */
export function cronRefusal(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail(503, "CRON_SECRET is not set");
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  let mismatch = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) mismatch |= (given.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  return mismatch === 0 ? null : fail(401, "unauthorized");
}
