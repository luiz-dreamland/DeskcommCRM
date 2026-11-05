import { describe, expect, it } from "vitest";

import {
  extrairRespostaZoe,
  idDeMemoriaZoe,
  lerPayloadZoe,
  validarZoeWebhookUrl,
} from "@/lib/ai/zoe/gateway";

describe("gateway da Zoe", () => {
  it("aceita apenas o endpoint HTTPS de produção nos domínios permitidos", () => {
    expect(validarZoeWebhookUrl("https://n8n.tailnet.ts.net/webhook/zoe/crm/ask")?.hostname).toBe(
      "n8n.tailnet.ts.net",
    );
    expect(validarZoeWebhookUrl("http://n8n.tailnet.ts.net/webhook/zoe/crm/ask")).toBeNull();
    expect(validarZoeWebhookUrl("https://127.0.0.1/webhook/zoe/crm/ask")).toBeNull();
    expect(validarZoeWebhookUrl("https://n8n.dreamlab.lol/anything")).toBeNull();
    expect(
      validarZoeWebhookUrl("https://user:pass@n8n.dreamlab.lol/webhook/zoe/crm/ask"),
    ).toBeNull();
  });

  it("isola memória entre organização, pessoa e empresa sem revelar esses valores no id", () => {
    const input = [
      "internal-secret",
      "org-a",
      "user-a",
      "dreamland",
      "f6143021-6ac5-4f59-8e70-8a843920f914",
    ] as const;
    const first = idDeMemoriaZoe(...input);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(idDeMemoriaZoe(...input)).toBe(first);
    expect(idDeMemoriaZoe("internal-secret", "org-b", "user-a", "dreamland", input[4])).not.toBe(
      first,
    );
    expect(idDeMemoriaZoe("internal-secret", "org-a", "user-b", "dreamland", input[4])).not.toBe(
      first,
    );
    expect(idDeMemoriaZoe("internal-secret", "org-a", "user-a", "fonte-solar", input[4])).not.toBe(
      first,
    );
  });

  it("aceita resposta textual simples e forma aninhada usada pelo n8n", () => {
    expect(extrairRespostaZoe({ ok: true, answer: "Olá." })).toBe("Olá.");
    expect(extrairRespostaZoe({ ok: true, answer: { output: "Consultei as fontes." } })).toBe(
      "Consultei as fontes.",
    );
    expect(extrairRespostaZoe({ ok: false, answer: "não" })).toBeNull();
    expect(extrairRespostaZoe({ ok: true, answer: "  " })).toBeNull();
  });

  it("limita o tamanho do JSON recebido do gateway", async () => {
    expect(
      await lerPayloadZoe(
        new Response('{"ok":true}', { headers: { "content-type": "application/json" } }),
      ),
    ).toEqual({ ok: true });
    expect(
      await lerPayloadZoe(
        new Response('{"ok":true}', { headers: { "content-type": "application/json" } }),
        4,
      ),
    ).toBeNull();
  });
});
