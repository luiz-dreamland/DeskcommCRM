"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, LoaderCircle, Plus, Send, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type Company = "dreamland" | "fonte-solar";
type Group = "comercial" | "marketing" | "geral";
interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}
interface StoredConversation {
  conversationId: string;
  messages: Message[];
}

const MAX_STORED_MESSAGES = 80;

function parseEnvelope(value: unknown): { answer?: string; error?: string } {
  if (!value || typeof value !== "object") return {};
  const body = value as {
    data?: { answer?: unknown };
    error?: { code?: unknown; message?: unknown };
  };
  return {
    answer: typeof body.data?.answer === "string" ? body.data.answer : undefined,
    error: typeof body.error?.code === "string" ? body.error.code : undefined,
  };
}

export function ZoeChat({
  organizationId,
  userId,
  companySlug,
}: {
  organizationId: string;
  userId: string;
  companySlug: Company;
}) {
  const storageKey = `deskcomm:zoe:${organizationId}:${userId}:${companySlug}`;
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [group, setGroup] = useState<Group>("comercial");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(storageKey) ?? "null",
      ) as StoredConversation | null;
      if (saved?.conversationId && Array.isArray(saved.messages)) {
        setConversationId(saved.conversationId);
        setMessages(saved.messages.slice(-MAX_STORED_MESSAGES));
      } else {
        setConversationId(crypto.randomUUID());
      }
    } catch {
      setConversationId(crypto.randomUUID());
    }
    restored.current = true;
  }, [storageKey]);

  useEffect(() => {
    if (!restored.current || !conversationId) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          conversationId,
          messages: messages.slice(-MAX_STORED_MESSAGES),
        } satisfies StoredConversation),
      );
    } catch {
      /* o chat continua funcional se o armazenamento local estiver bloqueado */
    }
  }, [conversationId, messages, storageKey]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  function newConversation() {
    const id = crypto.randomUUID();
    setConversationId(id);
    setMessages([]);
    setDraft("");
    setError("");
  }

  async function send() {
    const message = draft.trim();
    if (!message || pending || !conversationId) return;
    setDraft("");
    setError("");
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text: message,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, userMessage]);
    setPending(true);
    try {
      const response = await fetch("/api/v1/ai/zoe/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          group_type: group,
          company_slug: companySlug,
          conversation_id: conversationId,
        }),
      });
      const envelope = parseEnvelope(await response.json().catch(() => null));
      if (!response.ok || !envelope.answer) {
        setError(
          envelope.error === "rate_limited"
            ? "Aguarde um minuto antes de perguntar novamente."
            : envelope.error === "upstream_timeout"
              ? "A Zoe demorou mais que o esperado. A pergunta não foi reenviada."
              : "A Zoe não conseguiu responder. Confira a conexão e tente novamente quando estiver pronta.",
        );
        return;
      }
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: envelope.answer!,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch {
      setError("Não foi possível alcançar a Zoe. A pergunta não será reenviada automaticamente.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {companySlug === "dreamland" ? "Dreamland" : "Fonte Solar"}
          </Badge>
          <select
            aria-label="Grupo da conversa"
            value={group}
            onChange={(event) => setGroup(event.target.value as Group)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="comercial">Comercial</option>
            <option value="marketing">Marketing</option>
            <option value="geral">Geral</option>
          </select>
        </div>
        <Button variant="outline" size="sm" onClick={newConversation} disabled={pending}>
          <Plus className="mr-2 h-4 w-4" />
          Nova conversa
        </Button>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <div className="mx-auto mt-8 max-w-xl text-center">
            <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary">
              <Bot className="h-5 w-5" />
            </div>
            <h2 className="font-medium">Como posso ajudar no comercial?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Você pode pedir pesquisa, planejamento ou ajuda para esclarecer uma oportunidade.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {[
                "Pesquise tendências do meu mercado",
                "Ajude a definir o próximo passo",
                "O que falta esclarecer no meu pedido?",
              ].map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  size="sm"
                  onClick={() => setDraft(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {message.role === "assistant" && (
              <div className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Bot className="h-4 w-4" />
              </div>
            )}
            <div
              className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              <p className="break-words whitespace-pre-wrap">{message.text}</p>
            </div>
            {message.role === "user" && (
              <div className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted">
                <UserRound className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}
        {pending && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-primary">
              <Bot className="h-4 w-4" />
            </div>
            <LoaderCircle className="h-4 w-4 animate-spin" />
            <span>A Zoe está pensando…</span>
          </div>
        )}
      </div>

      <div className="border-t p-4">
        {error && (
          <p
            role="alert"
            className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <div className="flex items-end gap-3">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="Escreva sua pergunta…"
            maxLength={8000}
            rows={3}
            disabled={pending}
            className="min-h-[72px] resize-y"
          />
          <Button
            onClick={() => void send()}
            disabled={pending || !draft.trim() || !conversationId}
            className="shrink-0"
          >
            <Send className="mr-2 h-4 w-4" />
            Enviar
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>
            A pergunta vai ao n8n e ao modelo configurado. A Zoe lê o CRM, sem alterar dados ou
            contatar leads.
          </span>
          <span>{draft.length}/8000 · Enter envia, Shift+Enter quebra a linha</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          O histórico visível fica neste navegador; a memória da conversa fica no n8n.
        </p>
      </div>
    </Card>
  );
}
