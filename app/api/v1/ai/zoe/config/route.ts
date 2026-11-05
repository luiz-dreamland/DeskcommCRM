import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { ZOE_COMPANIES, validarZoeWebhookUrl } from "@/lib/ai/zoe/gateway";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, organization_id, webhook_url, company_slug, authorization_header_encrypted, last_successful_call_at, last_error_code, created_at, updated_at";
const salvarSchema = z
  .object({
    webhook_url: z.string().trim().min(1).max(500),
    company_slug: z.enum(ZOE_COMPANIES),
    authorization_header: z.string().trim().max(2048).optional().default(""),
  })
  .strict();

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "zoe_gateway" });
  if (!authz.ok) return authz.response;
  const { data, error } = await createAdminClient()
    .from("organization_zoe_gateway_connections")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (error)
    return fail("internal_error", "Não foi possível consultar a conexão da Zoe.", 500, {
      requestId,
    });
  if (!data)
    return ok(
      {
        configured: false,
        has_secret: false,
        webhook_url: "",
        company_slug: "dreamland",
        last_successful_call_at: null,
        last_error_code: null,
        updated_at: null,
      },
      { requestId },
    );
  return ok(
    {
      configured: true,
      has_secret: Boolean(data.authorization_header_encrypted),
      webhook_url: data.webhook_url,
      company_slug: data.company_slug,
      last_successful_call_at: data.last_successful_call_at,
      last_error_code: data.last_error_code,
      updated_at: data.updated_at,
    },
    { requestId },
  );
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "zoe_gateway" });
  if (!authz.ok) return authz.response;
  const rate = await checkRateLimit(`zoe-config:${authz.org.orgId}`, 20, 60);
  if (!rate.allowed)
    return fail("rate_limited", "Aguarde um minuto antes de alterar esta conexão.", 429, {
      requestId,
      headers: { "Retry-After": "60" },
    });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = salvarSchema.safeParse(body);
  if (!parsed.success)
    return fail("validation_failed", "Confira os campos da conexão.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  const url = validarZoeWebhookUrl(parsed.data.webhook_url);
  if (!url)
    return fail(
      "validation_failed",
      "Use o endpoint HTTPS /webhook/zoe/crm/ask em um domínio Dreamland ou Tailscale.",
      422,
      { requestId },
    );
  const suppliedHeader = parsed.data.authorization_header;
  if (suppliedHeader && !/^Bearer [A-Za-z0-9._~+/-]+=*$/.test(suppliedHeader)) {
    return fail("validation_failed", "Informe o valor completo do cabeçalho Bearer.", 422, {
      requestId,
    });
  }

  const admin = createAdminClient();
  const { data: existing, error: readError } = await admin
    .from("organization_zoe_gateway_connections")
    .select("id, authorization_header_encrypted, created_by")
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (readError)
    return fail("internal_error", "Não foi possível ler a conexão atual.", 500, { requestId });

  let encrypted = existing?.authorization_header_encrypted ?? null;
  if (suppliedHeader) {
    try {
      encrypted = await encryptWebhookSecret(admin, suppliedHeader);
    } catch {
      encrypted = null;
    }
  }
  if (!encrypted) {
    const code = suppliedHeader ? "encryption_unavailable" : "validation_failed";
    const message = suppliedHeader
      ? "A proteção de credenciais não está disponível; nada foi alterado."
      : "Informe o Bearer da conexão antes de salvar.";
    return fail(code, message, 422, { requestId });
  }

  const { data, error } = await admin
    .from("organization_zoe_gateway_connections")
    .upsert(
      {
        organization_id: authz.org.orgId,
        webhook_url: url.toString(),
        company_slug: parsed.data.company_slug,
        authorization_header_encrypted: encrypted,
        created_by: existing?.created_by ?? authz.user.id,
        updated_by: authz.user.id,
        updated_at: new Date().toISOString(),
        last_error_code: null,
      },
      { onConflict: "organization_id" },
    )
    .select("id")
    .single();
  if (error || !data)
    return fail("internal_error", "Não foi possível salvar a conexão da Zoe.", 500, { requestId });

  void audit({
    action: "ai.zoe_gateway_configured",
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    resourceType: "organization_zoe_gateway_connection",
    resourceId: data.id,
    requestId,
    metadata: {
      company_slug: parsed.data.company_slug,
      credential_replaced: Boolean(suppliedHeader),
    },
  });
  return ok(
    { saved: true, company_slug: parsed.data.company_slug, has_secret: true },
    { requestId },
  );
}

export async function DELETE(): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "zoe_gateway" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_zoe_gateway_connections")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .select("id")
    .maybeSingle();
  if (error)
    return fail("internal_error", "Não foi possível remover a conexão da Zoe.", 500, { requestId });
  if (data)
    void audit({
      action: "ai.zoe_gateway_removed",
      organizationId: authz.org.orgId,
      actorUserId: authz.user.id,
      resourceType: "organization_zoe_gateway_connection",
      resourceId: data.id,
      requestId,
      metadata: {},
    });
  return ok({ removed: Boolean(data) }, { requestId });
}
