# Validação · versão 2.1.0 · 17/11/2026

## Resultado executado

- `npm run check`: sintaxe JavaScript válida.
- `npm test`: **51 testes aprovados, 0 falhas, 0 ignorados**.
- Ambiente: Linux, Node.js 24, PostgreSQL temporário real via embedded-postgres. Respostas de pagamento controladas dentro dos testes, sem cobrança externa.
- Registro completo: `evidencias/testes.txt`.

## Cobertura principal

| Área | Verificado |
| --- | --- |
| Atualização | Migração da estrutura antiga com preservação de usuário, senha, pedido e quantidade; roupas desativadas; pedido legado não emite ingresso |
| Conta | Cadastro, normalização de e-mail, senha, sessão, CSRF, autorização, recuperação de senha e limites de tentativas |
| Eventos e lotes | Cadastro pela API, datas válidas, capacidade, janela de venda, limite por pedido e ajustes de quantidade |
| Compra | Nomes por ingresso, preço calculado no servidor, desconto, entrega digital sem frete, revisão quando o preço muda |
| Concorrência | Último ingresso de um lote, capacidade global entre lotes distintos, idempotência de criação e aprovação |
| Pagamento | Preferência única, falha de rede, recuperação, assinatura do webhook, reprocessamento, reconciliação e rejeição de dados divergentes |
| Emissão | QR único por ingresso nominal, emissão após aprovação, ausência de emissão em pendência, ausência de duplicação |
| Acesso | Somente comprador acessa seus ingressos; controle de entrada restrito a administrador |
| Entrada | Evento correto, período de entrada, validação sem consumo, confirmação única, duas confirmações simultâneas com um vencedor |
| Bloqueios | Reembolso parcial/total, contestação, pagamento duplicado, evento cancelado e aprovação tardia sem capacidade |
| Administração | Imagens válidas normalizadas, upload falso recusado, eventos ocultos, configurações validadas, participantes e registro de uso |

## Conferência no navegador

Página inicial, catálogo, combinação de filtros categoria/cidade, detalhe do evento, seleção de lote, carrinho, mudança de quantidade e remoção foram conferidos na prévia local em navegador desktop. Exemplo observado: 2 ingressos de R$ 89,90 = R$ 179,80; alteração para 4 = R$ 359,60. Filtro Shows + Franca retornou o evento correspondente.

As páginas autenticadas e o controle de entrada foram validados por testes de API; não houve sessão administrativa manual no navegador. O CSS tem regras responsivas, mas a conferência em aparelhos móveis físicos permanece pendente.

## Ainda depende do ambiente do proprietário

1. Instalação e execução no Windows.
2. Homologação Mercado Pago com vendedor e comprador de teste, notificações HTTPS e cenários reais disponibilizados pelo provedor.
3. Envio SMTP real, persistência na hospedagem escolhida, backups/restauração e carga esperada de vendas e entrada.
4. Conferência do leitor QR USB, impressão/PDF no navegador utilizado e rotina de portaria.
5. Cadastro de programação real, dados do organizador, regras e atendimento.

Nenhuma hospedagem foi publicada e nenhuma cobrança real foi feita. Os testes não equivalem a homologação do Mercado Pago ou teste de carga de produção. O código de teste injeta o adaptador controlado somente no processo de testes; a aplicação entregue não possui rota de aprovação simulada.

## Modo fácil adicionado nesta versão

A suíte também inicia banco e servidor reais pelo novo iniciador, cria o administrador pelo formulário/API protegido, realiza login, entrega recuperação em caixa local, encerra, reabre e confirma preservação dos dados. Confere rejeição de origem/chave inválidas, abertura duplicada, criação concorrente de administrador e revogação da chave local ao reiniciar.

O BAT/PowerShell de Windows foi revisado, mas não executado no Windows neste ambiente. Download automático, extração, dependências nativas Windows e abertura do navegador pelo Windows ainda dependem da primeira execução no computador do proprietário. A validação Linux não substitui essa verificação.
