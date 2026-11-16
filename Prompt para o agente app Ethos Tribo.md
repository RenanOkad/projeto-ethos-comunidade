# Prompt para o agente: app Ethos Tribo

Copie tudo abaixo da linha e cole no seu agente. Referência visual: wireframe de alta fidelidade em https://claude.ai/artifact/BSqDfvWjhL3LMi2nddPUu9 (16 telas; siga-o como guia de layout, cores e textos).

---

## 1. Missão

Você vai construir o **Ethos Tribo**, um site responsivo (mobile-first, instalável como PWA) para uma comunidade que reúne pessoas de vários nichos (dança, trilhas, ciclismo, futsal, vôlei de quadra, vôlei de areia e outros) e promove eventos recorrentes e sazonais. O grupo existe para desconectar do mundo e viver o mais natural possível: o app deve ser **calmo, simples, rápido e acolhedor**, sem excesso de recursos.

O problema que o app resolve: os integrantes entram numa **lista de inscrição** de cada evento, veem **quem já pagou e quem ainda não**, e os organizadores controlam vagas, lista de espera e pagamentos sem planilhas e mensagens soltas.

O uso será quase todo **pelo celular**. Projete primeiro para 360 a 430 px de largura e depois adapte para telas maiores.

## 2. Princípios de produto

1. **Pouquíssimo atrito.** Cadastro em cerca de 20 segundos. Depois disso, o participante abre o app e já vê os eventos, sem digitar nada.
2. **Clareza acima de tudo.** O status "Pago" e "Pendente" deve ser entendido em um segundo, inclusive ao sol e por quem tem daltonismo (cor + ícone + texto).
3. **Prestativo.** Toda tela vazia, erro, evento lotado ou prazo encerrado explica o que aconteceu e o que a pessoa pode fazer em seguida. Nunca deixe a pessoa sem saída.
4. **Confiança e privacidade.** O telefone é dado pessoal (LGPD): só owner e admins o veem.
5. **Tom de voz:** português do Brasil, caloroso e direto, sem gíria exagerada e sem jargão técnico.
6. **Entregue o essencial bem feito.** Não invente funcionalidades fora deste documento. Se algo estiver ambíguo, escolha a opção mais simples, registre a suposição e siga (veja a seção 14).

## 3. Papéis e permissões

| Ação                                               | Participante                    | Admin    | Owner    |
| ---------------------------------------------------- | ------------------------------- | -------- | -------- |
| Cadastrar-se, entrar com telefone e PIN              | sim                             | não usa | não usa |
| Ver eventos, listas, selos de pago e nomes completos | sim                             | sim      | sim      |
| Entrar e sair da lista (respeitando o prazo)         | sim, só a própria inscrição | sim      | sim      |
| Ver telefone das pessoas                             | não                            | sim      | sim      |
| Marcar e desmarcar pagamento                         | não                            | sim      | sim      |
| Criar, editar e encerrar eventos                     | não                            | sim      | sim      |
| Remover inscrito de um evento                        | não                            | sim      | sim      |
| Redefinir PIN de uma pessoa                          | não                            | sim      | sim      |
| Remover pessoa do sistema                            | não                            | sim      | sim      |
| Ver histórico de ações                            | não                            | sim      | sim      |
| Convidar, listar e remover admins                    | não                            | não     | sim      |
| Alterar o WhatsApp padrão de contato                | não                            | não     | sim      |

- **Participante** entra com telefone + PIN. **Admin e owner** entram com **e-mail + senha**, na mesma tela de login do organizador. O papel vem do cadastro, não de um campo que o usuário escolhe.
- O **owner** é o Murilo. Ele é criado pelo desenvolvedor (seed) e cria os admins. Admin **não** cria nem remove outros admins.
- O sistema **nunca pode ficar sem owner**: impeça remover ou rebaixar o último owner.
- **Toda checagem de permissão acontece no servidor** (e no banco, com RLS ou equivalente). Esconder botão na tela não é segurança.

## 4. Identidade visual

