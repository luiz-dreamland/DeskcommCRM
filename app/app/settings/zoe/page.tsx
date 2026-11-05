import { redirect } from "next/navigation";

import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ZoeGatewaySettings } from "./_settings";

export const dynamic = "force-dynamic";

export default async function ZoeGatewaySettingsPage() {
  const user = await requireAuth();
  const organization = await resolveActiveOrg(user);
  if (!organization) redirect("/app");
  if (!podeAdministrarEmpresa(user, organization)) redirect("/403");

  const { data } = await createAdminClient()
    .from("organization_zoe_gateway_connections")
    .select(
      "webhook_url, company_slug, authorization_header_encrypted, last_successful_call_at, last_error_code, updated_at",
    )
    .eq("organization_id", organization.orgId)
    .maybeSingle();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Conexão da Zoe</h1>
        <p className="text-sm text-muted-foreground">
          Ligue esta organização ao gateway autenticado do n8n.
        </p>
      </header>
      <ZoeGatewaySettings
        initial={{
          configured: Boolean(data),
          hasSecret: Boolean(data?.authorization_header_encrypted),
          webhookUrl: data?.webhook_url ?? "",
          companySlug: data?.company_slug === "fonte-solar" ? "fonte-solar" : "dreamland",
          lastSuccessfulCallAt: data?.last_successful_call_at ?? null,
          lastErrorCode: data?.last_error_code ?? null,
          updatedAt: data?.updated_at ?? null,
        }}
      />
    </div>
  );
}
