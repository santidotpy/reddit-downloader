/**
 * POST /api/extract
 *
 * Body: { text: string }  — arbitrary pasted text.
 * Detects every Reddit URL in the text, creates a job, and enqueues each URL
 * for resolution/classification at limited concurrency. Returns the job id and
 * the initial (queued) item list. The client then subscribes to
 * GET /api/jobs/[id] (SSE) for per-item progress.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { detectRedditUrls } from "@/lib/reddit";
import { createJob } from "@/lib/queue";
import { parseRedditCookies } from "@/lib/reddit-cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_URLS = 25;

const bodySchema = z.object({
  text: z.string().min(1).max(20_000),
  // Optional per-session Reddit cookies pasted in the UI. Parsed + whitelisted,
  // held only in memory for this job, never persisted or logged.
  cookies: z.string().max(64_000).optional(),
});

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "El cuerpo no es JSON válido." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "Falta el campo 'text' o es demasiado largo." },
      { status: 400 },
    );
  }

  const urls = detectRedditUrls(parsed.data.text);
  if (urls.length === 0) {
    return Response.json(
      { error: "No se detectaron URLs de Reddit en el texto." },
      { status: 422 },
    );
  }

  const cookies = parsed.data.cookies ? parseRedditCookies(parsed.data.cookies) : undefined;
  const job = createJob(
    urls.slice(0, MAX_URLS),
    cookies && Object.keys(cookies).length > 0 ? cookies : undefined,
  );

  return Response.json(
    {
      jobId: job.id,
      truncated: urls.length > MAX_URLS,
      items: job.items.map(({ id, rawUrl, status }) => ({ id, rawUrl, status })),
    },
    { status: 202 },
  );
}
