// supabase/functions/_shared/vnext_openai_json_schema_client.ts
//
// Minimal shared OpenAI structured-output call helper for SHIFT VNext
// Checkpoint 1. Every existing stage in this project (analyze-sketch-v2-
// envelope/index.ts, analyze-sketch-v2-envelope-topology/index.ts, etc.)
// DUPLICATES this exact shape inline rather than sharing it, per their own
// file headers ("this helper isn't currently exported from a shared
// module"). Checkpoint 1 needs the identical call twice (Pass A and Pass
// B) in the same function, so sharing it here — a NEW file, touching
// nothing existing — avoids a third copy-paste inside one file without
// reopening/refactoring any of the existing stages. This is a deliberate,
// small deviation from the pure copy-paste precedent; flagged explicitly
// in the Checkpoint 1 report's "deviations" section.
//
// LOCK: no `temperature`, no `seed`, no other sampling parameter — per
// Checkpoint 1's explicit instruction not to assume support for either.
// Every field in the request body below is required for a strict JSON
// Schema structured-output call and nothing else.
import { safeErrorVNext, type SafeErrorVNext } from "./vnext_safe_errors.ts";

export interface OpenAiJsonSchemaCallResult {
  ok: true;
  parsed: unknown;
  usage: Record<string, unknown>;
}

export interface OpenAiJsonSchemaCallFailure {
  ok: false;
  detail: SafeErrorVNext;
}

export type OpenAiJsonSchemaCallOutcome = OpenAiJsonSchemaCallResult | OpenAiJsonSchemaCallFailure;

function safeToken(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
}

export function sanitizeOpenAiProviderErrorVNext(
  status: number,
  rawBody: string,
  requestIdHeader: string | null,
): SafeErrorVNext {
  let code: string | null = null;
  let bodyRequestId: string | null = null;
  try {
    const parsed = JSON.parse(rawBody) as { error?: { code?: unknown }; request_id?: unknown };
    code = safeToken(parsed?.error?.code);
    bodyRequestId = safeToken(parsed?.request_id);
  } catch {
    // The raw body is intentionally discarded.
  }
  return safeErrorVNext({
    category: "provider",
    code: code ?? "provider_http_error",
    stage: "provider",
    message: "OpenAI request failed",
    status,
    requestId: safeToken(requestIdHeader) ?? bodyRequestId,
  });
}

export async function callOpenAiJsonSchemaVNext(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: unknown }>,
  schemaName: string,
  schema: unknown,
): Promise<OpenAiJsonSchemaCallOutcome> {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: {
          type: "json_schema",
          json_schema: { name: schemaName, strict: true, schema },
        },
      }),
    });
  } catch {
    return {
      ok: false,
      detail: safeErrorVNext({
        category: "provider",
        code: "provider_connection_error",
        stage: "provider",
        message: "OpenAI connection failed",
        status: null,
        requestId: null,
      }),
    };
  }

  if (!response.ok) {
    const errorText = await response.text();
    return {
      ok: false,
      detail: sanitizeOpenAiProviderErrorVNext(
        response.status,
        errorText,
        response.headers.get("x-request-id"),
      ),
    };
  }

  const openaiJson = await response.json();
  const rawContent = openaiJson?.choices?.[0]?.message?.content;
  if (!rawContent) {
    return {
      ok: false,
      detail: safeErrorVNext({
        category: "provider",
        code: "provider_missing_content",
        stage: "provider",
        message: "OpenAI response missing content",
        status: response.status,
        requestId: safeToken(response.headers.get("x-request-id")),
      }),
    };
  }

  try {
    const parsed = JSON.parse(rawContent);
    return { ok: true, parsed, usage: openaiJson?.usage ?? {} };
  } catch {
    return {
      ok: false,
      detail: safeErrorVNext({
        category: "provider",
        code: "provider_invalid_json",
        stage: "provider",
        message: "OpenAI response was not valid JSON",
        status: response.status,
        requestId: safeToken(response.headers.get("x-request-id")),
      }),
    };
  }
}
