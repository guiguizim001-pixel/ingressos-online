# Configuração avançada no Windows

> **Quer abrir com dois cliques?** Use `ABRIR_INGRESSOS.bat` e siga `MODO_FACIL.md`. Os comandos abaixo são opcionais, para configuração avançada.

## 1. Extrair e instalar os programas

1. Extraia o ZIP para uma pasta simples, por exemplo `C:\SeusIngressos`. Entre na pasta que contém `package.json`.
2. Instale o **Node.js 24 LTS** pelo site oficial https://nodejs.org/ e reinicie o terminal.
3. Para usar a opção principal de banco e e-mail, instale o **Docker Desktop**: https://www.docker.com/products/docker-desktop/. Ele pode exigir WSL 2 e reinício do Windows. Confira os requisitos/licença aplicáveis à sua organização antes de instalar.
4. Abra o Docker Desktop e aguarde ficar em execução.
5. No Explorador, abra a pasta do projeto, clique na barra de endereço, digite `cmd` e pressione Enter.

Use o Prompt de Comando se o PowerShell bloquear `npm.ps1`. Não é necessário desativar a política de segurança do Windows.

## 2. Preparar o sistema (uma vez)

Digite um comando por vez e aguarde terminar:

```bat
npm ci
npm run setup
docker compose up -d
npm run db:migrate
npm run db:seed
npm run admin:create
```

- `npm ci` precisa de internet. Instala servidor e dependências; pode demorar na primeira execução.
- O arquivo `.env` é criado automaticamente, com segredo de sessão aleatório. Ele fica junto de `package.json`. Não envie esse arquivo para outras pessoas.
- O banco Docker usa credenciais **exclusivamente locais**, presentes no `compose.yaml` e no `.env.example`. Nunca use essa senha em produção.
- O comando de administrador pede nome, e-mail e senha. A senha exige pelo menos 12 caracteres e não aparece enquanto você digita. Se o e-mail já for de um cliente, o comando não promove essa conta: escolha outro e-mail administrativo.
- Não existe administrador pré-cadastrado.

Se você preferir criar `.env` manualmente, copie `.env.example` para `.env` e preencha `SESSION_SECRET` com um segredo aleatório de pelo menos 32 caracteres. O comando `npm run setup` é a opção recomendada.

## 3. Abrir o site

Na mesma janela:

```bat
npm run dev
```

Depois abra no navegador **http://localhost:3000**.

Em uma segunda janela de terminal, na mesma pasta:

```bat
npm run worker
```

Mantenha as duas janelas abertas. O worker libera reservas vencidas e consulta os pagamentos. `Ctrl+C` interrompe cada processo. O endereço local só funciona enquanto o servidor estiver em execução no seu computador.

Para acessar a administração, clique em **Minha conta**, entre com o e-mail/senha criado no comando e clique em **Painel administrativo**.

## 4. Personalizar para seus eventos

1. Em **Configurações**, ajuste nome, frase, logo, cor, atendimento, políticas e categorias.
2. Em **Eventos e lotes**, cadastre o evento com data, horário, local, capacidade e regras. Salve antes de adicionar lotes.
3. Em cada lote, configure nome, tipo/setor, código, preço, período de venda e limite por pedido.
4. Use **Quantidade / histórico** para adicionar os ingressos disponíveis e registrar o motivo.
5. Envie o cartaz e publique quando estiver pronto. Desative os eventos de exemplo antes de vender.
6. Consulte **OPERACAO_INGRESSOS.md** para o passo a passo e controle de entrada.

## 5. Teste sem Mercado Pago

- Crie uma conta de cliente separada. Explore eventos e filtros, adicione ingressos ao carrinho e ajuste quantidades.
- No checkout, informe contato e nome de cada participante. Marque a leitura das regras e clique **Calcular e revisar total**.
- Com `MP_MODE=disabled`, nenhuma cobrança ou pedido ficticiamente aprovado será criado. O botão de pagamento permanece desabilitado.
- Os ingressos com QR só são emitidos depois de pagamento confirmado. Para testar o ciclo completo, configure as contas de teste conforme **MERCADO_PAGO.md**.
- Use **Esqueci minha senha** e abra **http://localhost:8025** para ler a mensagem no Mailpit. Essa configuração não envia para uma caixa real.
- Reinicie o servidor e confira a persistência das contas e eventos.

## 6. Testar a integração

```bat
npm run check
npm test
```

Os testes usam um PostgreSQL temporário separado e adaptador simulado de Mercado Pago. Eles não acessam credenciais reais nem apagam seu banco. Instalação nativa de dependências pode precisar dos redistribuíveis do Microsoft Visual C++ no Windows. O teste automatizado foi executado em Linux; a validação no seu Windows ainda precisa ser realizada.

Para pagamentos de teste, siga **MERCADO_PAGO.md**. Preencha credenciais no `.env` local e reinicie servidor e worker após alterações. Não cole tokens na conversa.

## 7. Alternativas ao Docker

**Banco auxiliar:** depois de `npm ci` e `npm run setup`, abra outra janela e execute:

```bat
npm run db:local
```

Mantenha essa janela aberta, volte à primeira e execute migrations, seed, criação do administrador e servidor. Os dados ficam em `.local-db`, que deve ser copiada apenas com o banco parado ou por backup lógico. Este recurso é somente para desenvolvimento.

**PostgreSQL instalado:** crie um usuário e um banco próprios, altere `DATABASE_URL` no `.env`, e execute as migrations normalmente. Evite reutilizar outro banco existente.

**E-mail:** mesmo usando o banco auxiliar ou instalado, inicie o Mailpit (`docker compose up -d mail`) ou configure seu SMTP de testes. Sem um servidor SMTP ativo, a recuperação não entregará o e-mail. A resposta da tela permanece genérica para não revelar se um endereço está cadastrado.

## Problemas comuns

| Sintoma                              | O que verificar                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `npm` não reconhecido                | Instalar Node.js 24 e abrir um novo terminal                                               |
| `ECONNREFUSED` no banco              | Docker/banco auxiliar ativo; aguarde alguns segundos e confira `DATABASE_URL`              |
| Tabela inexistente                   | Executar `npm run db:migrate`                                                              |
| Página sem eventos                  | Executar `npm run db:seed` em desenvolvimento; conferir evento publicado, ativo e futuro                                              |
| Porta 3000 ocupada                   | Trocar `PORT=3001` e `APP_URL=http://localhost:3001` no `.env`; reiniciar                  |
| “Origem não autorizada”              | Abrir exatamente o endereço de `APP_URL`; `localhost` e `127.0.0.1` são origens diferentes |
| Sessão expirada após alterar segredo | Atualizar página e entrar novamente                                                        |
| Senha não aparece no terminal        | Comportamento normal da entrada oculta                                                     |
| Ingresso sem QR | Conferir aprovação do pagamento, worker ativo e possíveis ocorrências no pedido |
| Pagamento indisponível               | Conferir credenciais, modo, HTTPS e documentação da integração                             |
| E-mail não chega                     | Em desenvolvimento, verificar Mailpit e se serviço SMTP está ativo                         |

Ao desligar o PC, a versão local para. A hospedagem externa só será configurada depois da sua aprovação e funcionará independentemente do seu computador.
