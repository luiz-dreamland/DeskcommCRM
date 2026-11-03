"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Check, CircleAlert, LoaderCircle, LockKeyhole, Mail, RefreshCw, Send } from "lucide-react";
import { useRouter } from "next/navigation";

import { connectHostingerEmail } from "@/app/actions/settings/connectHostingerEmail";
import { disconnectHostingerEmail } from "@/app/actions/settings/disconnectHostingerEmail";
import { setHostingerEmailAutomationEnabled } from "@/app/actions/settings/setHostingerEmailAutomation";
import { setHostingerEmailInboxSyncEnabled } from "@/app/actions/settings/setHostingerEmailInboxSync";
import { sendHostingerEmailTest } from "@/app/actions/settings/sendHostingerEmailTest";
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
import { Switch } from "@/components/ui/switch";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";

interface ConnectionInfo {
  mailbox_email: string;
  status: "disconnected" | "healthy" | "error";
  outbound_automation_enabled: boolean;
  inbox_sync_enabled: boolean;
  last_sync_at: string | null;
  last_error_code: string | null;
}

interface Props {
  connection: ConnectionInfo | null;
  stateUnavailable: boolean;
}

type ConnectionError =
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "mfa_required"
  | "authentication_failed"
  | "connection_failed"
  | "mailbox_unavailable"
  | "encryption_unavailable"
  | "database_error";

type DisconnectError = "unauthenticated" | "forbidden" | "mfa_required" | "database_error";
type AutomationSettingError =
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "mfa_required"
  | "connection_unavailable"
  | "database_error";

const MENSAGENS: Record<ConnectionError, string> = {
  validation_failed: "Confira o endereço e informe a senha da caixa.",
  unauthenticated: "Sua sessão terminou. Entre novamente para conectar a caixa.",
  forbidden: "Somente um administrador da empresa pode conectar esta caixa.",
  mfa_required: "Confirme sua verificação em duas etapas e tente novamente.",
  authentication_failed: "A Hostinger recusou o acesso. Confira o e-mail e a senha da caixa.",
  connection_failed: "Não foi possível alcançar os serviços de e-mail da Hostinger agora.",
  mailbox_unavailable: "O acesso funcionou, mas a pasta de entrada não está disponível.",
  encryption_unavailable: "A proteção de segredos desta instalação não está disponível; nada foi salvo.",
  database_error: "Não foi possível salvar a conexão. Tente novamente em instantes.",
};
type InboxSettingError = AutomationSettingError;
type EmailTestError =
  | "unauthenticated"
  | "forbidden"
  | "mfa_required"
  | "connection_unavailable"
  | "send_failed"
  | "rate_limited"
  | "sender_rejected";

const MENSAGENS_TESTE: Record<EmailTestError, string> = {
  unauthenticated: "Sua sessão terminou. Entre novamente e tente enviar o teste.",
  forbidden: "Somente um administrador da empresa pode enviar o teste.",
  mfa_required: "Confirme sua verificação em duas etapas e tente novamente.",
  connection_unavailable: "A caixa não está conectada e saudável. Verifique a conexão antes de enviar.",
  send_failed: "Não foi possível confirmar o aceite do SMTP. Confira a caixa antes de tentar de novo para evitar duplicidade.",
  rate_limited: "O servidor limitou o envio. Confira se a mensagem chegou antes de tentar novamente.",
  sender_rejected: "O servidor recusou o remetente. Confira a configuração da caixa e tente novamente.",
};

const MENSAGENS_DESCONEXAO: Record<DisconnectError, string> = {
  unauthenticated: "Sua sessão terminou. Entre novamente para desconectar a caixa.",
  forbidden: "Somente um administrador da empresa pode desconectar esta caixa.",
  mfa_required: "Confirme sua verificação em duas etapas e tente novamente.",
  database_error: "Não foi possível remover a conexão. Tente novamente em instantes.",
};

const MENSAGENS_AUTOMACAO: Record<AutomationSettingError, string> = {
  validation_failed: "Não foi possível aplicar esta opção. Atualize a página e tente novamente.",
  unauthenticated: "Sua sessão terminou. Entre novamente para alterar esta opção.",
  forbidden: "Somente um administrador da empresa pode alterar esta opção.",
  mfa_required: "Confirme sua verificação em duas etapas e tente novamente.",
  connection_unavailable: "Conecte e verifique a caixa antes de ativar os envios.",
  database_error: "Não foi possível salvar a opção. Tente novamente.",
};

const MENSAGENS_ENTRADA: Record<InboxSettingError, string> = {
  ...MENSAGENS_AUTOMACAO,
};

