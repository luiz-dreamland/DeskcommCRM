"use server";

import { audit } from "@/lib/audit";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import { sendHostingerEmail } from "@/lib/email/hostinger";
import {
  getHostingerEmailAccountForHealth,
  getHostingerEmailConnection,
} from "@/lib/email/hostinger-config";
import { supportWriteError } from "@/lib/impersonate/support";

export type SendHostingerEmailTestResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "forbidden"
        | "mfa_required"
        | "connection_unavailable"
        | "send_failed"
        | "rate_limited"
        | "sender_rejected";
    };

/** Envia um teste fixo somente à própria caixa saudável, após confirmação explícita do admin. */
export async function sendHostingerEmailTest(): Promise<SendHostingerEmailTestResult> {
  const user = await loadAuthUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(user.support)) return { ok: false, error: "forbidden" };
  const org = await resolveActiveOrg(user);
  if (!org || !podeAdministrarEmpresa(user, org)) return { ok: false, error: "forbidden" };
  if (await mfaEmDivida()) return { ok: false, error: "mfa_required" };

  const connectionResult = await getHostingerEmailConnection(org.orgId);
  if (
    !connectionResult.ok ||
    !connectionResult.connection ||
    connectionResult.connection.status !== "healthy"
  ) {
    return { ok: false, error: "connection_unavailable" };
  }

  const account = await getHostingerEmailAccountForHealth(org.orgId);
  if (
    account.state !== "ready" ||
    account.credentials.email.trim().toLowerCase() !==
      connectionResult.connection.mailbox_email.trim().toLowerCase()
  ) {
    return { ok: false, error: "connection_unavailable" };
  }

  const result = await sendHostingerEmail(account.credentials, {
    to: account.credentials.email,
    subject: "[DeskcommCRM] Teste da conexão de e-mail",
    text: "Este é um e-mail de teste do DeskcommCRM enviado para a própria caixa conectada. Nenhum contato foi incluído. Se esta mensagem chegou, a saída SMTP foi aceita.",
    html: "<p>Este é um e-mail de teste do DeskcommCRM enviado para a própria caixa conectada.</p><p>Nenhum contato foi incluído. Se esta mensagem chegou, a saída SMTP foi aceita.</p>",
  });

  await audit({
    action: result.ok ? "email.test_message_accepted" : "email.test_message_failed",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "organization_email_connection",
    resourceId: connectionResult.connection.id,
    metadata: {
      provider: "hostinger",
      smtp_accepted: result.ok,
      ...(!result.ok ? { failure: result.error } : {}),
    },
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}
