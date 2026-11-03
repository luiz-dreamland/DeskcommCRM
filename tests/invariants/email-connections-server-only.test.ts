import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const ORGANIZATION_ID = "90000000-0000-4000-8000-000000000001";
const USER_ID = "90000000-1111-4000-8000-000000000001";
const CONNECTION_ID = "90000000-2222-4000-8000-000000000001";
const TABLE = "public.organization_email_connections";

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
    values ('${ORGANIZATION_ID}', 'email-connection-invariant', 'Email Connection Invariant', 'Email Connection Invariant')
    on conflict (id) do nothing;
    insert into auth.users (id, email)
    values ('${USER_ID}', 'email-connection-invariant@invariant.test')
    on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
    values ('${USER_ID}', '${ORGANIZATION_ID}', 'admin', now())
    on conflict do nothing;
    insert into ${TABLE} (id, organization_id, mailbox_email, mailbox_password_encrypted)
    values ('${CONNECTION_ID}', '${ORGANIZATION_ID}', 'invariant@example.test', decode('00', 'hex'))
    on conflict (organization_id) do nothing;
  `);
});

describe("credenciais de e-mail permanecem exclusivas do servidor", () => {
  it("mantém RLS ligada e não publica policies para usuários do navegador", () => {
    expect(sql(`select relrowsecurity from pg_class where oid = '${TABLE}'::regclass`)).toBe("t");
    expect(
      sql(
        "select count(*) from pg_policies where schemaname = 'public' and tablename = 'organization_email_connections'",
      ),
    ).toBe("0");
  });

  it("nega a leitura da credencial até para o admin autenticado da própria organização", () => {
    expect(() =>
      sql(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${USER_ID}"}', false);
        select mailbox_password_encrypted from ${TABLE} where organization_id = '${ORGANIZATION_ID}';
      `),
    ).toThrow(/permission denied/i);
  });

  it("mantém leitura para service_role, o único papel que usa o adapter do servidor", () => {
    expect(
      sql(`
        set role service_role;
        select count(*) from ${TABLE} where id = '${CONNECTION_ID}';
      `),
    ).toBe("1");
  });
});
