# Publicação independente e manutenção

## O que foi preparado

Código exportável, lockfile, Dockerfile, modelo Render, migration transacional, PostgreSQL persistente, adaptador de imagens S3, SMTP configurável, processo web e worker separado. **Nenhuma publicação, contratação ou cobrança foi feita.** A implantação depende da validação local do proprietário.

A plataforma possui login próprio e não usa ChatGPT. Depois de publicada, o computador do proprietário pode ficar desligado. O endereço pode ser um subdomínio HTTPS do provedor, sem comprar domínio. Um subdomínio não é um domínio próprio `.com.br`.

## Hospedagem de referência

Documentação oficial consultada:

- https://render.com/docs/web-services
- https://render.com/docs/free
- https://render.com/pricing
- https://render.com/docs/blueprint-spec
- https://render.com/docs/background-workers

O Render informa que os serviços gratuitos têm suspensão após inatividade, disco efêmero e limites; não recomenda esses serviços para produção. O PostgreSQL gratuito tem expiração, e o serviço web gratuito bloqueia portas SMTP comuns. Por isso, não se promete operação comercial sem custo.

Antes de publicar, confira no painel os preços atuais de **web + worker + PostgreSQL + armazenamento de objetos + e-mail + tráfego**. Não há orçamento contratado nesta entrega. O subdomínio do provedor pode continuar sendo usado mesmo com infraestrutura paga.

`render.example.yaml` é um modelo com planos pagos, não uma autorização de contratação. Deve ser revisado e renomeado para `render.yaml` somente após decisão do proprietário. Banco e grupo de variáveis são configurados separadamente. Não envie `.env` para o Git.

## Configuração de produção

1. Criar repositório privado na conta do proprietário e enviar apenas fontes, sem banco, uploads locais, logs ou segredos.
2. Criar PostgreSQL persistente e selecionar backups/retenção adequados. Usar conexão TLS conforme o provedor, com validação de certificado. Não usar `rejectUnauthorized:false`.
3. Criar armazenamento S3 compatível com URL pública HTTPS apenas para cartazes dos eventos. Configurar CORS/acesso público apenas quando necessários e credenciais restritas ao bucket. O app envia arquivos normalizados em WebP.
4. Criar grupo de variáveis secretas e compartilhá-lo com web/worker. Preencher as variáveis da tabela abaixo.
5. Executar `npm ci --omit=dev` e `npm run db:migrate`. **Não executar seed em produção.**
6. Criar administrador pelo comando interativo em terminal seguro conectado ao banco correto. Não usar senha padrão.
7. Criar serviço web com `npm start`, escutando no `PORT` fornecido. Health check: `/health`.
8. Criar worker com `npm run worker` ou scheduler externo de `npm run reconcile` com periodicidade adequada. Um processo web sozinho não executa a fila.
9. Ajustar `APP_URL`, webhook e retorno para o subdomínio HTTPS definitivo.
10. Validar HTTPS, sessão, cadastro, recuperação, persistência após redeploy, upload e compra de teste. Habilitar cobranças reais apenas depois da decisão do proprietário.

### Variáveis realmente utilizadas

