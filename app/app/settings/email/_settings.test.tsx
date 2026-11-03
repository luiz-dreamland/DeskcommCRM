import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectHostingerEmail: vi.fn(),
  disconnectHostingerEmail: vi.fn(),
  setHostingerEmailAutomationEnabled: vi.fn(),
  setHostingerEmailInboxSyncEnabled: vi.fn(),
  sendHostingerEmailTest: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock("@/app/actions/settings/connectHostingerEmail", () => ({
  connectHostingerEmail: mocks.connectHostingerEmail,
}));
vi.mock("@/app/actions/settings/disconnectHostingerEmail", () => ({
  disconnectHostingerEmail: mocks.disconnectHostingerEmail,
}));
vi.mock("@/app/actions/settings/setHostingerEmailAutomation", () => ({
  setHostingerEmailAutomationEnabled: mocks.setHostingerEmailAutomationEnabled,
}));
vi.mock("@/app/actions/settings/setHostingerEmailInboxSync", () => ({
  setHostingerEmailInboxSyncEnabled: mocks.setHostingerEmailInboxSyncEnabled,
}));
vi.mock("@/app/actions/settings/sendHostingerEmailTest", () => ({
  sendHostingerEmailTest: mocks.sendHostingerEmailTest,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.routerRefresh }) }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));

import { EmailChannelSettings } from "./_settings";

const CONEXAO = {
  mailbox_email: "contato@dreamlab.lol",
  status: "healthy" as const,
  outbound_automation_enabled: false,
  inbox_sync_enabled: false,
  last_sync_at: null,
  last_error_code: null,
};

describe("EmailChannelSettings — teste manual de recebimento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendHostingerEmailTest.mockResolvedValue({ ok: true });
  });

  it("pede confirmação, envia o teste e informa que o aceite não prova entrega", async () => {
    const user = userEvent.setup();
    render(<EmailChannelSettings connection={CONEXAO} stateUnavailable={false} />);

    await user.click(screen.getByRole("button", { name: "Enviar e-mail de teste" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Enviar teste para contato@dreamlab.lol?");
    expect(dialog).toHaveTextContent("não inicia campanha nem contata leads");

    await user.click(screen.getByRole("button", { name: "Confirmar envio" }));

    await waitFor(() => expect(mocks.sendHostingerEmailTest).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/o aceite não confirma a entrega final/i)).toBeInTheDocument();
  });

  it("explica quando o servidor aceita, mas não é possível confirmar o envio", async () => {
    const user = userEvent.setup();
    mocks.sendHostingerEmailTest.mockResolvedValue({ ok: false, error: "send_failed" });
    render(<EmailChannelSettings connection={CONEXAO} stateUnavailable={false} />);

    await user.click(screen.getByRole("button", { name: "Enviar e-mail de teste" }));
    await user.click(screen.getByRole("button", { name: "Confirmar envio" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Confira a caixa antes de tentar de novo para evitar duplicidade",
    );
  });
});
