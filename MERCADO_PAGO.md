# Mercado Pago — Checkout Pro via Preferences API

## Situação desta entrega

Adaptador implementado; validação externa **pendente**. Os testes automatizados usam respostas controladas, não uma conta Mercado Pago. Nenhuma preferência ou cobrança real foi criada durante a implementação. O modo padrão é `disabled`.

Documentação oficial consultada na implementação:

- https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/overview
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/create-preference/post
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/search-preferences/get
- https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/search-payments/get
- https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications
- https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/test-accounts
- https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/integration-test/test-purchases

## 1. Preparar sua conta de teste

No painel de desenvolvedores do Mercado Pago, crie/selecione uma aplicação de Checkout Pro **via Preferences**. Siga o procedimento vigente para vendedor de teste e comprador de teste separados. Use as credenciais correspondentes a esse fluxo. O prefixo do token não é usado para deduzir o ambiente.

Preencha apenas no seu `.env`:

```dotenv
MP_MODE=test
MP_ACCESS_TOKEN=
MP_WEBHOOK_SECRET=
MP_COLLECTOR_ID=
APP_URL=https://ENDERECO_HTTPS_DO_TUNEL
```

- `MP_COLLECTOR_ID`: ID da conta recebedora de teste vinculada à aplicação.
- `MP_WEBHOOK_SECRET`: chave de assinatura em Webhooks da mesma aplicação.
- `MP_ACCESS_TOKEN`: token secreto dessa integração. Nunca colocar no HTML.
- Não há chave pública no frontend porque esta implementação redireciona diretamente para o endereço retornado pela preferência.
- Não misture credenciais de produção, comprador real e vendedor de teste.

A aplicação recusa configuração parcialmente habilitada. `test` e `production` exigem token, segredo, recebedor numérico e `APP_URL` HTTPS. A verificação de `live_mode` é feita sobre o pagamento consultado na API; não se baseia no nome/prefixo do token. Se a conta de teste retornar um ambiente inesperado, investigue com a documentação/suporte; não remova a validação para forçar aprovação.

## 2. Túnel HTTPS para testes no PC

`localhost` não recebe notificações externas. Escolha um túnel HTTPS de desenvolvimento, como o fornecido pelo Cloudflare Tunnel ou ngrok, instale pelo site oficial e exponha somente a porta da plataforma. Não exponha PostgreSQL ou Mailpit. Confira as condições atuais do fornecedor.

Nenhum túnel foi criado nesta entrega. Registre o endereço efetivamente fornecido:

| Campo                         | Preencher no PC                |
| ----------------------------- | ------------------------------ |
| URL HTTPS                     | Pendente                       |
| Data de abertura              | Pendente                       |
| Aplicação / vendedor de teste | Pendente, sem registrar tokens |
| Teste de webhook              | Pendente                       |
| Última mudança de URL         | Pendente                       |

Ajuste `APP_URL` para a URL recebida, sem barra final. Configure o endpoint de pagamento da aplicação em:

`https://SEU_ENDERECO/api/webhooks/mercadopago`

Selecione notificações do tipo **payment** no painel. Reinicie servidor e worker. Abra a plataforma pelo mesmo endereço HTTPS de `APP_URL`, inclusive para cadastro/login, para a validação de origem funcionar. Cada mudança do endereço exige atualização no `.env`, painel de webhook e novas preferências; pedidos antigos continuam vinculados às URLs da preferência original.

O túnel é temporário, não é a hospedagem definitiva. Não desative CSRF ou assinatura para contornar testes.

## 3. Fluxo implementado

1. O cliente envia lotes, quantidades, nomes dos participantes, contato e uma chave de idempotência.
2. O servidor consulta preços, calcula desconto, bloqueia eventos e lotes em ordem estável e reserva vagas em transação, respeitando capacidade global, período de venda e limites.
3. Pedido e itens são persistidos antes de chamar o Mercado Pago. O total e os dados dos itens ficam congelados no pedido.
4. `POST /checkout/preferences` cria a preferência, com `external_reference=UUID do pedido`, itens, total, retorno e notificação.
5. O navegador usa **`init_point` retornado pela API**. Não constrói links nem usa `sandbox_init_point` por inferência.
6. Ao voltar, a página lê o pedido autenticado. Parâmetros como `status=approved` nunca aprovam pedidos.
7. O webhook valida o identificador da URL e a assinatura oficial, persiste evento e responde. O worker consulta `GET /v1/payments/{id}` autenticado antes de atualizar.
8. Valor exato, BRL, referência, recebedor, ambiente e ID são conferidos. Divergências vão para quarentena.
9. ID único de pagamento e horário de atualização do provedor evitam consumo duplicado e reversão por snapshots antigos. Duas aprovações distintas para o mesmo pedido geram ocorrência e bloqueio.

Quando há desconto, cada linha do provedor representa o conjunto de unidades daquele item. Os centavos do desconto são distribuídos entre as linhas, sem frete para ingressos digitais. O campo de frete no banco permanece somente por compatibilidade com pedidos legados. A soma é exatamente o total calculado pelo servidor; o pedido mantém os preços unitários originais. Para valores mínimos em que o desconto zeraria uma linha, os ingressos são agrupados em uma única linha positiva, com o mesmo total. Se o total mudar depois da revisão no checkout, a interface exige novo cálculo antes de prosseguir.