| Variável                                   | Uso                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `NODE_ENV`                                 | `development`, `test` ou `production`                                            |
| `PORT`                                     | Porta de escuta, fornecida pela hospedagem                                       |
| `APP_URL`                                  | Origem pública canônica, incluindo HTTPS                                         |
| `DATABASE_URL`                             | Conexão PostgreSQL; segredo                                                      |
| `SESSION_SECRET`                           | Segredo aleatório de pelo menos 32 caracteres; segredo                           |
| `TRUST_PROXY`                              | Número de proxies confiáveis antes do app; 0 local, configurar conforme provedor |
| `MP_MODE`                                  | `disabled`, `test` ou `production`                                               |
| `MP_ACCESS_TOKEN`                          | Token da aplicação/ambiente; segredo                                             |
| `MP_WEBHOOK_SECRET`                        | Chave HMAC do webhook; segredo                                                   |
| `MP_COLLECTOR_ID`                          | Recebedor esperado                                                               |
| `RESERVATION_MINUTES`                      | Validade da reserva e da preferência                                             |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`    | Servidor SMTP e uso de TLS direto (`true` geralmente em 465)                     |
| `SMTP_USER`, `SMTP_PASS`                   | Autenticação do SMTP, quando necessária; segredo                                 |
| `MAIL_FROM`                                | Remetente autorizado                                                             |
| `STORAGE_DRIVER`                           | `local` em desenvolvimento, `s3` obrigatório em produção                         |
| `UPLOAD_DIR`                               | Diretório usado somente pelo adaptador local                                     |
| `S3_REGION`, `S3_ENDPOINT`                 | Região e endpoint opcional S3 compatível                                         |
| `S3_BUCKET`                                | Bucket de imagens                                                                |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Credenciais restritas ao bucket; segredo                                         |
| `S3_PUBLIC_URL`                            | Base HTTPS pública das imagens                                                   |
| `WORKER_INTERVAL_MS`                       | Intervalo entre rodadas, padrão 60.000 ms                                        |

Escolha o valor de `TRUST_PROXY` conforme a topologia documentada do provedor. Não configure confiança irrestrita em cabeçalhos enviados pelo cliente.

## E-mail sem compra obrigatória de domínio

A aplicação aceita SMTP. O serviço concreto **ainda não foi escolhido nem testado**. Alguns serviços exigem domínio próprio para autorizar o remetente; nesse caso, essa opção conflita com a preferência informada. Antes de contratar, escolha uma alternativa que permita uma caixa/remetente já autorizado sem exigir compra de domínio, confirme limites de envio e faça um teste real de entrega e spam.

Mailpit é exclusivamente local. `example.test` é recusado como remetente em produção. Uma configuração SMTP preenchida não comprova entrega. Não use portas bloqueadas por um plano gratuito como se estivessem disponíveis.

## Backups e restauração

Faça backups regulares do PostgreSQL e do bucket, armazenados fora da aplicação e com acesso restrito. Agende a rotina na infraestrutura escolhida, e não no PC do proprietário. Os exemplos abaixo usam variáveis do terminal; não substitua por senhas em linhas que serão compartilhadas.

Em PowerShell, com ferramentas cliente PostgreSQL e `$env:DATABASE_URL` configurada de forma privada:

```powershell
pg_dump --dbname="$env:DATABASE_URL" --format=custom --file=loja-backup.dump
pg_restore --list loja-backup.dump
```

Para ensaio de restauração, crie **outro banco vazio**, configure `$env:RESTORE_DATABASE_URL` e execute:

```powershell
pg_restore --dbname="$env:RESTORE_DATABASE_URL" --no-owner --no-acl loja-backup.dump
```

Não execute `--clean` sobre a produção. Verifique quantidade de pedidos, usuários, itens, estoque e imagens restauradas. Criptografe backups que contenham dados pessoais; nunca compartilhe um dump no chat. Use a mesma versão principal do cliente e do banco ou uma versão compatível mais nova.

No Docker local, o volume `loja_db` preserva os dados. `docker compose down` para os serviços; **`docker compose down -v` apaga o banco local**, portanto não o use para atualização.

## Atualização e troca de provedor

1. Fazer backup e testar a restauração em ambiente separado.
2. Instalar a nova versão com `npm ci`; conferir mudanças de variáveis e migrations.
3. Rodar `npm run check`, `npm test` em ambiente de desenvolvimento e testes de homologação.
4. Aplicar migrations e atualizar web/worker em uma janela de manutenção. Migrations não têm rollback automático: restaure backup se uma migração de dados exigir retorno.
5. Para migrar, restaurar banco e copiar objetos mantendo os nomes. Atualizar `DATABASE_URL`, dados do S3 e `APP_URL`; revisar URLs de preferências antigas e webhook no Mercado Pago.
6. Rotacionar tokens/segredos nas contas dos provedores, atualizar variáveis e reiniciar processos. A troca de `SESSION_SECRET` invalida os cookies antigos. Revogue sessões no banco quando a situação exigir.
7. Monitorar `/health`, exceções nos pedidos, fila em `retry`/`quarantined`, falhas de e-mail e atraso da reconciliação. Logs não registram tokens nem senhas.

A primeira versão não substitui procedimentos operacionais de atendimento, controle de acesso aos eventos, gestão fiscal ou revisão das políticas reais da plataforma.
