# Abrir com dois cliques · versão 2.1.0

1. Clique com o botão direito no ZIP e selecione **Extrair Tudo**.
2. Abra a pasta extraída e dê dois cliques em **ABRIR_INGRESSOS.bat**.
3. Aguarde a preparação automática. Na primeira vez é necessário estar conectado à internet.
4. O navegador abre uma tela para criar o administrador. Preencha nome, e-mail e senha com pelo menos 12 caracteres. Depois, o painel de eventos abre automaticamente.

Nas próximas vezes, use o mesmo arquivo. Ele inicia o banco, o site e a rotina de reservas. **Não é necessário instalar Node.js ou Docker manualmente, editar `.env` ou digitar comandos.**

## Para usar e encerrar

O painel inicial tem os botões **Ver meu site de ingressos**, **Administrar eventos** e **Encerrar o site com segurança**. No rodapé do site há um link para voltar ao painel inicial. Mantenha a janela do programa aberta enquanto estiver usando o site.

Os componentes são baixados para `.runtime` e `node_modules`, dentro de `sistema`. Os cadastros, banco, configurações e imagens ficam em **sistema/dados-locais**. Guarde essa pasta e não a apague. Para uma cópia integral de segurança local, encerre o programa normalmente antes de copiar toda a pasta extraída.

O programa usa apenas o próprio computador (`127.0.0.1`) e normalmente abre na porta 3050. Se estiver ocupada, procura outra automaticamente. O endereço correto é aberto no navegador e exibido na janela. O link completo do painel inicial contém uma chave local temporária: não compartilhe esse link.

## Recuperar a senha sem instalar servidor de e-mail

Clique em **Esqueci minha senha** na tela de login. Depois, volte ao painel inicial e clique em **E-mails de teste / recuperar senha**. A mensagem com o link aparece ali. Essas mensagens são locais, ficam disponíveis apenas durante a execução e não são enviadas para o endereço de e-mail real.

## Compatibilidade e primeira abertura

Preparado para **Windows 10/11 x64, em computador Intel ou AMD**, com PowerShell padrão do Windows. Não é um instalador para Windows ARM ou 32 bits. Não solicita administrador, não altera o PATH permanente e não muda políticas de execução do sistema. Se uma política da empresa impedir a execução, consulte o responsável pelo computador.

Na primeira abertura, baixa o Node.js portátil oficial 24.22.1 e confere o SHA-256 antes de extrair. Depois instala as dependências fixadas no `package-lock.json` pelo npm, incluindo o PostgreSQL local. A duração depende da conexão e do computador. É necessário acesso HTTPS a `nodejs.org` e ao registro npm. Interromper downloads não apaga cadastros; abra novamente para tentar concluir.

Não execute o arquivo diretamente de dentro do ZIP. Extraia a pasta completa, de preferência em uma pasta local que não esteja sincronizando pelo OneDrive, em rede ou dentro de Arquivos de Programas.

## Diferenças do modo avançado

O modo fácil cria um banco local separado e mantém pagamentos desativados, mesmo se existir `.env` do modo avançado. Ele não altera nem importa automaticamente dados de uma instalação antiga. Preserve a instalação anterior se já cadastrou informações nela.

As instruções antigas de servidor, SMTP, Mercado Pago e hospedagem continuam disponíveis para a etapa posterior de publicação. Para usar o modo fácil agora, basta seguir os quatro passos iniciais. Este modo não publica o site na internet e não habilita cobranças reais.

## Se aparecer erro

A janela permanece aberta com a mensagem. Envie uma foto da mensagem para identificar a etapa. Falhas na instalação também ficam registradas em **sistema/logs/instalacao.txt**; confira se não há informações pessoais antes de compartilhar o arquivo.

Se o programa disser que já está aberto, volte para a janela anterior. Depois de uma queda de energia, abra normalmente para o PostgreSQL recuperar o banco. Se a abertura continuar bloqueada, reinicie o computador e tente novamente; não apague arquivos do banco para forçar o início.

## Validação e referências

A automação de banco, criação única do administrador, login, recuperação local, encerramento e persistência foi executada em Linux. O arquivo BAT foi revisado, mas não executado em um Windows real neste ambiente. A primeira abertura no seu Windows ainda precisa confirmar os downloads, as dependências nativas e a abertura do navegador.

- Distribuição oficial e checksum do Node.js: https://nodejs.org/en/blog/release/v24.22.1/
- Compatibilidade do PostgreSQL incorporado com Windows x64: https://github.com/leinelissen/embedded-postgres