A logo é um círculo duplo com uma chama sobre lenha cruzada e o texto "ethos tribo", em **verde-floresta e off-white**. A paleta transmite natureza, calma e fogueira.

**Cores (tokens)**

| Token                | Hex                             | Uso                                                                                                  |
| -------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `--verde`          | `#1B4F1F`                     | Cor da marca, botões primários, selo "Pago", filtros ativos, faixa superior de 6 px, bloco da logo |
| `--fundo`          | `#F3F1E7`                     | Fundo das telas (off-white quente)                                                                   |
| `--tinta`          | `#1A261B`                     | Texto principal                                                                                      |
| `--tinta-2`        | `#4A505A`                     | Texto secundário e legendas                                                                         |
| `--superficie`     | `#FFFFFF`                     | Cards e inputs                                                                                       |
| `--borda`          | `#E3E0D8`                     | Bordas de cards e divisores                                                                          |
| `--borda-input`    | `#8A9099`                     | Borda de campos                                                                                      |
| `--destaque-suave` | `#E8EBDD`                     | Cards informativos e avisos neutros                                                                  |
| `--cinza-pendente` | `#E9EBEE` (texto `#4A505A`) | Selo "Pendente" e "Espera"                                                                           |
| `--tag`            | `#ECE9E1`                     | Etiquetas "Semanal", "Sazonal", "Admin", "Owner"                                                     |
| `--perigo`         | `#8A1C1C`                     | Só ações destrutivas (remover pessoa)                                                             |

- Todo texto precisa de contraste mínimo 4,5:1 (3:1 acima de 24 px). Os pares acima já passam; confira qualquer cor nova.
- **Pago = verde sólido com texto branco + ícone de check.** **Pendente = cinza com ícone de círculo vazio + texto.** Nunca diferencie só por cor.
- A logo é branca sobre verde: use sempre sobre o bloco `--verde` (cantos 20 px). Nas telas internas use só o **emblema** (chama) pequeno, 44×44 px, cantos 12 px. Os arquivos da logo completa e do emblema serão fornecidos; se vierem sem fundo transparente, mantenha-os sobre o verde. Peça o SVG se possível.

**Tipografia:** Inter (400, 600, 700), com fallback `system-ui, sans-serif`. Título de tela 26 px (22 px em telas internas), subtítulo 16 px, corpo 14 a 16 px, legendas 12 a 13 px. Campos de formulário com 16 px (evita zoom no iPhone).

**Forma e espaço:** botões com 14 px de raio e altura 52 px (secundários 48 px); cards 16 px de raio com borda `--borda`; inputs 12 px de raio e 48 px de altura; filtros e chips em pílula (999 px). Alvos de toque de pelo menos 44 px. Espaçamento entre blocos de 16 px; margem lateral de 20 px.

**Botões:** primário (fundo verde, texto branco), secundário (contorno verde, fundo transparente), texto sublinhado para ações leves, e destrutivo (fundo `--perigo`). Filtros: pílula com borda; ativo = fundo verde e texto branco.

**Ícones:** SVG de traço, nunca emoji. Todo botão só com ícone tem `aria-label`.

## 5. Estrutura de navegação

**Participante** (barra inferior fixa com 3 abas): **Eventos**, **Meus eventos**, **Perfil**. As telas de cadastro e entrada ficam fora da barra.

**Organizador** (admin e owner): painel com atalhos para **Eventos** (padrão), **Pessoas** e, só para o owner, **Organizadores**. Em telas maiores, use menu lateral e listas em tabela; no celular, cards empilhados.

**Desktop e tablet:** o participante vê o mesmo layout centralizado numa coluna de até 480 px, com a barra inferior mantida. O painel do organizador usa a largura (até 1100 px) com lista de inscritos em duas colunas ou tabela, porque é onde mais se trabalha em tela grande.

## 6. Telas do participante

