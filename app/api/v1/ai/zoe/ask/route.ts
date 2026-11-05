import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import {
  extrairRespostaZoe,
  idDeMemoriaZoe,
  lerPayloadZoe,
  validarZoeWebhookUrl,
  ZOE_GROUPS,
} from "@/lib/ai/zoe/gateway";
import { env } from "@/lib/env";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    message: z.string().trim().min(1).max(8000),
    group_type: z.enum(ZOE_GROUPS),
    company_slug: z.enum(["dreamland", "fonte-solar"]),
    conversation_id: z.string().uuid(),
  })
  .strict();

async function saveStatus(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  status: {
    last_successful_call_at?: string;
    last_error_code:
      | "network_error"
      | "timeout"
      | "upstream_error"
      | "invalid_response"
      | "credential_unavailable"
      | null;
  },
) {
  const { error } = await admin
    .from("organization_zoe_gateway_connections")
    .update(status)
    .eq("organization_id", orgId);
  if (error) logger.warn("zoe_gateway.status_update_failed", { error: error.code });
}

export async function POST(request: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "zoe_chat" });
  if (!authz.ok) return authz.response;
  const { org, user } = authz;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success)
    return fail("validation_failed", "A mensagem ou o contexto da conversa está inválido.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });

  const limiteOrg = await checkRateLimit(`zoe-chat:org:${org.orgId}`, 40, 60);
  const limiteUsuario = await checkRateLimit(`zoe-chat:user:${org.orgId}:${user.id}`, 8, 60);
  if (!limiteOrg.allowed || !limiteUsuario.allowed) {
    return fail(
      "rate_limited",
      "A Zoe atingiu o limite temporário de consultas. Aguarde um minuto e tente novamente.",
      429,
      {
        requestId,
        headers: { "Retry-After": "60" },
      },
    );
  }

  const admin = createAdminClient();
  const { data: connection, error: configError } = await admin
    .from("organization_zoe_gateway_connections")
    .select("webhook_url, company_slug, authorization_header_encrypted")
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (configError)
    return fail("internal_error", "Não foi possível consultar a conexão da Zoe.", 500, {
      requestId,
    });
  if (!connection)
    return fail(
      "service_unavailable",
      "A Zoe ainda não foi conectada por um administrador da empresa.",
      503,
      { requestId },
    );
  if (connection.company_slug !== parsed.data.company_slug) {
    return fail(
      "validation_failed",
      "O contexto da empresa enviado não corresponde à conexão configurada.",
      422,
      { requestId },
    );
  }

  const endpoint = validarZoeWebhookUrl(connection.webhook_url);
  let authorization: string | null = null;
  try {
    authorization = await decryptWebhookSecret(admin, connection.authorization_header_encrypted);
  } catch {
    // Falha fechada; nenhum detalhe da RPC nem da credencial atravessa a API.
  }
  if (!endpoint || !authorization || !/^Bearer [A-Za-z0-9._~+/-]+=*$/.test(authorization)) {
    await saveStatus(admin, org.orgId, { last_error_code: "credential_unavailable" });
    return fail(
      "service_unavailable",
      "A configuração segura da Zoe precisa ser revisada por um administrador.",
      503,
      { requestId },
    );
  }

  const chatId = idDeMemoriaZoe(
    env.INTERNAL_SECRET,
    org.orgId,
    user.id,
    parsed.data.company_slug,
    parsed.data.conversation_id,
  );
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  let errorCode: "network_error" | "timeout" | "upstream_error" | "invalid_response" | null = null;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        company_slug: parsed.data.company_slug,
        group_type: parsed.data.group_type,
        message: parsed.data.message,
        chat_id: chatId,
      }),
    });
    if (!response.ok || response.status >= 300) {
      errorCode = "upstream_error";
      await saveStatus(admin, org.orgId, { last_error_code: errorCode });
      void audit({
        action: "ai.zoe_chat_asked",
        organizationId: org.orgId,
        actorUserId: user.id,
        resourceType: "zoe_chat",
        requestId,
        metadata: {
          company_slug: parsed.data.company_slug,
          group_type: parsed.data.group_type,
          responded: false,
          latency_ms: Date.now() - startedAt,
          error_code: errorCode,
        },
      });
      return fail(
        "upstream_unavailable",
        "O serviço da Zoe não confirmou a resposta. Verifique a conexão antes de reenviar.",
        502,
        { requestId },
      );
    }

    const payload = await lerPayloadZoe(response);
    const answer = extrairRespostaZoe(payload);
    if (!answer) {
      errorCode = "invalid_response";
      await saveStatus(admin, org.orgId, { last_error_code: errorCode });
      void audit({
        action: "ai.zoe_chat_asked",
        organizationId: org.orgId,
        actorUserId: user.id,
        resourceType: "zoe_chat",
        requestId,
        metadata: {
          company_slug: parsed.data.company_slug,
          group_type: parsed.data.group_type,
          responded: false,
          latency_ms: Date.now() - startedAt,
          error_code: errorCode,
        },
      });
      return fail(
        "upstream_unavailable",
        "A resposta recebida da Zoe veio em um formato inesperado.",
        502,
        { requestId },
      );
    }

    await saveStatus(admin, org.orgId, {
      last_successful_call_at: new Date().toISOString(),
      last_error_code: null,
    });
    void audit({
      action: "ai.zoe_chat_asked",
      organizationId: org.orgId,
      actorUserId: user.id,
      resourceType: "zoe_chat",
      requestId,
      metadata: {
        company_slug: parsed.data.company_slug,
        group_type: parsed.data.group_type,
        responded: true,
        latency_ms: Date.now() - startedAt,
        error_code: null,
      },
    });
    return ok(
      { answer, company_slug: parsed.data.company_slug, group_type: parsed.data.group_type },
      { requestId },
    );
  } catch (error) {
    errorCode = controller.signal.aborted ? "timeout" : "network_error";
    await saveStatus(admin, org.orgId, { last_error_code: errorCode });
    logger.warn("zoe_gateway.request_failed", { requestId, error_code: errorCode });
    void audit({
      action: "ai.zoe_chat_asked",
      organizationId: org.orgId,
      actorUserId: user.id,
      resourceType: "zoe_chat",
      requestId,
      metadata: {
        company_slug: parsed.data.company_slug,
        group_type: parsed.data.group_type,
        responded: false,
        latency_ms: Date.now() - startedAt,
        error_code: errorCode,
      },
    });
    return fail(
      errorCode === "timeout" ? "upstream_timeout" : "upstream_unavailable",
      errorCode === "timeout"
        ? "A Zoe demorou mais que o esperado. A pergunta não será reenviada automaticamente."
        : "Não foi possível alcançar o serviço da Zoe.",
      errorCode === "timeout" ? 504 : 502,
      { requestId },
    );
  } finally {
    clearTimeout(timer);
  }
}
