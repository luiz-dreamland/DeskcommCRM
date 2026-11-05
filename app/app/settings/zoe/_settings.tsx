"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Check, CircleAlert, LoaderCircle, PlugZap, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Company = "dreamland" | "fonte-solar";
interface InitialState {
  configured: boolean;
  hasSecret: boolean;
  webhookUrl: string;
  companySlug: Company;
  lastSuccessfulCallAt: string | null;
  lastErrorCode: string | null;
  updatedAt: string | null;
}

function readableError(code: string): string {
  const map: Record<string, string> = {
    validation_failed: "Confira o endereço e o cabeçalho Bearer.",
    encryption_unavailable: "A proteção de credenciais do servidor não está disponível.",
    service_unavailable: "A conexão segura não está pronta. Salve novamente o endereço e o Bearer.",
    rate_limited: "Muitas alterações em pouco tempo. Aguarde um minuto.",
    internal_error: "Não foi possível atualizar a configuração.",
    unauthenticated: "Sua sessão terminou. Entre novamente.",
    forbidden: "Somente um administrador da organização pode alterar esta conexão.",
    mfa_required: "Confirme a verificação em duas etapas e tente novamente.",
  };
  return map[code] ?? "Não foi possível concluir a operação.";
}

export function ZoeGatewaySettings({ initial }: { initial: InitialState }) {
  const [url, setUrl] = useState(initial.webhookUrl);
  const [company, setCompany] = useState<Company>(initial.companySlug);
  const [bearer, setBearer] = useState("");
  const [configured, setConfigured] = useState(initial.configured);
  const [hasSecret, setHasSecret] = useState(initial.hasSecret);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    startTransition(async () => {
      const response = await fetch("/api/v1/ai/zoe/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhook_url: url,
          company_slug: company,
          authorization_header: bearer,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        setError(readableError(json?.error?.code ?? "internal_error"));
        return;
      }
      setBearer("");
      setConfigured(true);
      setHasSecret(true);
      setMessage("Conexão salva. O segredo fica somente no servidor.");
    });
  }

  function remove() {
    setError("");
    setMessage("");
    startTransition(async () => {
      const response = await fetch("/api/v1/ai/zoe/config", { method: "DELETE" });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        setError(readableError(json?.error?.code ?? "internal_error"));
        return;
      }
      setConfigured(false);
      setHasSecret(false);
      setUrl("");
      setBearer("");
      setMessage("Conexão removida.");
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Gateway n8n</CardTitle>
              <CardDescription className="mt-1">
                A Zoe usa o fluxo autenticado que já está configurado no n8n.
              </CardDescription>
            </div>
            <Badge variant={configured ? "default" : "secondary"}>
              {configured ? "Configurado" : "Pendente"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={save}>
            <div className="space-y-2">
              <Label htmlFor="zoe-webhook-url">Endereço do webhook</Label>
              <Input
                id="zoe-webhook-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://seu-n8n.dreamlab.lol/webhook/zoe/crm/ask"
                required
              />
              <p className="text-xs text-muted-foreground">
                Use o endereço de produção terminado em /webhook/zoe/crm/ask. A tela aceita HTTPS em
                domínios dreamlab.lol ou Tailscale.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="zoe-company">Empresa atendida</Label>
              <select
                id="zoe-company"
                value={company}
                onChange={(event) => setCompany(event.target.value as Company)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="dreamland">Dreamland</option>
                <option value="fonte-solar">Fonte Solar</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="zoe-bearer">Cabeçalho Bearer do n8n</Label>
              <Input
                id="zoe-bearer"
                type="password"
                autoComplete="new-password"
                value={bearer}
                onChange={(event) => setBearer(event.target.value)}
                placeholder={hasSecret ? "Segredo salvo — deixe em branco para manter" : "Bearer …"}
                required={!hasSecret}
              />
              <p className="text-xs text-muted-foreground">
                Cole o valor completo que começa com Bearer. Ele é cifrado no servidor e nunca volta
                para o navegador.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={pending || (!bearer && !hasSecret)}>
                {pending ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PlugZap className="mr-2 h-4 w-4" />
                )}
                Salvar conexão
              </Button>
              {configured && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" disabled={pending}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remover
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remover a conexão com a Zoe?</AlertDialogTitle>
                      <AlertDialogDescription>
                        O chat ficará indisponível até um administrador configurar o gateway
                        novamente.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={remove}>Remover conexão</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </form>
          {(message || error) && (
            <div
              role={error ? "alert" : "status"}
              className={`mt-5 flex items-start gap-2 rounded-md border p-3 text-sm ${error ? "border-destructive/40 text-destructive" : "border-emerald-500/30 text-emerald-600"}`}
            >
              {error ? (
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <Check className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{error || message}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Limites desta conexão</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>A Zoe consulta o CRM em modo somente leitura e pode pesquisar informações públicas.</p>
          <p>
            Ela não cria nem altera contatos, não envia mensagens e não publica campanhas por este
            chat.
          </p>
          {initial.lastSuccessfulCallAt && (
            <p>
              Última resposta confirmada:{" "}
              {new Date(initial.lastSuccessfulCallAt).toLocaleString("pt-BR")}.
            </p>
          )}
          {initial.lastErrorCode && (
            <p role="status">Última falha: {initial.lastErrorCode.replaceAll("_", " ")}.</p>
          )}
          {initial.updatedAt && (
            <p>Configuração atualizada em {new Date(initial.updatedAt).toLocaleString("pt-BR")}.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
