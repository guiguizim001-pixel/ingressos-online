# Atualizar da loja 1.0.0 para ingressos 2.0.0

Esta é uma atualização do mesmo projeto. O arquivo SQL `001_initial.sql` foi mantido para preservar a cadeia de migrations; a transformação está em `002_tickets.sql`. Termos antigos nesse primeiro arquivo são intencionais.

1. Pare o servidor e o worker antigos. Não mantenha duas versões usando o mesmo banco durante a atualização.
2. Faça um backup PostgreSQL e guarde a pasta anterior, `.env`, uploads e dados do banco. Não execute `docker compose down -v`.
3. Extraia os novos fontes. Mantenha o mesmo `.env` (segredo de sessão, conexão de banco e configurações), os uploads e a localização do banco. Se usar `.local-db`, mantenha essa pasta no diretório do projeto; com Docker, conserve o volume/projeto Compose anterior. Mudar de pasta pode mudar o nome do projeto Compose e criar outro volume: não inicie um banco vazio supondo que é o original.
4. Execute `npm ci` e `npm run db:migrate` apontando para o banco correto. A migration é transacional e executada apenas uma vez.
5. Em desenvolvimento, `npm run db:seed` adiciona os novos eventos fictícios sem substituir seus dados. Não execute seed em produção.
6. Inicie servidor e worker. Entre com sua conta administrativa já existente. Cadastre seus eventos reais conforme `OPERACAO_INGRESSOS.md`.

## Dados preservados

Usuários, senhas, sessões, pedidos, pagamentos e histórico de quantidade permanecem no banco. Os antigos produtos/variantes são renomeados estruturalmente, porém ficam inativos e em rascunho, sem data. Não viram eventos publicados automaticamente. Categorias antigas permanecem para preservar histórico; desative-as em Configurações se não forem úteis.

Pedidos antigos recebem a classificação `legacy_physical`: continuam no histórico e nunca recebem ingresso digital. A nova interface não opera etapas de envio físico. Finalize pendências da antiga operação antes de migrar. Novas compras são exclusivamente de ingressos digitais.

Não há migration de reversão automática. Para voltar à versão anterior, pare os serviços, restaure seu backup anterior em um banco separado, aponte a versão antiga para esse banco e valide antes de atender clientes. Restaurar backup antigo perde mudanças posteriores; planeje a janela de atualização.