**P1. Cadastro** (primeira visita). Bloco verde com a logo completa; título "Bem-vindo à Ethos Tribo!"; texto curto explicando que é feito uma vez só. Campos: *Nome completo*, *Telefone (WhatsApp)* com máscara brasileira, *PIN de 6 dígitos* (campo numérico mascarado, que o próprio usuário escolhe). Texto de apoio: "O PIN serve para entrar em outro aparelho. Seu telefone fica visível só para os organizadores." Botão "Criar cadastro" e link "Já tenho cadastro". Ao concluir, o usuário já está logado neste aparelho e vai para Eventos.

**P2. Entrar.** Logo, "Entrar", telefone + PIN, botão "Entrar", cartão "Esqueceu o PIN? Fale com um organizador da Ethos Tribo. Ele redefine e você escolhe um novo." e link para criar cadastro. No aparelho de sempre a pessoa **entra sozinha**, sem ver essa tela.

**P3. Eventos.** Cabeçalho com saudação e emblema. Filtros por modalidade (gerados a partir das modalidades dos eventos ativos; "Todos" é o padrão). Cards dos próximos eventos, ordenados por data. Cada card: nome (ex.: "Vôlei de quadra" e "Vôlei de areia" são eventos distintos), etiqueta **Semanal** ou **Sazonal**, `Sáb 14/11 · 16h–18h · 2h · local`, vagas (`12 de 16`), valor, e o estado do usuário: *"Você está na lista"* (selo), botão **"Quero participar"** ou, se lotado, selo "Lotado" e botão **"Entrar na lista de espera"**. Se o prazo já passou, mostre "Inscrições encerradas" sem botão. Estado vazio: "Nenhum evento aberto agora. Volte em breve."

**P4. Meus eventos.** Abas *Próximos* e *Anteriores*. Um card por inscrição com nome, data/hora/duração, local e selo de status: **Pago**, **Pendente** ou **Espera · 2º** (posição na fila). Botões "Ver lista" e "Desistir". No topo, quando a pessoa **subiu da lista de espera**, mostre o cartão verde "Você subiu para a lista principal!" com o evento, o horário e o lembrete de fazer o Pix, mais os botões "Ver evento" e "Ok" (ao tocar em Ok, o aviso some e não volta).

**P5. Lista do evento.** Voltar; nome, etiqueta, data/hora/duração e local. Cartão do **Pix**: valor, chave e botão "Copiar chave". Resumo "Inscritos 12 de 16 · 8 pagos". **Lista numerada** com nome completo e selo Pago/Pendente (a linha da própria pessoa fica destacada e com "(você)"). Quem tem muitos inscritos vê "Ver todos os inscritos". Bloco **Lista de espera** logo abaixo, na ordem de chegada. Aviso do prazo: "Inscrições e desistências até 5h antes do início (sáb, 11h)." Aviso fixo: "Fez o Pix? O organizador confirma seu pagamento e o status muda para Pago." Botão **"Entrar na lista"** (ou de espera, se lotado) ou **"Desistir da vaga"**.

**P6. Perfil.** Iniciais em círculo verde, nome e telefone. *Nome completo* editável (botão "Salvar alterações"). O **telefone não é editável**: "Para trocar o telefone, fale com um organizador." Botão "Alterar PIN" (pede PIN atual e novo). Texto: "Seu nome aparece na lista dos eventos. O telefone é visível só para os organizadores." Botão "Sair deste aparelho".

**D1. Desistir sem pagamento.** Título "Desistir da vaga?", card do evento com selo Pendente e o texto: "Você ainda não pagou, então pode sair sem custo. Se mudar de ideia, pode entrar de novo até sáb, 11h (5h antes do início)." Botões "Confirmar desistência" e "Manter minha vaga".

**D2. Desistir com pagamento.** Card com selo Pago e o texto: "Como você já pagou, a desistência e o reembolso são combinados com o organizador. Ele retira você da lista." Mostre a prévia da mensagem: *"Olá, Murilo! Sou \[NOME\] e quero desistir do \[EVENTO\] (\[DATA\], \[HORÁRIO\]). Já fiz o pagamento e gostaria de pedir o reembolso."* Botão **"Falar com Murilo no WhatsApp"**, que abre `https://wa.me/<número do owner>?text=<mensagem codificada>`. Aviso: "Sua vaga só é liberada depois que o organizador confirmar. Prazo para desistir: sáb, 11h." O número padrão é o do owner e fica em uma configuração editável só por ele.

