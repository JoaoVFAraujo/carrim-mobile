# Validação Android

Guia operacional do aparelho. Resultado consolidado de testes/CI e prioridades ficam no [roadmap](https://github.com/JoaoVFAraujo/carrim-api/blob/main/docs/ROADMAP.md); configuração HTTPS e comandos web no [README](../README.md).

APK debug já foi instalado e aberto no Moto G73/Android14 no PC, com SQLite criado. Isso não conclui a validação física de câmera, galeria, Keystore, atualização e fluxo completo; conferir o roteiro abaixo. Não presumir que SDK/dispositivo disponíveis no Cloud existem no PC. iOS exige validação própria.

## Preparar e instalar

JDK 21 completo com javac (não JRE nem Java 25 do backend), Android Studio compatível com Capacitor 8, SDK/plataformas 35/36 e Build Tools 35/36. Projeto usa Gradle 8.14.3, plugin 8.13.0, minSdk 24 e compile/target 36. Configurar JAVA_HOME/SDK e Gradle JDK da sessão sem trocar ferramentas globais.

No frontend, depois de configurar endpoint HTTPS de teste se for validar sync:

```powershell
npm run build
npx cap sync android
npx cap open android
```

Ou, para compilar pelo terminal, na pasta android:

```powershell
.\gradlew.bat assembleDebug
```

APK: android/app/build/outputs/apk/debug/app-debug.apk, relativo à raiz do frontend. Com depuração USB autorizada, executar na raiz (adb deve estar no PATH ou usar o caminho do SDK local):

```powershell
adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Mesmo appId br.com.carrim e mesma assinatura para atualizar preservando dados. Não desinstalar ou limpar dados se a assinatura não coincidir: resolver distribuição antes do ensaio. Manifest atual 0.0.2/versionCode 2; não confundir debug com release.

## Roteiro de aceitação

Usar dados de teste, endpoint autorizado e banco isolado. Não conectar produção nem copiar dados pessoais. Sync nativo exige HTTPS confiável; o teste live com plugins substituídos não cobre este roteiro.

| Etapa              | Resultado esperado                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Primeiro uso       | Não pedir câmera imediatamente; criar mercado e compra com limite opcional                                                           |
| Unidade            | 2 × R$ 7,99 = R$ 15,98; stepper respeita mínimo e máximo                                                                             |
| Peso               | 824 g × R$ 6,99/kg = R$ 5,76; editar para 500 g = R$ 3,50                                                                            |
| Promoção           | 3 por R$ 10,00; seis custam R$ 20,00; grupo incompleto recusado                                                                      |
| Scanner            | Ação explícita pede câmera; ler código conhecido/desconhecido, preservar zeros iniciais e confirmar preço de hoje                    |
| Permissão negada   | Revogar câmera nas configurações, sem limpar dados; negar pedido e conferir alternativa manual/orientação                            |
| Ciclo da câmera    | Cancelar leitura, trocar aba e ir ao segundo plano encerra captura; retorno permite nova leitura, sem sheets duplicados              |
| Finalização        | Confirmação, caixa opcional inclusive zero; diferença não altera itens; Histórico somente leitura                                    |
| Catálogo           | Nova compra no mesmo mercado encontra nome acentuado/código; referência anterior com data e preço atual obrigatório                  |
| Offline            | Em modo avião, criar/editar/remover itens, finalizar e consultar Histórico; registrar disponibilidade do scanner neste aparelho      |
| Persistência       | Fechar processo/reabrir e atualizar com -r preserva compra, itens, catálogo, Histórico e identidade                                  |
| Sync               | Offline → online envia fila sem duplicar; recebe alterações remotas e mantém edição local pendente                                   |
| Conflito           | Estados divergentes pausam dependentes, mostram atenção e conservam dados; não forçar desbloqueio                                    |
| Credenciais        | Identidade persiste após atualização; ausência/falha do Keystore impede sync sem inutilizar compras locais                           |
| Transporte         | Recusar HTTP, redirects e configuração inválida; dados sensíveis ausentes de Web Storage, SQLite, logs e backup                      |
| Histórico e visual | Filtro mensal/retorno do segundo plano, grupos e detalhes; conferir safe areas, 320/390 px, teclado, fonte ampliada e leitor de tela |

Depois do roteiro, ensaiar uma compra real no supermercado. Não registrar câmera/Keystore/SQLite nativo como aprovados apenas porque assembleDebug ou testes unitários passaram.

## Registro mínimo

Atualizar esta tabela somente após execução real, indicando modelo, Android, commit, versão/assinatura e evidência sem dados pessoais. Não criar um arquivo por execução; histórico fica no Git.

| Verificação física                         | Resultado | Evidência |
| ------------------------------------------ | --------- | --------- |
| Instalação e atualização preservando dados | Pendente  | —         |
| Câmera, permissão e ciclo de vida          | Pendente  | —         |
| Keystore e proprietário                    | Pendente  | —         |
| SQLite nativo, reabertura e offline        | Pendente  | —         |
| HTTPS, push/pull e conflito no aparelho    | Pendente  | —         |
| Acessibilidade e compra real               | Pendente  | —         |

Ao falhar, registrar esperado/obtido, corrigir em branch fix e repetir o trecho afetado. Produção e assinatura/distribuição release exigem o [guia de Segurança](https://github.com/JoaoVFAraujo/carrim-api/blob/main/docs/SEGURANCA.md).

## Fotos e moderação no aparelho

Registro de 21/10/2026: APK desta entrega compilado com JDK 21/Gradle 8.14.3, assinatura v2 verificada e instalado com atualização preservando dados no Moto G73 conectado. MainActivity iniciada e processo permaneceu ativo. A tela estava apagada durante a captura; isso não confirma layout, câmera, galeria ou aceitação do fluxo físico. Versão 0.0.2/code 2, sem API HTTPS nativa configurada. SHA-256 do APK: `5E715EAE5CA25B69933ACBD31843ECA15A32CFD46062BEA91B028BF291766533`. PR da entrega: [mobile #32](https://github.com/JoaoVFAraujo/carrim-mobile/pull/32), com [API #22](https://github.com/JoaoVFAraujo/carrim-api/pull/22).

- Fotografar e selecionar JPEG/PNG por ação explícita; cancelar/recusar sem perder produto ou foto anterior.
- Conferir prévia alta/larga/quadrada, substituir uma foto externa, remover e restaurar explicitamente.
- Modo avião: foto aparece no Carrinho, sobrevive ao fechamento/reabertura e aguarda envio; compra continua e pode finalizar.
- Com API HTTPS configurada: reenviar sem duplicação após reconectar e depois da finalização; autor vê pendente e outro proprietário não consegue acessar antes da aprovação.
- Administrador aprova pelo painel; outro cliente encontra a imagem/nome aprovado pelo EAN. Substituta pendente mantém a foto pública anterior. Rejeição/retirada é recebida ao reconectar.
- Encerrar processo durante a atividade de câmera e retornar: recuperar rascunho para confirmação, sem envio ou vínculo automático.
- Atualizar com mesma assinatura sem limpar dados; migration011 preserva compras/identidade e adiciona fotos, preferências e fila de mídia.

Build/instalação não comprovam essas etapas. Sem endpoint HTTPS no APK, somente os fluxos locais/offline podem ser aceitos no aparelho; integração online pode ser conferida no navegador com API local isolada. Nenhuma chave administrativa deve ser incluída no build.
