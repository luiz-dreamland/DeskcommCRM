import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyEffects: vi.fn(),
  createCursor: vi.fn(),
  getCredentials: vi.fn(),
  markConversation: vi.fn(),
  readPage: vi.fn(),
}));

vi.mock("@/lib/channels/pos-entrada", () => ({ aplicarEfeitosPosEntrada: mocks.applyEffects }));
vi.mock("@/lib/channels/marcar-conversa", () => ({ marcarConversaComMensagem: mocks.markConversation }));
vi.mock("@/lib/contacts/rotulo-do-contato", () => ({ nomeDoContato: () => "Cliente" }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email/hostinger", () => ({
  createHostingerInboxCursor: mocks.createCursor,
  readHostingerInboxPage: mocks.readPage,
}));
vi.mock("@/lib/email/hostinger-config", () => ({ getHostingerEmailCredentials: mocks.getCredentials }));

import { syncHostingerInboxes } from "./hostinger-inbox-sync";

type Row = Record<string, unknown>;

class Query {
  private operation: "select" | "insert" | "update" = "select";
  private payload: Row = {};
  private filters = new Map<string, unknown>();

  constructor(private readonly owner: FakeAdmin, private readonly table: string) {}

  select() { return this; }
  insert(value: Row) { this.operation = "insert"; this.payload = value; return this; }
  update(value: Row) { this.operation = "update"; this.payload = value; return this; }
  eq(key: string, value: unknown) { this.filters.set(key, value); return this; }
  is(key: string, value: unknown) { this.filters.set(key, value); return this; }
  not(key: string, _operator: string, value: unknown) { this.filters.set(key, value); return this; }
  or(value: string) { this.filters.set("or", value); return this; }
  filter(key: string, _operator: string, value: unknown) { this.filters.set(key, value); return this; }
  contains(key: string, value: unknown) { this.filters.set(key, value); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { return Promise.resolve(this.execute(true)); }
  single() { return Promise.resolve(this.execute(true)); }
  then(resolve: (value: { data: unknown; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve(this.execute(false)).then(resolve, reject);
  }

  private execute(single: boolean): { data: unknown; error: null } {
    return { data: this.owner.execute(this.table, this.operation, this.payload, this.filters, single), error: null };
  }
}

class FakeAdmin {
  connection: Row = {
    id: "connection-1",
    organization_id: "org-1",
    mailbox_email: "contato@dreamlab.lol",
    status: "healthy",
    inbox_sync_enabled: true,
    inbox_uid_validity: "17",
    inbox_last_uid: 5,
    inbox_claim_token: null,
    inbox_claim_until: null,
    last_sync_at: null,
  };
  contact = { id: "contact-1", name: "Cliente", display_name: "Cliente" };
  session = { id: "session-1" };
  conversation: Row | null = null;
  message: Row | null = null;
  messages: Row[] = [];
  insertedMessages: Row[] = [];
  conversationsCreated = 0;
  cursorUpdates = 0;

  from(table: string) { return new Query(this, table); }

  execute(table: string, operation: string, payload: Row, filters: Map<string, unknown>, single: boolean): unknown {
    if (table === "organization_email_connections") {
      if (operation === "select") {
        if (filters.has("inbox_claim_token")) {
          return this.connection.inbox_claim_token === filters.get("inbox_claim_token") ? { ...this.connection } : null;
        }
        return [this.connection];
      }
      if (operation === "update") {
        if (filters.get("id") !== this.connection.id || filters.get("organization_id") !== this.connection.organization_id) return single ? null : [];
        const requestedToken = filters.get("inbox_claim_token");
        if (requestedToken && this.connection.inbox_claim_token && this.connection.inbox_claim_token !== requestedToken) return single ? null : [];
        if (filters.has("inbox_uid_validity") && filters.get("inbox_uid_validity") !== this.connection.inbox_uid_validity) return single ? null : [];
        if (filters.has("inbox_last_uid") && filters.get("inbox_last_uid") !== this.connection.inbox_last_uid) return single ? null : [];
        if (payload.inbox_claim_token && this.connection.inbox_claim_token) return single ? null : [];
        if (payload.inbox_uid_validity !== undefined || payload.inbox_last_uid !== undefined) this.cursorUpdates++;
        Object.assign(this.connection, payload);
        return single ? { id: this.connection.id } : [];
      }
    }

    if (table === "channel_sessions") return single ? this.session : [this.session];
    if (table === "contacts") return single ? this.contact : [this.contact];
    if (table === "conversations") {
      if (operation === "select") {
        const metadata = this.conversation?.metadata as Row | undefined;
        const referenceFilter = filters.get("metadata");
        const reference = referenceFilter && typeof referenceFilter === "object"
          ? (referenceFilter as Row).email_references
          : undefined;
        const requiredReferences = Array.isArray(reference) ? reference : [];
        const storedReferences = Array.isArray(metadata?.email_references)
          ? metadata.email_references as unknown[]
          : [];
        const matchesReferences = requiredReferences.every((id: unknown) => storedReferences.includes(id));
        const matches = !!this.conversation
          && (!filters.has("organization_id") || this.conversation.organization_id === filters.get("organization_id"))
          && (!filters.has("contact_id") || this.conversation.contact_id === filters.get("contact_id"))
          && (!filters.has("channel_session_id") || this.conversation.channel_session_id === filters.get("channel_session_id"))
          && (!filters.has("channel") || this.conversation.channel === filters.get("channel"))
          && (!filters.has("is_group") || this.conversation.is_group === filters.get("is_group"))
          && (!filters.has("metadata->>email_thread_root_id") || metadata?.email_thread_root_id === filters.get("metadata->>email_thread_root_id"))
          && matchesReferences
          && (!filters.has("provider_conversation_id") || this.conversation.provider_conversation_id === filters.get("provider_conversation_id"));
        return single ? (matches ? { ...this.conversation } : null) : matches ? [{ ...this.conversation }] : [];
      }
      if (operation === "insert") {
        this.conversation = {
          ...payload,
          id: "conversation-1",
        };
        this.conversationsCreated++;
        return single ? { ...this.conversation } : [this.conversation];
      }
      if (operation === "update" && this.conversation) Object.assign(this.conversation, payload);
    }
    if (table === "messages") {
      if (operation === "select") {
        if (filters.has("id")) {
          const match = this.messages.find((message) => message.id === filters.get("id")) ?? null;
          return single ? (match ? { metadata: match.metadata } : null) : match ? [match] : [];
        }
        if (filters.has("metadata->>email_message_id_key")) {
          const match = this.messages.find((message) =>
            (message.metadata as Row).email_message_id_key === filters.get("metadata->>email_message_id_key"),
          ) ?? null;
          return single ? match : match ? [match] : [];
        }
        if (filters.has("external_id")) {
          const match = this.messages.find((message) => message.external_id === filters.get("external_id")) ?? null;
          return single ? match : match ? [match] : [];
        }
      }
      if (operation === "insert") {
        this.message = {
          id: "message-1",
          ...payload,
        };
        this.messages.push(this.message);
        this.insertedMessages.push(this.message);
        return single ? this.message : [this.message];
      }
      if (operation === "update") {
        const match = this.messages.find((message) => message.id === filters.get("id"));
        if (match) Object.assign(match, payload);
        if (match) this.message = match;
        return single ? (match ? { ...match } : null) : match ? [match] : [];
      }
    }
    return single ? null : [];
  }
}

const credentials = { email: "contato@dreamlab.lol", password: "not-a-real-secret" };
const inbound = {
  uid: 6,
  untrusted: true as const,
  internalDate: "2026-11-04T12:00:00.000Z",
  messageId: "<msg-6@example.test>",
  inReplyTo: null,
  references: [],
  from: "lead@example.net",
  fromName: "Lead Exemplo",
  subject: "Uma pergunta",
  text: "Quero saber mais sobre o serviço.",
  contentState: "available" as const,
};

function readyPage() {
  return {
    state: "ready" as const,
    uidValidity: "17",
    messages: [inbound],
    proposedCursor: { uidValidity: "17", lastUid: 6 },
  };
}

describe("sincronização idempotente da caixa Hostinger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCredentials.mockResolvedValue(credentials);
    mocks.readPage.mockResolvedValue(readyPage());
    mocks.createCursor.mockResolvedValue({ uidValidity: "18", lastUid: 100 });
    mocks.markConversation.mockResolvedValue(undefined);
    mocks.applyEffects.mockResolvedValue(undefined);
  });

  it("persiste e despacha a mensagem antes de avançar o cursor", async () => {
    const admin = new FakeAdmin();
    const result = await syncHostingerInboxes(admin as never);

    expect(result).toEqual({ scanned: 1, inserted: 1, duplicates: 0, skipped: 0, errors: 0 });
    expect(admin.connection.inbox_last_uid).toBe(6);
    expect(admin.cursorUpdates).toBe(1);
    expect(admin.insertedMessages).toHaveLength(1);
    expect(admin.message?.metadata).toMatchObject({
      email_inbound_effects_status: "completed",
      external_content_untrusted: true,
      email_message_id_key: "<msg-6@example.test>",
    });
    expect(mocks.applyEffects).toHaveBeenCalledWith(admin, expect.objectContaining({
      canal: "email",
      origem: "hostinger_imap",
      despachoIdempotente: true,
      despachoObrigatorio: true,
      texto: inbound.text,
    }));
  });

  it("retoma os efeitos pendentes sem duplicar mensagem nem avançar após falha", async () => {
    const admin = new FakeAdmin();
    mocks.applyEffects.mockRejectedValueOnce(new Error("dispatch temporarily failed"));

    const failed = await syncHostingerInboxes(admin as never);
    expect(failed).toMatchObject({ inserted: 0, errors: 1 });
    expect(admin.connection.inbox_last_uid).toBe(5);
    expect((admin.message?.metadata as Row).email_inbound_effects_status).toBe("pending");
    expect(admin.cursorUpdates).toBe(0);
    expect(admin.insertedMessages).toHaveLength(1);

    const retried = await syncHostingerInboxes(admin as never);
    expect(retried).toEqual({ scanned: 1, inserted: 0, duplicates: 1, skipped: 0, errors: 0 });
    expect(admin.connection.inbox_last_uid).toBe(6);
    expect((admin.message?.metadata as Row).email_inbound_effects_status).toBe("completed");
    expect(admin.cursorUpdates).toBe(1);
    expect(admin.insertedMessages).toHaveLength(1);
    expect(mocks.applyEffects).toHaveBeenCalledTimes(2);
  });

  it("mantém respostas RFC na mesma conversa e acumula referências", async () => {
    const admin = new FakeAdmin();
    const reply = {
      ...inbound,
      uid: 7,
      messageId: "<msg-7@example.test>",
      inReplyTo: "<msg-6@example.test>",
      references: ["<msg-6@example.test>"],
      subject: "Re: Uma pergunta",
    };
    mocks.readPage.mockResolvedValue({
      ...readyPage(),
      messages: [inbound, reply],
      proposedCursor: { uidValidity: "17", lastUid: 7 },
    });

    const result = await syncHostingerInboxes(admin as never);

    expect(result).toEqual({ scanned: 1, inserted: 2, duplicates: 0, skipped: 0, errors: 0 });
    expect(admin.connection.inbox_last_uid).toBe(7);
    expect(admin.conversationsCreated).toBe(1);
    expect(admin.insertedMessages.map((message) => message.conversation_id)).toEqual([
      "conversation-1",
      "conversation-1",
    ]);
    expect((admin.conversation?.metadata as Row).email_references).toEqual([
      "<msg-6@example.test>",
      "<msg-7@example.test>",
    ]);
  });

  it("quando UIDVALIDITY muda, pula o histórico e ancora no UID mais recente", async () => {
    const admin = new FakeAdmin();
    mocks.readPage.mockResolvedValue({
      state: "uid_validity_changed",
      previousCursor: { uidValidity: "17", lastUid: 5 },
      observedUidValidity: "18",
    });

    const result = await syncHostingerInboxes(admin as never);

    expect(result).toEqual({ scanned: 1, inserted: 0, duplicates: 0, skipped: 1, errors: 0 });
    expect(admin.connection).toMatchObject({
      inbox_uid_validity: "18",
      inbox_last_uid: 100,
      last_error_code: "email_uid_validity_reset_skipped_history",
    });
    expect(admin.cursorUpdates).toBe(1);
    expect(admin.insertedMessages).toHaveLength(0);
    expect(mocks.applyEffects).not.toHaveBeenCalled();
  });
});
