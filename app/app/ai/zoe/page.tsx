import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ROLE_RANK } from "@/lib/auth/types";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ZoeChat } from "./_chat";

export const dynamic = "force-dynamic";

export default async function ZoeChatPage() {
  const user = await requireAuth();
  const organization = await resolveActiveOrg(user);
  if (!organization) redirect("/app");
  if (ROLE_RANK[organization.role] < ROLE_RANK.manager) redirect("/403");

  const { data } = await createAdminClient()
    .from("organization_zoe_gateway_connections")
    .select("company_slug")
    .eq("organization_id", organization.orgId)
    .maybeSingle();

  return (
    <main className="mx-auto flex h-full w-full max-w-5xl flex-col gap-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Assistente comercial
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Converse com a Zoe</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Planeje, pesquise e esclareça o próximo passo comercial.
          </p>
        </div>
        {organization.role === "admin" && (
          <Button asChild variant="outline">
            <Link href="/app/settings/zoe">Configurar conexão</Link>
          </Button>
        )}
      </header>
      {data ? (
        <ZoeChat
          organizationId={organization.orgId}
          userId={user.id}
          companySlug={data.company_slug === "fonte-solar" ? "fonte-solar" : "dreamland"}
        />
      ) : (
        <section className="rounded-xl border bg-card p-6">
          <h2 className="font-semibold">A conexão da Zoe ainda não foi configurada</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Peça a um administrador para ligar este CRM ao gateway n8n. Nenhuma mensagem será
            enviada automaticamente.
          </p>
          {organization.role === "admin" && (
            <Button asChild className="mt-4">
              <Link href="/app/settings/zoe">Configurar agora</Link>
            </Button>
          )}
        </section>
      )}
    </main>
  );
}
