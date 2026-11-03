import { describe, expect, it } from "vitest";

import { repositorioDoGitHub } from "../../scripts/cortar-release";

describe("origem dos links de release", () => {
  it("prioriza o repositório informado pelo GitHub Actions", () => {
    expect(
      repositorioDoGitHub(
        "luiz-dreamland/DeskcommCRM",
        "https://github.com/melgarafael/DeskcommCRM.git",
      ),
    ).toBe("luiz-dreamland/DeskcommCRM");
  });

  it.each([
    ["https://github.com/luiz-dreamland/DeskcommCRM.git", "luiz-dreamland/DeskcommCRM"],
    ["git@github.com:luiz-dreamland/DeskcommCRM.git", "luiz-dreamland/DeskcommCRM"],
  ])("usa o remoto origin local: %s", (remoto, esperado) => {
    expect(repositorioDoGitHub(undefined, remoto)).toBe(esperado);
  });

  it("não aceita valores arbitrários nem remotos que não sejam do GitHub", () => {
    expect(
      repositorioDoGitHub("luiz dreamland/DeskcommCRM", "https://example.com/other/repo.git"),
    ).toBe("luiz-dreamland/DeskcommCRM");
  });
});
