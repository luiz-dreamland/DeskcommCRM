import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const REPO_DREAMLAND = "luiz-dreamland/DeskcommCRM";
const GUIAS_DE_INSTALACAO = [
  "README.md",
  "docs/deploy-selfhost/README.md",
  "docs/deploy-hostgator/README.md",
  "docs/saas/coolify.md",
  "docs/runbooks/remediar-worker-congelado.md",
  "hostgator-setup-kit/README.md",
  "hostgator-setup-kit/CLAUDE.md",
  "hostgator-setup-kit/diagnostico.sh",
  "scripts/instalar-guias.sh",
];

describe("fontes de instalação do Dreamland CRM", () => {
  it("clona e baixa os diagnósticos somente do fork Dreamland", () => {
    for (const arquivo of GUIAS_DE_INSTALACAO) {
      const conteudo = readFileSync(join(ROOT, arquivo), "utf8");
      expect(conteudo, arquivo).toContain(REPO_DREAMLAND);
      expect(conteudo, arquivo).not.toMatch(
        /(?:git clone[^\r\n]*github\.com|curl[^\r\n]*raw\.githubusercontent\.com)\/melgarafael\/DeskcommCRM/,
      );
    }
  });
});
