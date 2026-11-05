# Zoe CRM Copilot

## Objetivo

Dar à equipe uma conversa direta com a Zoe dentro do DeskcommCRM. A conversa chama o gateway n8n configurado pela organização e permite pedir pesquisa comercial, planejamento e esclarecimento de uma oportunidade.

## Fluxo

1. Um `manager` abre **IA → Zoe**, escolhe o grupo comercial, marketing ou geral e envia uma pergunta conscientemente.
2. A API resolve a organização e a pessoa pela sessão, valida o limite de uso e carrega a conexão da organização pelo servidor.
3. O servidor decifra o cabeçalho de autorização em memória e chama somente o endpoint `/webhook/zoe/crm/ask` em HTTPS.
4. A memória do n8n é isolada por organização, pessoa, empresa e conversa; o CRM recebe a resposta como texto simples.
5. A pergunta e a resposta ficam no navegador atual; o audit registra contexto e latência, nunca o conteúdo.

## Segurança e limites

- A conexão é configurada por `admin`; o Bearer é cifrado com `fn_encrypt_oauth`, nunca volta ao navegador e nunca aparece em logs ou auditoria.
- O endpoint exige HTTPS, caminho exato e domínio Dreamland ou Tailscale permitido. Redirecionamentos são recusados.
- O pedido só usa a empresa configurada para a organização. O `chat_id` encaminhado ao n8n é um UUID HMAC determinístico derivado de organização, operador, empresa e id da conversa.
- Rate limit de 8 chamadas por operador e 40 por organização a cada minuto; timeout de 55 segundos e sem repetição automática.
- As ferramentas CRM da Zoe são somente leitura. O chat não cria/edita registros, não envia mensagens a leads e não publica ou compra anúncios.
- A UI informa que perguntas vão ao n8n/modelo conectado. O histórico local é separado por organização, usuário e empresa, limitado às 80 mensagens recentes.

## Estado operacional

A integração só funciona quando a migration estiver aplicada no banco da instalação e um `admin` salvar o endereço e o cabeçalho Bearer da credencial Header Auth do n8n. Implementação local não significa conexão ativa ou resposta real validada.