## 4. Assinatura

É usado o `WebhookSignatureValidator` do SDK oficial `mercadopago`, com versão fixa no lockfile. Dados: `x-signature`, `x-request-id`, `data.id` da **query string** e o segredo da aplicação. O manifesto para os campos exigidos nesta rota é:

```text
id:<data.id>;request-id:<x-request-id>;ts:<ts>;
```

O comparador HMAC-SHA256 é constante no SDK. Esta integração aceita apenas identificadores numéricos de pagamentos; não recebe notificações da Orders API. O ID no corpo, quando existir, precisa coincidir com o da URL.

Não é aplicada uma janela local rígida de timestamp, pois notificações podem ser reenviadas. Repetições são persistidas com chave derivada do identificador, request ID e assinatura; o pagamento é sempre consultado novamente e sua aplicação é idempotente. O conteúdo recebido não é fonte de aprovação.

## 5. Reservas, falhas e retentativas

- `RESERVATION_MINUTES=60` define o limite de duração da reserva. O vencimento é antecipado para o fim do lote ou o início do evento quando ocorrerem antes.
- Os tipos `ticket` e `atm` estão excluídos na primeira versão para evitar meios com prazo muito maior que a reserva. Outros meios só aparecem conforme disponibilidade da conta; Pix e parcelamento não são prometidos nem simulados.
- A expiração da preferência não equivale a cancelar um pagamento pendente. Um pagamento pode ser aprovado mais tarde: se houver vagas no lote e na capacidade global e o evento continuar publicado antes do início, consome com bloqueio transacional. Caso contrário, registra `late_payment_no_stock`, `event_capacity_exceeded` ou `event_unavailable` e impede a emissão. A ocorrência exige atendimento e eventual reembolso pelo provedor.
- Recusa de uma tentativa não libera imediatamente a reserva: a preferência pode ser tentada novamente até o vencimento.
- Após timeout ou queda ao criar preferência, o estado fica incerto. O sistema busca a preferência por `external_reference` e recupera o endereço quando o encontrar. **Não repete cegamente o POST**, pois não presume idempotência nativa desse endpoint.
- Se nenhuma preferência aparecer na busca, mantém a tentativa incerta até expirar. Uma nova compra usa outra chave após conferir que não houve pagamento. Não recicle uma chave já usada com itens diferentes.
- A fila tem lease de 2 minutos, retentativa exponencial até 1 hora e armazenamento persistente. Erros de vinculação vão para `quarantined`, visível no painel.
- O worker reconcilia lotes de 30 pedidos por rodada, incluindo pedidos pagos para detectar reembolsos/contestações. Isso é apropriado para a primeira operação de pequeno volume; monitore o atraso conforme o histórico crescer. Uma busca de pagamentos percorre até 1.000 resultados por pedido; ocorrências fora desse limite exigem investigação.
- Nenhuma falha de comunicação é registrada como pagamento aprovado.

Mantenha o worker ativo:

```text
npm run worker
```

Consulta manual:

```text
npm run reconcile
npm run reconcile -- UUID_DO_PEDIDO
```

## 6. Roteiro externo obrigatório

Usando apenas contas e meios de teste indicados na documentação vigente:

1. Criar cliente na plataforma e um evento fictício com data futura, capacidade e lote dentro do período de vendas.
2. Criar pedido, conferir preferência e `external_reference` no painel.
3. Pagar com comprador de teste diferente do vendedor e meio de teste autorizado.
4. Confirmar retorno, webhook recebido e assinatura aceita sem alterações de código.
5. Conferir estado real consultado, valor, moeda, recebedor e `live_mode`.
6. Validar aprovado, pendente e recusado conforme cenários disponibilizados pelo provedor.
7. Efetuar reembolso pelo painel de testes e verificar reconciliação; estoque não deve voltar automaticamente.
8. Reiniciar servidor/worker, simular indisponibilidade e repetir a notificação.
9. Conferir compra simultânea, reserva expirada, aprovação tardia, ingresso nominal e tentativa de entrada duplicada.
10. Registrar IDs de teste, resultado, data e evidências sem tokens ou dados de cartão.

A ativação de produção exige sua validação, credenciais de produção, envio de e-mail validado, armazenamento persistente, URLs definitivas e testes operacionais. Uma compra com dinheiro real só deve ser feita após combinar valor e finalidade com o proprietário.

## 7. Emissão e entrada

A confirmação aplica a baixa de quantidade e a emissão nominal de QR na mesma transação. A combinação item + posição do ingresso é única, impedindo emissão duplicada em notificações repetidas. O código é aleatório com 160 bits, não contém nome ou dados do pagamento e não é uma URL pública.

Somente o dono do pedido acessa seus QR Codes autenticado. A entrada é consultada e confirmada por administrador, verificando pagamento, ocorrência, situação do evento, período e uso anterior. A confirmação bloqueia o pedido e o ingresso no banco para que dois operadores não validem a mesma entrada.

Reembolso parcial/total, contestação e múltiplos pagamentos bloqueiam os ingressos válidos; não há reativação automática. Entradas já registradas permanecem no histórico. Cancelar um evento bloqueia sua entrada, mas não cria reembolso no provedor.
