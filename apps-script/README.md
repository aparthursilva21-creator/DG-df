# Migração gratuita do backend DG Nails

Esta pasta contém a primeira etapa da migração das Cloud Functions para Google Apps Script + Google Sheets, mantendo o Firebase no plano Spark sem depender de Cloud Functions.

## O que esta etapa implementa

- Inicialização de uma planilha com abas para serviços, profissionais e agendamentos.
- Catálogo público de serviços/profissionais ativos via JSONP.
- Consulta de horários a partir da agenda semanal de cada profissional via JSONP.
- Criação de pedido de agendamento por formulário HTML oculto, com retorno via postMessage e bloqueio concorrente via LockService.
- Notificação por e-mail para a gestora quando chega um pedido (opcional).

## Instalação (feita uma vez na conta Google que será dona da planilha)

1. Abra https://script.google.com/ e crie um projeto chamado **DG Nails API**.
2. Cole o conteúdo de `Code.gs`.
3. Selecione a função `setupDatabase` e clique em **Executar**. Autorize as permissões.
4. Abra **Configurações do projeto > Propriedades do script** e adicione:
   - `DG_NOTIFICATION_EMAIL` = e-mail que receberá aviso de novos pedidos (ex.: e-mail da gestora).
5. Execute `setupDatabase` uma vez e consulte o **Registro de execução** para abrir a planilha criada.
6. Preencha as abas **Servicos** e **Profissionais** com os cadastros reais. Na coluna `agendaJson`, use JSON com as chaves `segunda`, `terca`, `quarta`, `quinta`, `sexta`, `sabado`; exemplo:
   `{"segunda":{"ativo":true,"inicio":"08:00","fim":"18:00","intervaloInicio":"12:00","intervaloFim":"13:00"}}`
7. Clique em **Implantar > Nova implantação > App da Web**:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
   - Copie a URL terminada em `/exec`.

## API pública

- `GET ?action=health`
- `GET ?action=catalog&callback=nomeDaFuncao` (JSONP)
- `GET ?action=slots&serviceId=...&professionalId=...&date=YYYY-MM-DD&callback=nomeDaFuncao` (JSONP)
- `POST` `application/x-www-form-urlencoded` em formulário: `action=booking`, `requestId`, `serviceId`, `professionalId`, `date`, `time`, `customer`, `whatsapp`. A resposta envia `postMessage` para a janela que abriu o formulário.

A página `agendamento.html` já está preparada para consumir essa API. Depois da implantação, basta preencher `CONFIG.API_URL` com a URL `/exec` do Web App. O painel administrativo ainda não foi migrado: ele permanece protegido pelo login Google/Firebase até a implementação de autenticação administrativa validada no servidor.

As respostas JSON usam `ok`, e a consulta de horários retorna `slots`.

## Importante antes de colocar no ar

- O agendamento público foi conectado no código do site, mas só funcionará depois de criar a planilha, implantar o Web App e configurar `CONFIG.API_URL` em `agendamento.html`. O painel administrativo ainda usa Firebase e não deve ser liberado publicamente.
- O painel deve continuar restrito à gestora. Não coloque uma chave administrativa no JavaScript público.
- O Google Calendar pode ser sincronizado numa etapa seguinte, pelo próprio Apps Script, sem exigir que a gestora use o Calendar.
- O Apps Script tem cotas diárias e limites de execução. O serviço é gratuito dentro dos limites vigentes do Google; não é ilimitado.
- O banco de dados antigo do Firestore e a coleção histórica `atendimentos` não são apagados nem alterados por este código.
