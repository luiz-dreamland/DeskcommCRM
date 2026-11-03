import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  audit: vi.fn(),
  loadAuthUser: vi.fn(),
  mfaEmDivida: vi.fn(),
  resolveActiveOrg: vi.fn(),
  podeAdministrarEmpresa: vi.fn(),
  supportWriteError: vi.fn(),
  getHostingerEmailConnection: vi.fn(),
  getHostingerEmailAccountForHealth: vi.fn(),
  sendHostingerEmail: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ audit: deps.audit }));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: deps.loadAuthUser,
  mfaEmDivida: deps.mfaEmDivida,
  resolveActiveOrg: deps.resolveActiveOrg,
}));
vi.mock("@/lib/auth/pode-administrar-empresa", () => ({
  podeAdministrarEmpresa: deps.podeAdministrarEmpresa,
}));
vi.mock("@/lib/impersonate/support", () => ({ supportWriteError: deps.supportWriteError }));
vi.mock("@/lib/email/hostinger-config", () => ({
  getHostingerEmailConnection: deps.getHostingerEmailConnection,
  getHostingerEmailAccountForHealth: deps.getHostingerEmailAccountForHealth,
}));
vi.mock("@/lib/email/hostinger", () => ({ sendHostingerEmail: deps.sendHostingerEmail }));

import { sendHostingerEmailTest } from "./sendHostingerEmailTest";

const EMAIL = "contato@dreamlab.lol";
const PASSWORD = "secret-not-for-logs";
const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";

describe("sendHostingerEmailTest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deps.loadAuthUser.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", support: null });
    deps.mfaEmDivida.mockResolvedValue(false);
    deps.resolveActiveOrg.mockResolvedValue({ orgId: ORGANIZATION_ID });
    deps.podeAdministrarEmpresa.mockReturnValue(true);
    deps.supportWriteError.mockReturnValue(false);
    deps.getHostingerEmailConnection.mockResolvedValue({
      ok: true,
      connection: { id: CONNECTION_ID, mailbox_email: EMAIL, status: "healthy" },
    });
    deps.getHostingerEmailAccountForHealth.mockResolvedValue({
      state: "ready",
      credentials: { email: EMAIL, password: PASSWORD },
    });
    deps.sendHostingerEmail.mockResolvedValue({ ok: true });
    deps.audit.mockResolvedValue(undefined);
  });

  it("envia o texto fixo somente para a caixa conectada e audita sem dados pessoais", async () => {
    await expect(sendHostingerEmailTest()).resolves.toEqual({ ok: true });

    expect(deps.sendHostingerEmail).toHaveBeenCalledWith(
      { email: EMAIL, password: PASSWORD },
      expect.objectContaining({ to: EMAIL, subject: "[DeskcommCRM] Teste da conexão de e-mail" }),
    );
    expect(deps.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "email.test_message_accepted",
      organizationId: ORGANIZATION_ID,
      resourceId: CONNECTION_ID,
      metadata: { provider: "hostinger", smtp_accepted: true },
    }));
    expect(JSON.stringify(deps.audit.mock.calls)).not.toContain(EMAIL);
    expect(JSON.stringify(deps.audit.mock.calls)).not.toContain(PASSWORD);
  });

  it("exige administrador e não tenta enviar para quem não administra a empresa", async () => {
    deps.podeAdministrarEmpresa.mockReturnValue(false);

    await expect(sendHostingerEmailTest()).resolves.toEqual({ ok: false, error: "forbidden" });

    expect(deps.getHostingerEmailConnection).not.toHaveBeenCalled();
    expect(deps.sendHostingerEmail).not.toHaveBeenCalled();
    expect(deps.audit).not.toHaveBeenCalled();
  });

  it("recusa uma credencial que não corresponde à caixa saudável salva", async () => {
    deps.getHostingerEmailAccountForHealth.mockResolvedValue({
      state: "ready",
      credentials: { email: "outra-caixa@example.com", password: PASSWORD },
    });

    await expect(sendHostingerEmailTest()).resolves.toEqual({
      ok: false,
      error: "connection_unavailable",
    });

    expect(deps.sendHostingerEmail).not.toHaveBeenCalled();
  });

  it("mostra falha sanitizada e audita somente a categoria do erro SMTP", async () => {
    deps.sendHostingerEmail.mockResolvedValue({
      ok: false,
      error: "send_failed",
      details: "smtp_response_550",
    });

    await expect(sendHostingerEmailTest()).resolves.toEqual({ ok: false, error: "send_failed" });

    expect(deps.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "email.test_message_failed",
      metadata: { provider: "hostinger", smtp_accepted: false, failure: "send_failed" },
    }));
    expect(JSON.stringify(deps.audit.mock.calls)).not.toContain("smtp_response_550");
    expect(JSON.stringify(deps.audit.mock.calls)).not.toContain(EMAIL);
    expect(JSON.stringify(deps.audit.mock.calls)).not.toContain(PASSWORD);
  });
});
