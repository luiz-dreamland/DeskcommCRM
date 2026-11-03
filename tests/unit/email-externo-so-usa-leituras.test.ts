import { describe, expect, it } from "vitest";

import { filtrarToolsParaEmailExterno } from "@/lib/agent-engine/edge/crm/mcp-tools";

describe("ferramentas em mensagens de e-mail externo", () => {
  it("mantém somente as consultas comerciais autorizadas", () => {
    expect(
      filtrarToolsParaEmailExterno([
        "crm_search_products",
        "crm_create_contact",
        "crm_search_knowledge",
        "crm_list_followups",
        "mcp_externo:leitura:buscar_clientes",
      ]),
    ).toEqual(["crm_search_products", "crm_search_knowledge"]);
  });

  it("não oferece ferramentas quando a lista contém apenas escrita ou IDs desconhecidos", () => {
    expect(
      filtrarToolsParaEmailExterno([
        "crm_create_contact",
        "crm_send_whatsapp_message",
        "mcp_externo:admin:alterar_cliente",
        "tool_inexistente",
      ]),
    ).toEqual([]);
  });
});
