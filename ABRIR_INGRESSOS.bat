@echo off
setlocal
title Seu Ingresso - Inicio Facil
cd /d "%~dp0"
set "INGRESSOS_ROOT=%~dp0"
echo.
echo SEU INGRESSO - ABERTURA AUTOMATICA
echo.
echo Na primeira vez, mantenha a internet conectada.
echo Nao e necessario instalar Docker nem digitar comandos.
echo.
if not exist "scripts\prepare-easy.js" goto incompleto
powershell.exe -NoLogo -NoProfile -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $m=$null; $held=$false; try { $arch=if($env:PROCESSOR_ARCHITEW6432){$env:PROCESSOR_ARCHITEW6432}else{$env:PROCESSOR_ARCHITECTURE}; if($arch -ne 'AMD64'){throw 'Esta versao requer Windows 10 ou 11 de 64 bits, Intel ou AMD.'}; $root=$env:INGRESSOS_ROOT; $hash=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant()))).Replace('-',''); $m=[Threading.Mutex]::new($false,('Local\SeuIngresso_'+$hash)); try {$held=$m.WaitOne(0)} catch [Threading.AbandonedMutexException] {$held=$true}; if(-not $held){try {$info=Get-Content -LiteralPath (Join-Path $root 'dados-locais\aberto.json') -Raw | ConvertFrom-Json; if($info.url -match '^http://127[.]0[.]0[.]1:[0-9]+/iniciar#[a-f0-9]{64}$'){Start-Process -FilePath $info.url; Write-Host 'Site ja iniciado. Reabrindo o navegador.'}else{Write-Host 'O programa esta iniciando. Aguarde a janela anterior.'}} catch {Write-Host 'O programa esta iniciando. Aguarde a janela anterior.'}; exit 0}; $runtime=Join-Path $root '.runtime'; $nodeDir=Join-Path $runtime 'node-v24.22.1-win-x64'; $node=Join-Path $nodeDir 'node.exe'; if((-not (Test-Path -LiteralPath $node)) -or (-not (Test-Path -LiteralPath (Join-Path $nodeDir 'pronto.txt')))){ Write-Host '[1/4] Baixando o componente oficial do Node.js...'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; New-Item -ItemType Directory -Force -Path $runtime | Out-Null; $zip=Join-Path $runtime 'node-download.zip'; Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/v24.22.1/node-v24.22.1-win-x64.zip' -OutFile $zip; if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne 'D2046D28C2C3DCD211AC5145C0BF30E2047EF9DFB306693C8C6E2ECCD8B95FA5'){Remove-Item -LiteralPath $zip; throw 'Download incompleto ou diferente do original. Abra novamente para tentar de novo.'}; Expand-Archive -LiteralPath $zip -DestinationPath $runtime -Force; Set-Content -LiteralPath (Join-Path $nodeDir 'pronto.txt') -Value '24.22.1'; Remove-Item -LiteralPath $zip; } else {Write-Host '[1/4] Componente do Windows pronto.'}; $env:PATH=$nodeDir+';'+$env:PATH; Set-Location -LiteralPath $root; & $node (Join-Path $root 'scripts\prepare-easy.js'); if($LASTEXITCODE -ne 0){exit $LASTEXITCODE} } catch { Write-Host ('ERRO: '+$_.Exception.Message) -ForegroundColor Red; Write-Host 'Envie uma foto desta janela se precisar de ajuda.'; exit 1 } finally {if($held -and $m){$m.ReleaseMutex()}; if($m){$m.Dispose()}}"
if errorlevel 1 goto falha
echo.
echo Programa encerrado. Para abrir novamente, use este mesmo arquivo.
pause
exit /b 0
:incompleto
echo Extraia TODOS os arquivos do ZIP antes de abrir o programa.
echo Clique com o botao direito no ZIP e escolha Extrair Tudo.
pause
exit /b 1
:falha
echo.
echo A abertura nao foi concluida. Veja a mensagem acima.
echo Nao apague a pasta dados-locais. Ela guarda seus cadastros.
pause
exit /b 1
