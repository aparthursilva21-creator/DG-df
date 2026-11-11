# Backend de agendamentos DG Nails

Backend em Firebase Cloud Functions v2, região `southamerica-east1`.

## Funções

- `publicCatalog`: retorna somente serviços e profissionais ativos, sem liberar leitura pública direta do Firestore.
- `availableSlots`: calcula horários usando a agenda cadastrada da profissional, duração do serviço, intervalo e agendamentos existentes.
- `createPublicBooking`: registra pedidos de agendamento como `aguardando`.
- `createAdminBooking`: cria agendamentos pelo painel, restrito à conta administrativa.
- `updateBookingStatus`: permite à gestora confirmar, concluir ou cancelar.

A criação usa transação no Firestore e um documento de bloqueio por profissional/dia para serializar tentativas concorrentes. Há limite básico de três solicitações por WhatsApp em uma hora.

## Antes de publicar

1. Confirme que o projeto Firebase `dg-nails-caixa` está no plano Blaze (Cloud Functions exige faturamento habilitado).
2. Instale Node.js 20 ou superior e Firebase CLI.
3. Na pasta do projeto, execute:

```bash
firebase login
npm --prefix functions install
firebase deploy --only functions
```

O deploy de Functions não publica nem substitui as regras do Firestore. As regras atuais continuam restringindo acesso direto à conta administrativa.

## Importante sobre configuração

- A agenda de cada profissional precisa ter horários de entrada e saída preenchidos no painel. Enquanto isso não for feito, a API retorna zero horários.
- O backend usa o catálogo de serviços e os horários salvos no Firestore; não utiliza os dados de demonstração do antigo formulário.
- A integração com Google Agenda requer configurar OAuth/credenciais do Google e sincronização de eventos. Não há credenciais incluídas neste repositório.
- As notificações WhatsApp precisam de um provedor oficial e credenciais configuradas em secrets do Firebase. Nenhum token foi colocado no código.
- A página pública ainda precisa ser conectada às funções callable antes de aceitar reservas reais.
