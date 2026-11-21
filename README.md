# Ethos Tribo

Aplicação responsiva e instalável para organizar os encontros da comunidade, com API Node/Express e banco Supabase/PostgreSQL.

## Requisitos

- Node.js 20 ou superior.
- npm.
- Projeto Supabase com Auth por e-mail habilitado.

## Configuração local

Crie `.env` na raiz copiando `.env.example` e preencha as variáveis. O Node carrega `.env`, não `.env.example`:

```env
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_SECRET_KEY=sua_chave_secret
SUPABASE_ANON_KEY=sua_chave_anon_ou_publishable
APP_URL=http://localhost:5173
OWNER_EMAIL=email-do-murilo@example.com
```

Em produção na Vercel, a API valida a origem com base no host HTTPS da própria requisição, inclusive em URLs de Preview. `APP_URL` é usado pelo script de convite do owner para montar o link; ao executar esse script localmente, informe a URL pública desejada. Em desenvolvimento, a API aceita origens HTTP locais (`localhost`, `127.0.0.1` e `::1`) para que o Vite possa iniciar em outra porta se a 5173 estiver ocupada.

Obtenha as chaves em **Supabase → Project Settings → API Keys**. A chave `anon`/`publishable` é usada pelo servidor para validar o login de organizador. A `secret` é usada apenas pelo servidor para acessar o banco e pela Auth Admin API. A chave Anthropic e o modelo não são usados por este app; o número de WhatsApp e o Pix padrão são configurados pela tela **Organizadores** do owner.

**Nunca** coloque `SUPABASE_SECRET_KEY` no SQL Editor, no frontend ou em variável `VITE_*`/`NEXT_PUBLIC_*`. O arquivo `.env` é ignorado pelo Git.

## Criar o schema e conectar

No **SQL Editor** do Supabase, execute nesta ordem:

1. [`supabase/001_ethos_schema.sql`](./supabase/001_ethos_schema.sql) — tabelas, índices, RLS e funções centrais.
2. [`supabase/004_backend_integration.sql`](./supabase/004_backend_integration.sql) — sessões de participantes/organizadores e RPCs consumidas pela API.
3. [`supabase/005_event_modalities.sql`](./supabase/005_event_modalities.sql) — migração de eventos legados para o catálogo de modalidades (pode ser executada em instalação nova).
4. [`supabase/006_modality_lifecycle.sql`](./supabase/006_modality_lifecycle.sql) — arquivamento, mesclagem e exclusão segura de modalidades.
5. [`supabase/007_fix_leave_occurrence_promotion.sql`](./supabase/007_fix_leave_occurrence_promotion.sql) — corrige a promoção da lista de espera ao sair de uma vaga confirmada.

Em bancos já existentes, execute `005` antes de `006`. A migração `006` é aditiva e repetível; para revertê-la, primeiro reverta o código da aplicação, reative os registros arquivados e siga os comandos de rollback anotados no próprio arquivo.

Antes de aplicar a migração `007` em produção, faça ou confirme um backup recente do banco pelo painel do Supabase. Depois, abra **SQL Editor**, execute o conteúdo inteiro de `007_fix_leave_occurrence_promotion.sql` e confirme que terminou sem erro. Ela apenas substitui a função `leave_occurrence(uuid, uuid)` e reafirma suas permissões; não altera nem apaga registros. A operação é idempotente. Para conferir a definição instalada, execute:

```sql
select pg_get_functiondef('public.leave_occurrence(uuid, uuid)'::regprocedure);
```

O resultado deve chamar `public.promote_next_waitlisted(...)` ao remover uma inscrição confirmada. Não é necessário reaplicar `001` nem executar alterações manuais em inscrições.

Em **Authentication → Providers**, habilite o provedor **Email**. Depois, configure o `.env`, instale as dependências e inicie a aplicação:

```powershell
npm install
npm run dev
```

