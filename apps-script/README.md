# DG Nails — backend gratuito

O backend do agendamento agora usa **Google Apps Script + Google Sheets**. O Firebase continua sendo usado somente para o login Google da gestora e para o histórico antigo de atendimentos que já existia no Firestore. Não é necessário ativar o plano Blaze nem publicar Cloud Functions.

## Preparar a planilha

1. Entre em [script.google.com](https://script.google.com/) usando a conta administradora `dionesiaguarina98@gmail.com`.
2. Crie um projeto independente chamado **DG Nails Backend**.
3. Copie todo o conteúdo de `Code.gs` deste repositório e substitua o conteúdo de `Código.gs` no Apps Script.
4. Salve.
5. No seletor de funções, escolha `configurarSistema` e clique em **Executar**.
6. Depois, escolha `autorizarIntegracoes` e clique em **Executar** para conceder acesso ao Google Calendar, envio de e-mail e requisições externas.
7. Autorize as permissões solicitadas.
8. Abra o **Registro de execução** de `configurarSistema` e copie o endereço da planilha criado. A planilha fica privada na conta da gestora; não a compartilhe publicamente.

A função cria as abas `servicos`, `profissionais` e `agendamentos`, com cabeçalhos e as três profissionais iniciais (Dionésia, Márcia e Ingrid). Não preenche horários nem inventa serviços. Os horários devem ser configurados no painel.

## Publicar como aplicativo da Web

1. Clique em **Implantar → Nova implantação**.
2. Selecione **Aplicativo da Web**.
3. Executar como: **Eu** (a conta administradora).
4. Quem pode acessar: **Qualquer pessoa**.
5. Clique em **Implantar**, autorize se solicitado e copie o endereço terminado em `/exec`.

O endpoint precisa ser público para que clientes sem login consultem os horários e enviem pedidos. As operações administrativas continuam protegidas: o Apps Script valida o token do Firebase Authentication e aceita somente o e-mail verificado `dionesiaguarina98@gmail.com`. A planilha em si não é pública.

## Conectar o site

1. No repositório, abra `gas-client.js`.
2. Substitua `COLE_AQUI_URL_DO_APPS_SCRIPT` pelo endereço /exec copiado na implantação.
3. Salve e publique essa alteração no GitHub Pages.
4. Use sempre **Implantar → Gerenciar implantações → Editar → Nova versão** no Apps Script quando atualizar `Code.gs`; a URL /exec normalmente permanece a mesma.

O cliente usa POST simples sem cabeçalhos personalizados e consulta o resultado por JSONP, pois o Content Service do Apps Script não oferece configuração livre de cabeçalhos CORS. O JSONP é usado somente para recuperar o resultado associado a um identificador aleatório de requisição.

## Funcionamento

- A página pública lê serviços/profissionais ativos e consulta os horários calculados no servidor.
- Pedidos públicos entram como `aguardando`.
- O painel administrativo cadastra serviços, profissionais, horários e agendamentos na planilha.
- O servidor valida conflitos novamente sob `LockService`, evitando dois pedidos simultâneos para o mesmo horário.
- Agendamentos são sincronizados com a agenda principal da conta que implantou o script.
- Um novo pedido também envia um e-mail para `dionesiaguarina98@gmail.com`.
- Cancelar um agendamento remove o evento correspondente do Google Calendar.
- A planilha mantém os dados operacionais; o histórico antigo `atendimentos` do Firestore não é apagado nem alterado.

## Limites e observações

- O Apps Script tem cotas diárias e limites de execução. Não é ilimitado; consulte [as cotas oficiais](https://developers.google.com/apps-script/guides/services/quotas).
- O plano Spark do Firebase permanece suficiente para o login Google e para o uso dentro das cotas gratuitas do Firestore já existente.
- A confirmação automática por WhatsApp ainda não está integrada. O fluxo atual envia aviso por e-mail à gestora e mostra à cliente a confirmação de recebimento do pedido.
- O evento é criado na agenda principal da conta que publicou o script. A equipe não precisa operar o Google Calendar; ele funciona em segundo plano.
- Configure a agenda de segunda a sábado no painel antes de liberar os horários ao público.
- Não compartilhe a planilha nem tokens de autenticação. Nunca coloque credenciais privadas no JavaScript do site.
- Depois de implantar, teste com um agendamento fictício e cancele-o para validar painel, planilha e Google Calendar antes de divulgar o link.
