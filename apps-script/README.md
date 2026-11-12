# Migração gratuita do backend DG Nails

Esta pasta contém a primeira etapa da migração das Cloud Functions para Google Apps Script + Google Sheets, mantendo o Firebase no plano Spark sem depender de Cloud Functions.

## O que esta etapa implementa

- Inicialização de uma planilha com abas para serviços, profissionais e agendamentos.
- Catálogo público de serviços/profissionais ativos.
- Consulta de horários a partir da agenda semanal de cada profissional.
- Criação de pedido de agendamento com bloqueio concorrente via LockService.
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

## API

- `GET ?action=health`
- `GET ?action=catalog`
- `GET ?action=slots&serviceId=...&professionalId=...&date=YYYY-MM-DD`
- `POST` JSON: `{"action":"booking","serviceId":"...","professionalId":"...","date":"YYYY-MM-DD","time":"HH:MM","customer":"...","whatsapp":"..."}`

As respostas JSON usam `ok`, e a consulta de horários retorna `slots`.

## Importante antes de colocar no ar

- Esta é a camada inicial do backend. O painel administrativo e a página pública ainda precisam ser migrados para consumir esta API; não altere o site publicado antes dessa integração.
- O painel deve continuar restrito à gestora. Não coloque uma chave administrativa no JavaScript público.
- O Google Calendar pode ser sincronizado numa etapa seguinte, pelo próprio Apps Script, sem exigir que a gestora use o Calendar.
- O Apps Script tem cotas diárias e limites de execução. O serviço é gratuito dentro dos limites vigentes do Google; não é ilimitado.
- O banco de dados antigo do Firestore e a coleção histórica `atendimentos` não são apagados nem alterados por este código.
