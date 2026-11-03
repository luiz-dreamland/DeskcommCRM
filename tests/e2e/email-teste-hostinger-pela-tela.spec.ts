import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect } from "./helpers/test";
import { lerCreds, loginComoAdmin, type CredsE2E } from "./helpers/login-admin";
import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";

interface CredsDoTeste extends CredsE2E {
  org_id: string;
}

const creds = lerCreds() as CredsDoTeste;
const supabase = credenciaisSupabaseDeTeste();
const db = createClient(supabase.url, supabase.serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const mailbox = "qa-email@deskcomm.test";
const evidencia = path.join(process.cwd(), "evidence", "email-teste-hostinger");
let fixtureCriada = false;

test.beforeAll(async () => {
  if (!creds.org_id) throw new Error("organização E2E ausente em .e2e-creds.json");
  fs.mkdirSync(evidencia, { recursive: true });

  const { data: existente, error: leituraErro } = await db
    .from("organization_email_connections")
    .select("id")
    .eq("organization_id", creds.org_id)
    .maybeSingle();
  if (leituraErro) throw new Error(`ler fixture de e-mail E2E: ${leituraErro.code}`);
  if (existente) throw new Error("a organização E2E já tem uma conexão de e-mail");

  const { data: senhaCifrada, error: cifraErro } = await db.rpc("fn_encrypt_oauth", {
    plaintext: "credencial-sintetica-que-nao-sera-usada",
  });
  if (cifraErro || !senhaCifrada) {
    throw new Error(`cifrar fixture de e-mail E2E: ${cifraErro?.code ?? "resultado vazio"}`);
  }

  const { error: insercaoErro } = await db.from("organization_email_connections").insert({
    organization_id: creds.org_id,
    provider: "hostinger",
    mailbox_email: mailbox,
    mailbox_password_encrypted: senhaCifrada,
    status: "healthy",
    outbound_automation_enabled: false,
    inbox_sync_enabled: false,
  } as never);
  if (insercaoErro) throw new Error(`criar fixture de e-mail E2E: ${insercaoErro.code}`);
  fixtureCriada = true;
});

test.afterAll(async () => {
  if (!fixtureCriada) return;
  const { error } = await db
    .from("organization_email_connections")
    .delete()
    .eq("organization_id", creds.org_id)
    .eq("mailbox_email", mailbox);
  if (error) throw new Error(`limpar fixture de e-mail E2E: ${error.code}`);
});

test("admin confirma o destinatário antes de autorizar o teste da caixa", async ({ page }) => {
  await loginComoAdmin(page, creds);
  await page.goto("/app/connections");
  await page.getByRole("link", { name: "Configurar e-mail" }).click();
  await page.waitForURL(/\/app\/settings\/email/);

  await expect(page.getByRole("heading", { level: 1 })).toContainText("E-mail comercial");
  await expect(page.getByRole("button", { name: "Enviar e-mail de teste" })).toBeVisible();
  await expect(page.getByText(new RegExp(mailbox))).toBeVisible();

  await page.getByRole("button", { name: "Enviar e-mail de teste" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(`Enviar teste para ${mailbox}?`);
  await expect(dialog).toContainText("não inicia campanha nem contata leads");
  await page.screenshot({ path: path.join(evidencia, "confirmacao.png"), fullPage: true });

  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enviar e-mail de teste" })).toBeVisible();
});