**Prazo encerrado** (tela ou estado, ainda não desenhado): quando o prazo passa, os botões de entrar e desistir ficam desativados com a explicação "As inscrições e desistências deste evento fecharam às 11h. Fale com um organizador se precisar de ajuda." e um botão para o WhatsApp do owner.

## 7. Telas do organizador (admin e owner)

**A1. Login do organizador.** Logo, tag "Organizador", e-mail + senha, botão "Entrar (owner ou admin)", links "Recebi um convite" e "Voltar para a entrada de participantes". Inclua "Esqueci a senha" (redefinição por e-mail).

**A2. Painel de eventos.** Título "Painel do organizador". Botão "Criar evento"; atalhos "Pessoas" e "Organizadores" (este só aparece para o owner). Cards dos eventos abertos com nome, etiqueta, data/hora, `12 de 16`, `8 pagos`, `2 na espera`, botões "Gerenciar lista" e "Editar".

**A3. Lista e pagamentos (do evento).** Cada inscrito com **nome completo, telefone** e: se pago, selo Pago (toque para desfazer, com confirmação); se pendente, botão "Marcar como pago". Ação "Remover inscrito" (com confirmação). Quando alguém é removido, **o primeiro da lista de espera sobe automaticamente** (mostre isso no aviso da tela). A lista de espera aparece abaixo, com a etiqueta "1º da espera", sem botão de promover. Texto: "Só o organizador altera o status de pagamento. O telefone aparece apenas aqui." Em tela grande, inclua busca por nome e contadores de pagos e pendentes.

**A4. Criar e editar evento.** Campos: *Nome do evento*; *Modalidade* (texto livre com sugestões das já usadas; pode haver vários eventos da mesma modalidade); *Tipo* (Recorrente ou Sazonal); *Dia da semana* (para recorrente) ou *Data* (para sazonal); *Início* e *Fim* (a **duração é calculada e mostrada**, ex.: "Duração: 2h"; rejeite fim antes do início, e se atravessar a meia-noite, trate como dia seguinte); *Vagas*; *Valor* (R$); *Chave Pix*; *Local*; *Fechar entrada e saída (horas antes)*, padrão 5. Aviso fixo: "A lista da próxima semana abre automaticamente no dia seguinte ao evento (ex.: domingo, para o sábado seguinte)." Botão "Publicar evento".

**A5. Pessoas.** Busca por nome ou telefone. Cada pessoa com "Redefinir PIN" e "Remover". Texto: "Ao redefinir, a pessoa escolhe um novo PIN no próximo acesso. Tudo fica registrado no histórico."

**A6. Remover pessoa.** Confirmação com nome e telefone e o que acontece: sai de todos os eventos em que está inscrita; as vagas liberadas sobem a lista de espera automaticamente; o cadastro é apagado e, para voltar, a pessoa precisa se cadastrar de novo. Botão destrutivo "Confirmar remoção" e "Cancelar". Registre quem removeu.

**Histórico de ações** (atalho no painel do owner e do admin): lista cronológica de quem fez o quê e quando (marcar pago, remover inscrito, redefinir PIN, remover pessoa, criar e editar evento, convidar e remover admin). Só leitura.

## 8. Telas só do owner

**O2. Organizadores.** Título "Organizadores" com tag "Owner". Botão "Convidar organizador". Lista com o próprio owner (selo Owner), cada admin (botão "Remover acesso") e os **convites pendentes** ("Reenviar", "Cancelar"). Texto: "Admins gerenciam eventos, pagamentos e PINs, mas não criam nem removem outros admins." Atalho "Ver histórico de ações". Também permite editar o **WhatsApp padrão de contato** do owner.

