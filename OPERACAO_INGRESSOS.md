# Operação de eventos e ingressos

## Cadastrar um evento real

1. Entre como administrador e abra **Minha conta → Painel administrativo → Eventos e lotes → Criar evento**.
2. Preencha nome, categoria, início, término, abertura da entrada, capacidade, espaço, cidade/UF, endereço e organizador. Todos os horários do painel usam Brasília.
3. Cadastre descrição e regras reais, incluindo classificação etária, documentação exigida, acessibilidade e cancelamentos. A plataforma não decide elegibilidade de meia-entrada: se cadastrar esse tipo, informe seus critérios e documentos nas regras.
4. Salve como rascunho enquanto prepara. Adicione o cartaz em PNG/JPG/WebP, até 5 MB. O upload é normalizado para WebP.
5. Adicione cada lote: código único, nome (por exemplo “1º lote”), tipo/setor, preço, início/fim das vendas e limite por pedido (1 a 20). O fim das vendas deve ser até o início do evento.
6. Abra **Quantidade / histórico** no lote e registre a quantidade inicial e o motivo. Cada lote começa com zero ingressos.
7. Quando os dados estiverem conferidos, marque **Publicado**, **Ativo: Sim** e retire a marca de demonstração. A categoria também precisa estar ativa. As vendas só abrem dentro do período do lote.

Os exemplos devem ser desativados antes de abrir vendas reais. Lotes simultâneos compartilham a capacidade total do evento. O sistema não avança automaticamente de um lote para outro: configure seus períodos e quantidades.

## Compra e recebimento

O cliente escolhe quantidades, entra com sua conta, informa contato e nome de cada participante, revisa o total e segue para o Mercado Pago. Limite de 20 ingressos por pedido e limite específico por lote. Preços e disponibilidade são calculados novamente no servidor.

A reserva termina no menor prazo entre o tempo configurado (padrão 60 minutos), o fim do lote e o início do evento. O worker libera reservas vencidas. Um pagamento pendente não gera ingresso. O retorno do navegador também não confirma o pagamento.

Após confirmação autenticada do provedor e liberação do pedido, os ingressos aparecem em **Meus ingressos → Pedido**. **Atualizar situação** consulta a informação já processada; o worker deve estar funcionando. Use **Imprimir / salvar PDF** para abrir a janela de impressão. Escolha “Salvar como PDF” quando disponível no navegador. Não há envio automático por e-mail nesta versão.

## Entrada

1. Entre como administrador e abra **Controle de entrada**.
2. Selecione o evento correto. A entrada só funciona entre a abertura configurada e o término do evento.
3. Cole/digite o código `EVT-…` do ingresso ou use um leitor QR USB que funcione como teclado. Configure o leitor para preencher o campo; se ele enviar Enter, o formulário fará a verificação.
4. Clique **Verificar ingresso**, confira o participante e os documentos exigidos pelo organizador.
5. Clique **Confirmar entrada**. Verificar apenas consulta; confirmar registra o uso.
6. A próxima tentativa do mesmo ingresso é recusada. Com dois operadores concorrentes, apenas uma confirmação vence.

A operação depende de internet e servidor disponíveis. Não há leitura por câmera nesta versão. Não compartilhe credenciais administrativas com participantes; contas de operadores são criadas pelo comando administrativo e possuem acesso completo ao painel (não há perfil limitado de portaria nesta versão).

**Carregar lista do evento** mostra nomes, lotes e situação dos ingressos emitidos, com quantidade de entradas. Não há botão de exportação CSV nesta versão.

## Cancelamentos e ocorrências

Cancelar o evento no painel bloqueia a entrada e oculta seus QR Codes utilizáveis, mas **não reembolsa automaticamente**. Efetue devoluções pelo Mercado Pago e mantenha o worker ativo para sincronizar. O sistema bloqueia ingressos válidos após reembolso/contestação e mantém o registro de entradas já realizadas.

A aprovação depois do início do evento, evento cancelado ou falta de vagas gera ocorrência e não libera ingressos. Pagamento duplicado também bloqueia o pedido para análise. Resolva com o comprador e o provedor; não existe botão de aprovação manual ou liberação forçada.

Ingressos reembolsados e bloqueados não são reativados automaticamente e não devolvem vagas automaticamente. Vagas vendidas continuam contando na capacidade; ajustes exigem avaliação operacional. Não aumente a capacidade real do local apenas para contornar esse controle.

Mudanças de data e local aparecem no ingresso consultado online. O pedido conserva um retrato dos dados no momento da compra. Impressos antigos não se atualizam: comunique alterações diretamente aos compradores por seu canal de atendimento; o sistema não dispara esses avisos.

## Rotina

- Mantenha servidor, PostgreSQL e worker ativos.
- Faça backup do banco e das imagens. Teste restauração em ambiente separado.
- Confira ocorrências em Pedidos, pagamentos e entradas, especialmente antes do evento.
- Homologue o fluxo completo com conta de teste, leitor usado na portaria e volume esperado antes da abertura de vendas. Os testes entregues não são um teste de carga de produção.