Abra `http://localhost:5173`. Cadastro de participantes, autenticação de organizadores, sessões, eventos, inscrições, configurações e auditoria passam a persistir no Supabase. Para verificar a conexão, abra `http://localhost:3001/api/health`; quando conectado, a resposta inclui `"database":"supabase"`.

### Logs e rastreabilidade

O terminal que executa `npm run dev` mostra cada requisição da API em JSON, com horário, método, rota, status HTTP, duração e `requestId`. Erros incluem código, mensagem filtrada e stack para apontar o arquivo/linha; eventos de cadastro, login, convites e recorrência ajudam a acompanhar etapas do fluxo. O identificador também é retornado no cabeçalho `X-Request-Id`; use-o para localizar as linhas relacionadas à mesma requisição.

Os logs não devem registrar senhas, PINs, cookies, e-mails ou tokens. O link de convite de owner continua sendo mostrado uma única vez pelo comando que o gera, porque é necessário para concluir o fluxo; trate-o como segredo e não compartilhe a saída do terminal.

## Criar o primeiro owner

Defina `OWNER_EMAIL` no `.env` e execute:

```powershell
npm run owner:invite
```

O comando cria no Supabase um convite de owner com token armazenado somente como hash e imprime o link uma única vez. Envie-o diretamente ao Murilo; ele define a própria senha pelo fluxo do Supabase Auth. O convite expira em 7 dias e só pode ser usado uma vez.

O endpoint de convite de admins já está conectado ao Supabase. O owner inicial é criado pelo script, nunca por cadastro público.

Cadastros comuns usam telefone e PIN na tabela `people`, sem conta no Supabase Auth; por isso, o e-mail de um participante pode ser usado também no convite de admin. Ao aceitar o convite, a pessoa define a senha do acesso de organizador. Se já existir uma identidade Auth sem vínculo com organizador, o convite permite definir a senha para ela; identidades já vinculadas a organizadores não têm a senha alterada. O acesso de participante continua separado.

Como alternativa manual, use [`supabase/002_initial_owner_invite.sql`](./supabase/002_initial_owner_invite.sql), trocando `REPLACE_WITH_MURILO_EMAIL`. Use **um único método** para gerar o convite inicial.

## Recorrência automática

O backend verifica a criação de novas ocorrências ao iniciar e a cada hora. Opcionalmente, ative `pg_cron` e execute [`supabase/003_schedule_recurring.sql`](./supabase/003_schedule_recurring.sql) para agendar a mesma função no banco. A função é idempotente.

## Build e produção

```powershell
npm run build
$env:NODE_ENV = "production"
npm start
```

Na Vercel, a regra em `vercel.json` encaminha qualquer profundidade em `/api/*` para a única função `api/index.js`, que restaura o caminho original antes de passá-lo ao Express. Cadastre em **Settings → Environment Variables**:

- `SUPABASE_URL`, `SUPABASE_SECRET_KEY` e `SUPABASE_ANON_KEY` para **Production** e **Preview**. São valores do projeto Supabase; a chave `secret` deve permanecer server-side e nunca receber prefixo `VITE_`.
- `APP_URL` não é necessária para as requisições da aplicação na Vercel. Use-a no `.env` local quando executar `npm run owner:invite`, para o convite apontar ao domínio desejado.

Depois de cadastrar ou alterar variáveis, faça um novo deploy. A Vercel fornece `NODE_ENV` e o runtime de funções; `PORT` é usado apenas quando o Express roda como servidor tradicional. Confirme a conexão em `https://<seu-dominio>/api/health`.

### Smoke test de API na Vercel

Depois que o deploy de **Preview** terminar, execute o smoke contra a URL atribuída pela Vercel:

```powershell
npm run smoke -- https://<url-do-preview>
```