**O3. Convidar organizador.** Campo de e-mail e botão "Gerar convite". O sistema mostra o **link do convite** com "Copiar link" e "Enviar no WhatsApp". O link vale **7 dias** e é de **uso único**.

**O1. Aceitar convite** (tela da pessoa convidada). Logo, "Criar meu acesso", texto "\[Murilo\] convidou você para organizar eventos na Ethos Tribo.", e-mail já preenchido (somente leitura), nome, senha e confirmação. Botão "Criar acesso". **Ninguém além do convidado conhece a senha.**

**Primeiro owner:** o desenvolvedor gera, por script ou seed, um convite de owner para o Murilo, e ele define a própria senha pelo mesmo fluxo da tela O1.

## 9. Regras de negócio

**Eventos e ocorrências.** Separe a **regra** ("Vôlei de quadra, todo sábado, 16h às 18h, 16 vagas") da **ocorrência** (o vôlei de 14/11), que tem a própria lista, vagas, pagamentos e prazo. Eventos sazonais têm uma única ocorrência. Eventos da mesma modalidade são independentes (ex.: vôlei de quadra e vôlei de areia).

**Reabertura automática.** Para eventos recorrentes, **no dia seguinte ao término de uma ocorrência**, um **job agendado** cria a ocorrência da semana seguinte (mesmo dia, horário, vagas, valor, Pix e local) com a lista aberta e vazia. O job é **idempotente** (rodar duas vezes não duplica) e usa o fuso `America/Sao_Paulo`. Admin pode encerrar a série e editar ocorrências futuras sem mexer nas passadas.

**Vagas e lista de espera.** Cada ocorrência tem limite de vagas. Se lotada, quem tenta entrar **vai para a lista de espera**, e a tela deixa claro que é uma lista de espera. A ordem é de chegada (guarde `criado_em` e uma posição). **Quando abre uma vaga** (desistência de quem não pagou, remoção por admin, remoção da pessoa do sistema), **o primeiro da espera sobe automaticamente**, ganha status *Pendente* e vê o aviso na tela. Faça a promoção **dentro de uma transação com bloqueio** para que dois cancelamentos simultâneos nunca promovam duas pessoas para a mesma vaga nem deixem a lotação passar do limite. Premissa: a promoção automática acontece mesmo depois do prazo, se um admin remover alguém; registre isso.

**Pagamento (manual).** Sem integração de Pix por enquanto. Cada inscrição tem *pagamento*: `pendente` ou `pago`. **Só admin e owner mudam o status.** O participante paga por Pix usando a chave mostrada e aguarda a confirmação. Cada mudança entra no histórico com quem fez.

**Prazo de entrada e saída.** Cada ocorrência tem *horas antes do início* (padrão 5, definido por admin ou owner na criação). Até o prazo: quem **não pagou** entra e sai **quantas vezes quiser**. Depois do prazo: entrar e sair ficam bloqueados para o participante, com a mensagem de prazo encerrado.

**Desistência de quem já pagou.** O participante **não sai sozinho**: o app o leva à tela D2, e o contato (WhatsApp do owner) combina a retirada e o reembolso. Só um admin remove a pessoa da lista, e aí a vaga sobe a espera automaticamente.

**Cancelamento e reembolso:** acontecem fora do app. O app só facilita o contato e a retirada da lista.

**Remoção de pessoa do sistema.** Admin e owner podem remover uma pessoa (tela A6). Premissa deste prompt: o cadastro é apagado. Se preferir bloquear e manter histórico, mude aqui (veja a seção 14).

**Duração.** Todo evento exibe `início–fim · duração` (ex.: `16h–18h · 2h`; para 90 minutos, `1h30`).

## 10. Identidade, sessão e segurança

**Participante.**

