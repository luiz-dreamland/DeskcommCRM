-- manifest: O upsert normal e a importação de conversas WhatsApp inferem o índice parcial real, que exclui e-mails (9089).

-- `uniq_conversations_1to1_per_contact_session` só cobre conversas não-grupo
-- cujo canal é distinto de email. A inferência do `ON CONFLICT` precisa
-- declarar o mesmo predicado; `is_group = false` sozinho não identifica esse
-- índice e o PostgreSQL devolve 42P10 antes de importar a primeira conversa.
-- O caminho continua apenas para WhatsApp, sem alterar a chave nem o tratamento
-- das conversas de email, que têm índice próprio por fio RFC.
create or replace function public.fn_upsert_wa_conversation(
  p_org uuid, p_contact uuid, p_session uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.conversations
    (organization_id, contact_id, channel_session_id, channel, status, is_group, unread_count_for_assignee, metadata)
  values (p_org, p_contact, p_session, 'whatsapp', 'open', false, 0, '{}'::jsonb)
  on conflict (organization_id, contact_id, channel_session_id)
    where is_group = false and channel is distinct from 'email'
  do update set updated_at = now()
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.fn_upsert_wa_conversation_importada(
  p_org uuid, p_contact uuid, p_session uuid, p_last_message_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $fn$
declare v_id uuid;
begin
  select c.id into v_id
    from public.conversations c
   where c.organization_id = p_org and c.contact_id = p_contact
     and c.channel_session_id = p_session and c.is_group = false;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.conversations
    (organization_id, contact_id, channel_session_id, channel, status, is_group, unread_count_for_assignee, metadata, last_message_at)
  values (p_org, p_contact, p_session, 'whatsapp', 'closed', false, 0, '{}'::jsonb, p_last_message_at)
  on conflict (organization_id, contact_id, channel_session_id)
    where is_group = false and channel is distinct from 'email'
  do nothing
  returning id into v_id;

  if v_id is null then
    select c.id into v_id
      from public.conversations c
     where c.organization_id = p_org and c.contact_id = p_contact
       and c.channel_session_id = p_session and c.is_group = false;
  end if;
  return v_id;
end; $fn$;

comment on function public.fn_upsert_wa_conversation_importada(uuid, uuid, uuid, timestamptz) is
  'Irmã de fn_upsert_wa_conversation para o importador de histórico do WhatsApp (#999): devolve a conversa 1:1 existente sem tocar nela, ou cria uma closed e sem dono. A inferência do ON CONFLICT corresponde ao índice parcial de canais não-email. Só service_role.';

revoke all on function public.fn_upsert_wa_conversation_importada(uuid, uuid, uuid, timestamptz) from public;
revoke execute on function public.fn_upsert_wa_conversation_importada(uuid, uuid, uuid, timestamptz) from anon, authenticated;
grant execute on function public.fn_upsert_wa_conversation_importada(uuid, uuid, uuid, timestamptz) to service_role;
revoke all on function public.fn_upsert_wa_conversation(uuid, uuid, uuid) from public;
revoke execute on function public.fn_upsert_wa_conversation(uuid, uuid, uuid) from anon, authenticated;
grant execute on function public.fn_upsert_wa_conversation(uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
