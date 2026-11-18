# Seu Ingresso · 2.1.0

Sistema independente para **venda de ingressos online**, adaptado da loja anterior. Interface em HTML/CSS/JavaScript, servidor Node.js, PostgreSQL e login próprio. Não exige login no ChatGPT.

## Comece aqui — modo fácil

Extraia o ZIP inteiro e abra **ABRIR_INGRESSOS.bat** com dois cliques. O programa prepara os componentes, inicia o banco e o servidor e abre o navegador. Na primeira vez, basta criar seu administrador na tela. É necessário internet para o primeiro download.

Leia **MODO_FACIL.md**. A primeira pasta do pacote tem o iniciador e um guia curto; os arquivos técnicos ficam em `sistema`. O modo fácil é local, para Windows 10/11 x64 Intel/AMD, sem Docker e com pagamentos desativados.

**Se já usava uma instalação antiga:** preserve a pasta anterior. O modo fácil mantém seus próprios dados em `sistema/dados-locais`; não importa automaticamente o banco antigo.

O modo avançado continua disponível em **GUIA_WINDOWS.md** para preparar hospedagem e integração de pagamentos posteriormente.

## O que mudou

- Catálogo de eventos, cartazes, categorias, data, cidade, local e regras.
- Lotes com setor/tipo, preço, período de vendas e limite por pedido.
- Capacidade total compartilhada entre lotes; reservas transacionais contra venda acima do limite.
- Carrinho de ingressos e nome de cada participante. Sem tamanhos, cores, CEP ou frete no fluxo de compra.
- Checkout Pro Mercado Pago, confirmação no servidor, processamento de notificações e reconciliação.
- Ingresso nominal com QR Code único, emitido somente após pagamento aprovado e liberação de disponibilidade.
- “Meus ingressos”, histórico, impressão e opção de salvar PDF na janela de impressão do navegador.
- Painel de eventos, lotes, imagens, quantidades, pedidos, participantes e controle de entrada.
- Verificação e confirmação de entrada online; um ingresso só registra uma entrada, inclusive com operadores simultâneos.
- Reembolso parcial, reembolso total, contestação ou pagamento duplicado bloqueiam os ingressos ainda não utilizados.

A identidade provisória **Seu Ingresso** pode ser alterada em Configurações. Os quatro eventos incluídos são fictícios e estão identificados como exemplos.

## Pagamentos e limites desta entrega

O padrão é `MP_MODE=disabled`. A integração foi testada com respostas controladas do provedor; ainda é necessário homologar com sua conta de testes Mercado Pago. Nenhuma cobrança real ou publicação foi realizada. Veja **MERCADO_PAGO.md**.

Ingressos ficam na conta do comprador, com impressão/PDF pelo navegador. Não há envio automático de ingresso por e-mail, escolha de assento numerado, transferência de titularidade ou operação de entrada offline. A leitura aceita código digitado/colado ou leitor USB que preencha o campo; esta versão não abre a câmera do celular. SMTP é usado para recuperação de senha.

## Já instalou a versão anterior?

Siga **ATUALIZACAO.md**. A migration 002 preserva usuários e histórico de pedidos, retira as roupas antigas do catálogo público e acrescenta eventos, lotes e ingressos. Nunca apague seu banco para atualizar. Conserve `.env`, uploads e backups.

## Verificação

```text
npm run check
npm test
```

A suíte usa PostgreSQL temporário separado e integração controlada de pagamentos. Veja **VALIDACAO.md** e **evidencias/testes.txt** para o resultado desta versão. Instruções operacionais em **OPERACAO_INGRESSOS.md**; implantação futura em **PUBLICACAO.md**.