- O telefone, guardado só com dígitos (DDD + número, formato internacional), é **único** e identifica a pessoa. O nome é livre e não é usado para autenticar.
- O **PIN de 6 dígitos** é guardado só como **hash** (Argon2id ou bcrypt), nunca em texto. Limite as tentativas (ex.: 5 erros bloqueiam por 10 minutos, por telefone e por IP).
- Após cadastro ou login, o servidor cria uma **sessão** e a guarda num **cookie `httpOnly`, `Secure`, `SameSite=Lax`, com validade longa (cerca de 1 ano)**. Isso é essencial: navegadores de iPhone apagam armazenamento de script após \~7 dias sem uso, e o grupo usa o app uma vez por semana. Não use `localStorage` para a sessão.
- Mensagens de erro de login são **genéricas** ("Não encontramos esse cadastro, confira os dados") e nunca revelam em nome de quem um telefone está registrado.
- Cada pessoa só altera a **própria** inscrição e o **próprio** perfil.
- Ofereça "adicionar à tela inicial" (PWA com manifesto, ícones e `display: standalone`).
- Se for usar um serviço de autenticação pronto, confirme que ele aceita telefone + senha **sem exigir SMS**. Se não aceitar, use tabela própria de pessoas e sessões.

**Organizador.**

- Login com e-mail e senha (use um provedor de autenticação consolidado; nunca monte criptografia de senha na mão).
- Papel (`owner` ou `admin`) no cadastro. Convite com **token aleatório**, guardado como hash, expiração de 7 dias, uso único.
- Registre toda ação sensível em um **log de auditoria** (quem, o quê, quando, alvo).

**Geral.**

- LGPD: telefone visível só para owner e admins; o app mostra apenas nome completo nas listas. Inclua uma página curta de privacidade acessível pelo Perfil.
- Validação sempre no servidor; sanitização de entrada; proteção contra CSRF; cabeçalhos de segurança; HTTPS obrigatório.
- Nunca registre PIN, senha ou tokens nos logs.
- Segredos e chaves em variáveis de ambiente.

## 11. Modelo de dados sugerido

Ajuste nomes e tipos à stack, mantendo as relações e restrições.

- **pessoas**: id, nome\_completo, telefone (único, normalizado), pin\_hash, criado\_em, ultimo\_acesso.
- **sessoes**: id, pessoa\_id, token\_hash, criado\_em, expira\_em.
- **organizadores**: id, usuario\_auth\_id, nome, email, papel (`owner` | `admin`), criado\_em, ativo.
- **convites**: id, email, papel, token\_hash, criado\_por, expira\_em, usado\_em, cancelado\_em.
- **eventos** (a regra): id, nome, modalidade, tipo (`recorrente` | `sazonal`), dia\_semana, hora\_inicio, hora\_fim, vagas, valor, chave\_pix, local, horas\_limite (padrão 5), ativo.
- **ocorrencias**: id, evento\_id, inicio\_em, fim\_em, vagas, valor, chave\_pix, local, horas\_limite, aberta, criada\_em.
- **inscricoes**: id, ocorrencia\_id, pessoa\_id, situacao (`confirmada` | `espera`), pagamento (`pendente` | `pago`), posicao\_espera, criado\_em, promovida\_em, aviso\_visto (booleano), pago\_em, pago\_por. Restrição: **única por (ocorrencia\_id, pessoa\_id)**.
- **auditoria**: id, ator\_tipo, ator\_id, acao, alvo\_tipo, alvo\_id, detalhes, criado\_em.
- **configuracoes**: whatsapp\_owner (número), mensagem\_padrao\_desistencia.

**Integridade:** contagem de confirmadas ≤ vagas, garantida em transação; `telefone` único; só um owner mínimo ativo; datas em UTC no banco e exibidas em `America/Sao_Paulo`.

## 12. Stack sugerida (ajustável)

- **Front:** React com TypeScript (Next.js ou Vite), Tailwind com os tokens da seção 4 em variáveis CSS, PWA.
- **Back e dados:** Postgres (Supabase ou equivalente) com regras de acesso por linha (RLS) e funções transacionais para entrar na lista, sair e promover. Job agendado (cron) para reabrir eventos recorrentes.
- **Auth:** organizador via provedor (e-mail + senha); participante via sessão própria (telefone + PIN) no servidor.
- Se escolher outra stack, **mantenha os comportamentos descritos**, e não a tecnologia, como contrato.

