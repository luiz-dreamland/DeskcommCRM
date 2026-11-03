import { redirect } from "next/navigation";

import { getHostingerEmailConnection } from "@/lib/email/hostinger-config";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { EmailChannelSettings } from "./_settings";

export const dynamic = "force-dynamic";

export default async function EmailChannelSettingsPage() {
  const user = await requireAuth();
  const organization = await resolveActiveOrg(user);
  if (!organization) redirect("/app");
  if (!podeAdministrarEmpresa(user, organization)) redirect("/403");

  const leitura = await getHostingerEmailConnection(organization.orgId);
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("E-mail comercial", user.idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir("Conecte a caixa e escolha se novas mensagens ficam disponíveis para a Zoe e se ela pode responder automaticamente por e-mail.", user.idioma)}
        </p>
      </header>
      <EmailChannelSettings
        connection={leitura.ok ? leitura.connection : null}
        stateUnavailable={!leitura.ok}
      />
    </div>
  );
}