export function EmailChannelSettings({ connection, stateUnavailable }: Props) {
  const router = useRouter();
  const tagDoIdioma = useTagDeIdioma();
  const t = useT();
  const [email, setEmail] = useState(connection?.mailbox_email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [automationError, setAutomationError] = useState<string | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [emailTestMessage, setEmailTestMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [outboundEnabled, setOutboundEnabled] = useState(
    connection?.outbound_automation_enabled ?? false,
  );
  const [inboxEnabled, setInboxEnabled] = useState(connection?.inbox_sync_enabled ?? false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [emailTestOpen, setEmailTestOpen] = useState(false);
  const [connectionStored, setConnectionStored] = useState(Boolean(connection));
  const [savedEmail, setSavedEmail] = useState(
    connection?.mailbox_email ?? null,
  );
  const [isPending, startTransition] = useTransition();
  const connectionMatchesEmail =
    !!savedEmail && savedEmail.toLowerCase() === email.trim().toLowerCase();
  const connectionHealthy = connectionMatchesEmail && connection?.status === "healthy";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await connectHostingerEmail({ email, password });
        if (!result.ok) {
          setError(t(MENSAGENS[result.error]));
          return;
        }
        setEmail(result.email);
        setSavedEmail(result.email);
        setOutboundEnabled(result.outboundAutomationEnabled);
        setInboxEnabled(result.inboxSyncEnabled);
        setConnectionStored(true);
        router.refresh();
      } catch {
        setError(t(MENSAGENS.connection_failed));
      } finally {
        setPassword("");
      }
    });
  }

  function toggleAutomationSending(enabled: boolean) {
    setAutomationError(null);
    startTransition(async () => {
      try {
        const result = await setHostingerEmailAutomationEnabled(enabled);
        if (!result.ok) {
          setAutomationError(t(MENSAGENS_AUTOMACAO[result.error]));
          return;
        }
        setOutboundEnabled(result.enabled);
      } catch {
        setAutomationError(t(MENSAGENS_AUTOMACAO.database_error));
      }
    });
  }

  function toggleInboxSync(enabled: boolean) {
    setInboxError(null);
    startTransition(async () => {
      try {
        const result = await setHostingerEmailInboxSyncEnabled(enabled);
        if (!result.ok) {
          setInboxError(t(MENSAGENS_ENTRADA[result.error]));
          return;
        }
        setInboxEnabled(result.enabled);
        router.refresh();
      } catch {
        setInboxError(t(MENSAGENS_ENTRADA.database_error));
      }
    });
  }

  function disconnect() {
    setDisconnectError(null);
    startTransition(async () => {
      try {
        const result = await disconnectHostingerEmail();
        if (!result.ok) {
          setDisconnectError(t(MENSAGENS_DESCONEXAO[result.error]));
          return;
        }
        setConnectionStored(false);
        setSavedEmail(null);
        setEmail("");
        setPassword("");
        setDisconnectOpen(false);
        router.refresh();
      } catch {
        setDisconnectError(t(MENSAGENS_DESCONEXAO.database_error));
      }
    });
  }

  function sendEmailTest() {
    setEmailTestMessage(null);
    startTransition(async () => {
      try {
        const result = await sendHostingerEmailTest();
        if (!result.ok) {
          setEmailTestMessage({ kind: "error", text: t(MENSAGENS_TESTE[result.error]) });
          setEmailTestOpen(false);
          return;
        }
        setEmailTestMessage({
          kind: "success",
          text: t(
            "O servidor SMTP aceitou a mensagem para a própria caixa. Confira a entrada e o spam; o aceite não confirma a entrega final.",
          ),
        });
        setEmailTestOpen(false);
      } catch {
        setEmailTestMessage({
          kind: "error",
          text: t(
            "Não foi possível confirmar o envio. Confira a caixa antes de tentar de novo para evitar duplicidade.",
          ),
        });
        setEmailTestOpen(false);
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-md border border-border bg-surface p-2 text-muted-foreground">
              <Mail aria-hidden="true" size={20} />
            </div>
            <div>
              <CardTitle>{t("Caixa da empresa")}</CardTitle>
              <CardDescription>{t("Hostinger · entrada e saída protegidas por TLS")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {stateUnavailable ? (
            <div
              role="alert"
              className="mb-4 flex gap-3 rounded-md border border-warning/40 bg-warning-bg p-3 text-sm text-warning-fg"
            >
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <p>{t("Não foi possível confirmar o estado salvo da caixa. Atualize a página antes de alterar a conexão.")}</p>
            </div>
          ) : null}
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="hostinger-email">{t("Endereço de e-mail")}</Label>
              <Input
                id="hostinger-email"
                type="email"
                autoComplete="username"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hostinger-password">{t("Senha da caixa")}</Label>
              <Input
                id="hostinger-password"
                type="password"
                autoComplete="off"
                maxLength={1_024}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                {t("A senha é verificada e guardada cifrada. Ela nunca volta a aparecer nesta tela.")}
              </p>
            </div>

            {error ? (
              <div
                role="alert"
                className="flex gap-3 rounded-md border border-error/40 bg-error-bg p-3 text-sm text-error-fg"
              >
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-medium">{t("Não foi possível conectar")}</p>
                  <p className="mt-1">{error}</p>
                </div>
              </div>
            ) : null}

            {connectionHealthy && !error ? (
              <div
                role="status"
                className="flex gap-3 rounded-md border border-success/40 bg-success-bg p-3 text-sm text-success-fg"
              >
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-medium">{t("Caixa autenticada")}</p>
                  <p className="mt-1">
                    {savedEmail} {t("passou na verificação de entrada e saída. Use os controles abaixo para liberar a leitura de mensagens novas e, separadamente, os envios automáticos da Zoe.")}
                  </p>
                </div>
              </div>
            ) : null}
            {savedEmail && !connectionHealthy && !error ? (
              <div
                role="status"
                className="flex gap-3 rounded-md border border-warning/40 bg-warning-bg p-3 text-sm text-warning-fg"
              >
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-medium">
                    {connectionMatchesEmail ? t("Conexão indisponível") : t("Alteração pendente")}
                  </p>
                  <p className="mt-1">
                    {connectionMatchesEmail
                      ? <>{t("A caixa")} {savedEmail} {t("está salva, mas precisa ser verificada novamente. As automações ficam bloqueadas até a conexão voltar.")}</>
                      : <>{t("O endereço salvo é")} {savedEmail}. {t("Verifique e salve o novo endereço antes de usá-lo.")}</>}
                  </p>
                </div>
              </div>
            ) : null}

            <Button type="submit" disabled={stateUnavailable || isPending || !email || !password}>
              {isPending ? (
                <>
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                  {t("Verificando acesso...")}
                </>
              ) : (
                <>
                  <RefreshCw aria-hidden="true" />
                  {t("Verificar e salvar")}
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <LockKeyhole aria-hidden="true" className="text-muted-foreground" size={18} />
            <CardTitle>{t("Estado do canal")}</CardTitle>
          </div>
          <CardDescription>
            {t("A autenticação verifica SMTP e IMAP sem enviar. O envio de teste é manual e vai somente para a própria caixa conectada.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t("Entrada IMAP")}</span>
            <Badge variant={connectionHealthy ? "success" : connectionMatchesEmail && connection?.status === "error" ? "error" : "secondary"}>
              {connectionHealthy
                ? t("Autenticada")
                : connectionMatchesEmail && connection?.status === "error"
                  ? t("Falha na conexão")
                  : stateUnavailable
                    ? t("Não verificada")
                    : t("Não conectada")}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t("Acesso SMTP")}</span>
            <Badge variant={connectionHealthy ? "success" : connectionMatchesEmail && connection?.status === "error" ? "error" : "secondary"}>
              {connectionHealthy
                ? t("Verificado")
                : connectionMatchesEmail && connection?.status === "error"
                  ? t("Falha na conexão")
                  : stateUnavailable
                    ? t("Não verificada")
                    : t("Não conectado")}
            </Badge>
          </div>
          {connectionHealthy ? (
            <div className="space-y-3 rounded-md border border-border bg-surface p-3">
              <div className="space-y-1">
                <p className="font-medium">{t("Confirmar recebimento")}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("Envia uma única mensagem para")} {savedEmail}. {t("Nenhum lead ou contato externo será avisado.")}
                </p>
              </div>
              {emailTestMessage ? (
                <div
                  role={emailTestMessage.kind === "success" ? "status" : "alert"}
                  className={
                    emailTestMessage.kind === "success"
                      ? "rounded-md border border-success/40 bg-success-bg p-3 text-xs text-success-fg"
                      : "rounded-md border border-error/40 bg-error-bg p-3 text-xs text-error-fg"
                  }
                >
                  {emailTestMessage.text}
                </div>
              ) : null}
              <AlertDialog
                open={emailTestOpen}
                onOpenChange={(open) => {
                  setEmailTestOpen(open);
                  if (open) setEmailTestMessage(null);
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline" disabled={stateUnavailable || isPending}>
                    <Send aria-hidden="true" />
                    {t("Enviar e-mail de teste")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("Enviar teste para")} {savedEmail}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("Será enviada uma mensagem fixa somente para esta caixa. O envio não inicia campanha nem contata leads; o servidor pode aceitar a mensagem sem garantir que ela chegue à entrada.")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isPending}>{t("Cancelar")}</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={isPending || stateUnavailable}
                      onClick={(event) => {
                        event.preventDefault();
                        sendEmailTest();
                      }}
                    >
                      {isPending ? t("Enviando teste…") : t("Confirmar envio")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : null}
          {connectionStored && connectionMatchesEmail ? (
            <div className="space-y-3 rounded-md border border-border bg-surface p-3">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="hostinger-inbox-sync" className="font-medium">
                    {t("Receber mensagens e disponibilizar à Zoe")}
                  </Label>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("Importa somente mensagens novas. Se houver um agente ativo neste canal, o conteúdo poderá ser processado pelo provedor de modelo configurado. O histórico anterior não é importado.")}
                  </p>
                </div>
                <Switch
                  id="hostinger-inbox-sync"
                  checked={inboxEnabled}
                  disabled={stateUnavailable || isPending || (!connectionHealthy && !inboxEnabled)}
                  onCheckedChange={toggleInboxSync}
                  aria-label={t("Receber mensagens novas e disponibilizar à Zoe")}
                />
              </div>
              {inboxError ? <p role="alert" className="text-xs text-error-fg">{inboxError}</p> : null}
              <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
                <div className="space-y-1">
                  <Label htmlFor="hostinger-automation-sending" className="font-medium">
                    {t("Permitir envios automáticos da Zoe")}
                  </Label>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("Desligado por padrão. Ao ativar, respostas da Zoe e regras de automação podem enviar por esta caixa sem pedir aprovação a cada mensagem.")}
                  </p>
                </div>
                <Switch
                  id="hostinger-automation-sending"
                  checked={outboundEnabled}
                  disabled={stateUnavailable || isPending || (!connectionHealthy && !outboundEnabled)}
                  onCheckedChange={toggleAutomationSending}
                  aria-label={t("Permitir que a Zoe e as automações enviem pela caixa Hostinger")}
                />
              </div>
              {automationError ? (
                <p role="alert" className="text-xs text-error-fg">{automationError}</p>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t("Sincronização")}</span>
            <Badge variant="secondary">
              {stateUnavailable
                ? t("Não verificada")
                : !connectionMatchesEmail && connection?.inbox_sync_enabled
                ? t("Será desligada ao trocar a caixa")
                : inboxEnabled
                  ? connection?.status === "healthy"
                    ? t("Ativada")
                    : t("Pausada · conexão indisponível")
                  : t("Desligada")}
            </Badge>
          </div>
          {inboxEnabled && connection?.last_sync_at ? (
            <p className="text-xs text-muted-foreground">
              {t("Última sincronização:")} {new Date(connection.last_sync_at).toLocaleString(tagDoIdioma)}
            </p>
          ) : null}
          {inboxEnabled && connection?.last_error_code ? (
            <p role="status" className="text-xs text-warning-fg">
              {t("A última sincronização sinalizou um problema. As mensagens recebidas continuam seguras na caixa original.")}
            </p>
          ) : null}
          <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
            {t("Ler a Inbox e autorizar envios automáticos são escolhas separadas. A conexão começa com as duas opções desligadas.")}
          </p>
          {connectionStored ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                {t("Desconectar remove do CRM a senha cifrada e desliga qualquer sincronização futura.")}
              </p>
              <AlertDialog
                open={disconnectOpen}
                onOpenChange={(open) => {
                  setDisconnectOpen(open);
                  if (open) setDisconnectError(null);
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline" disabled={stateUnavailable || isPending}>
                    {t("Desconectar caixa")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("Desconectar")} {connection?.mailbox_email ?? t("esta caixa")}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("A credencial salva será removida e a sincronização ficará desligada. Para reconectar, será necessário informar e verificar a senha novamente.")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  {disconnectError ? (
                    <div
                      role="alert"
                      className="rounded-md border border-error/40 bg-error-bg p-3 text-sm text-error-fg"
                    >
                      {disconnectError}
                    </div>
                  ) : null}
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isPending}>{t("Manter conectada")}</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={isPending || stateUnavailable}
                      onClick={(event) => {
                        event.preventDefault();
                        disconnect();
                      }}
                    >
                      {isPending ? t("Desconectando…") : t("Remover credencial")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