## 13. Qualidade

**Responsividade:** testar em 360, 390, 430, 768 e 1280 px. Sem rolagem horizontal da página; tabelas largas rolam dentro do próprio contêiner. Respeite as áreas seguras do iPhone (`env(safe-area-inset-*)`) com `viewport-fit=cover`.

**Acessibilidade:** `<label>` em todo campo, foco visível, navegação por teclado, `aria-label` em botões de ícone, selos com texto além de cor, contraste mínimo 4,5:1, e suporte a modo escuro opcional (se implementar, redefina todos os tokens e confira contraste).

**Estados:** para cada tela, trate carregando (esqueleto simples), vazio, erro de rede (com "Tentar de novo") e sem permissão.

**Desempenho:** primeira tela interativa rápida em 4G; imagens da logo otimizadas; fontes com `display=swap`.

**Testes essenciais** (automatizados quando possível):

1. Cadastro com telefone repetido é rejeitado sem revelar o dono do número.
2. Voltar ao app uma semana depois reconhece a pessoa sem pedir dados.
3. Duas desistências simultâneas promovem exatamente duas pessoas, sem ultrapassar o limite de vagas.
4. Participante não consegue ver telefone, marcar pagamento nem alterar inscrição alheia (teste direto na API).
5. Admin não consegue convidar ou remover admin; owner consegue.
6. Entrar e sair depois do prazo é bloqueado; antes do prazo, quem não pagou entra e sai à vontade.
7. Quem pagou é levado ao WhatsApp com a mensagem correta e não sai sozinho.
8. Reabertura recorrente cria uma única ocorrência por semana, mesmo se o job rodar duas vezes.
9. O último owner não pode ser removido.
10. Duração calculada corretamente, inclusive 1h30 e evento que atravessa a meia-noite.

## 14. Decisões em aberto e como proceder

Não trave por causa destes pontos: adote a premissa indicada, deixe fácil de mudar e **liste no fim de cada entrega o que assumiu**.

1. **Remover pessoa: apagar ou bloquear?** Premissa: apagar o cadastro. Alternativa: bloquear mantendo histórico de pagamentos.
2. **Chave Pix por evento ou global?** Premissa: campo por evento, com valor padrão herdado de uma configuração do owner.
3. **Promoção da espera após o prazo.** Premissa: acontece mesmo assim quando um admin remove alguém.
4. **Troca de telefone.** Premissa: só um organizador altera.
5. **Notificações fora do app (WhatsApp).** Fora do escopo desta versão. Deixe a modelagem preparada (telefone normalizado, `aviso_visto`).
6. **Tela de histórico de ações.** Implemente uma lista simples e de leitura.

## 15. Fora do escopo (por enquanto)

Pagamento automático por Pix e webhooks; notificações push ou por WhatsApp; chat; avaliações; múltiplos idiomas; várias comunidades; app nativo nas lojas.

## 16. Como trabalhar

1. Comece por **modelo de dados e regras de acesso**, depois o fluxo mínimo (cadastro, entrar, ver eventos, entrar na lista, admin marcar pago), e só então espera automática, recorrência, convite de admin e histórico.
2. Entregue em **etapas pequenas e testáveis**. A cada etapa, diga o que ficou pronto, o que testou e o que assumiu.
3. Siga as cores, os textos e a estrutura do wireframe. Onde o wireframe tem `[PLACEHOLDER]` (local, valor, chave Pix, número do WhatsApp), use configuração e dados de exemplo, nunca valores inventados fixos no código.
4. Pergunte antes de ampliar o escopo. Se algo parecer inseguro ou ambíguo, **sinalize** em vez de decidir em silêncio.
5. Mantenha o código simples, tipado e comentado onde a regra de negócio não for óbvia (espera, prazo, recorrência).
