import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export const ZOE_COMPANIES = ["dreamland", "fonte-solar"] as const;
export type ZoeCompany = (typeof ZOE_COMPANIES)[number];
export const ZOE_GROUPS = ["comercial", "marketing", "geral"] as const;
export type ZoeGroup = (typeof ZOE_GROUPS)[number];

const WEBHOOK_PATH = "/webhook/zoe/crm/ask";

/**
 * Aceita apenas o endpoint de produção conhecido e domínios sob controle Dreamland.
 * Isso bloqueia localhost, IPs internos, URLs com credenciais e caminhos que
 * poderiam transformar a configuração em uma porta SSRF.
 */
export function validarZoeWebhookUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  const dominioPermitido =
    hostname.endsWith(".ts.net") ||
    hostname === "dreamlab.lol" ||
    hostname.endsWith(".dreamlab.lol");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.pathname !== WEBHOOK_PATH ||
    url.search ||
    url.hash ||
    isIP(hostname) !== 0 ||
    !dominioPermitido ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  )
    return null;
  return url;
}

/** UUID determinístico por organização, operador, empresa e conversa local. */
export function idDeMemoriaZoe(
  secret: string,
  orgId: string,
  userId: string,
  company: ZoeCompany,
  conversationId: string,
): string {
  const bytes = createHmac("sha256", secret)
    .update(`${orgId}:${userId}:zoe:${company}:${conversationId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function extrairRespostaZoe(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const body = payload as Record<string, unknown>;
  if (body.ok !== true) return null;
  const answer = body.answer;
  if (typeof answer === "string") return answer.trim().slice(0, 24_000) || null;
  if (answer && typeof answer === "object" && !Array.isArray(answer)) {
    const nested = answer as Record<string, unknown>;
    for (const key of ["output", "text", "answer"]) {
      if (typeof nested[key] === "string" && (nested[key] as string).trim()) {
        return (nested[key] as string).trim().slice(0, 24_000);
      }
    }
  }
  return null;
}

/** Lê JSON do n8n com teto de bytes para não carregar respostas ilimitadas em memória. */
export async function lerPayloadZoe(
  response: Response,
  limiteBytes = 128_000,
): Promise<unknown | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limiteBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}
