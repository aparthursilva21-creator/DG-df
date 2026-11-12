# Backend legado (não publicar no plano Spark)

O projeto foi migrado para **Google Apps Script + Google Sheets**, para funcionar sem ativar faturamento no Firebase.

Os arquivos desta pasta (`index.js`, `package.json` e `README.md`) são a implementação anterior em Firebase Cloud Functions v2 e foram mantidos no repositório apenas como histórico técnico. **Não execute `firebase deploy --only functions`** para o fluxo atual.

O backend ativo está em `Code.gs` e as instruções de instalação estão em [apps-script/README.md](../apps-script/README.md).

O Firebase continua sendo usado pelo painel para autenticação Google e para preservar o histórico antigo de atendimentos no Firestore, dentro das cotas do plano Spark.