O comando percorre os métodos e caminhos usados pelo front-end, incluindo rotas aninhadas, e exige resposta JSON e o header `x-request-id`. Ele aceita erros de autenticação nas rotas protegidas e verifica também que uma rota desconhecida retorna 404 JSON do app e que um método incorreto retorna 405 JSON do app. As rotas de relatório XLSX de modalidade e de evento também são verificadas sem sessão. As rotas públicas de login recebem apenas placeholders inválidos; o teste não cria nem altera eventos ou inscrições.

Se o Preview exigir proteção da Vercel, configure localmente `VERCEL_AUTOMATION_BYPASS_SECRET` com o segredo de **Protection Bypass for Automation** do projeto antes de executar o comando. O smoke envia esse valor no header recomendado pela Vercel e não o imprime nem o salva no repositório.

Para executar também os logins reais, defina localmente as variáveis `SMOKE_PERSON_PHONE`, `SMOKE_PERSON_PIN`, `SMOKE_ORGANIZER_EMAIL`, `SMOKE_ORGANIZER_PASSWORD` e `SMOKE_OCCURRENCE_ID` com uma conta de teste dedicada e uma ocorrência futura aberta, de uma série ativa. Não grave esses valores em arquivos versionados. O fluxo autenticado verifica que participante recebe 403 e organizador consegue baixar o XLSX da modalidade e somente do evento selecionado. As verificações de `join`, `leave` em vaga confirmada, remoção pelo organizador e recarregamento do detalhe são operações mutáveis: só são executadas se também definir `SMOKE_RUN_MUTATIONS=1`. Para habilitá-las, a ocorrência de teste também precisa estar antes do horário de fechamento, ter vaga confirmada livre, e a pessoa de teste ainda não pode estar inscrita. O script tenta remover a inscrição de teste ao terminar ou após falha; não use contas ou ocorrências reais de usuários.

Os relatórios são gerados em memória com ExcelJS: o botão nos detalhes baixa somente o evento aberto, enquanto os botões de modalidade incluem as ocorrências abertas de hoje em diante, ainda não encerradas e pertencentes a séries ativas. Os downloads são restritos a organizadores; cada exportação é registrada no Histórico de ações. Exportações com 5.000 ou mais inscrições recebem aviso na conclusão e log de alerta, pois a geração pode atingir o limite de tempo da função serverless da Vercel. Não é necessária migration: `registrations.paid_at` já armazena a data de pagamento.

Promova para produção somente depois de o smoke passar no Preview. Opcionalmente, adicione esse comando a um workflow de GitHub Actions que rode após a criação do deploy de Preview, usando a URL do deployment como entrada e bloqueando a promoção se houver falha; essa automação não está ativada por este projeto.

Antes do primeiro uso, aplique no projeto Supabase as migrações `001`, `004`, `005`, `006` e `007`, nesta ordem, e crie o convite do owner com `npm run owner:invite` usando `OWNER_EMAIL` local. Use HTTPS para habilitar o atributo `Secure` dos cookies.

## Notas de migração

- Esta versão não migra automaticamente dados que tenham sido criados anteriormente no SQLite. Se existir algum dado local importante, exporte e migre-o com um procedimento separado antes de remover o banco local.
- O PIN de participantes permanece armazenado como hash bcrypt em `people`; as senhas dos organizadores ficam sob responsabilidade do Supabase Auth.
- A aplicação usa uma sessão opaca longa em cookie `HttpOnly`, com o hash do token guardado em `sessions`.
- RLS protege o acesso direto às tabelas. A API usa a secret key no servidor e valida autenticação e papel antes das operações; operações críticas de inscrição e promoção usam RPCs transacionais.
- E-mail de redefinição de senha do organizador, pagamento automático, notificações e recursos fora do escopo continuam não implementados.
- As configurações de contato e chave Pix padrão são editáveis pela tela de owner. Configure-as antes de participantes dependerem do contato de desistência.
#   p r o j e t o - e t h o s - c o m u n i d a d e  
 