# Validação Android do Carrim

## Estado em 03/10/2026

62 testes, lint, formatação, SQLite real, build web e `cap sync android` passaram. Revisão no navegador cobriu compra, produtos por unidade/peso/promoção, finalização, total do caixa, Histórico, filtros e reutilização do catálogo. O build web mantém aviso de tamanho inicial de 1,06 MB, sem ultrapassar o limite de erro.

APK, captura física, permissões do sistema e persistência nativa ainda não foram validados. Não foi encontrado SDK Android nem aparelho conectado neste ambiente. Há Java 25 e Java 8; o código Android do Capacitor usa Java 21. Sincronizar assets/plugins não confirma compilação ou execução nativa.

## Preparação

Usar Android Studio Otter 2025.2.1 ou mais recente, SDK Android 36 e JDK 21 para o projeto Android. Conferir o Gradle JDK nas configurações do Android Studio. O wrapper atual é Gradle 8.14.3 e o plugin Android é 8.13.0; não trocar o wrapper apenas para usar o Java 25 do backend. O app suporta Android a partir da API 24.

Referências: [Capacitor 8](https://capacitorjs.com/docs/updating/8-0) e [compatibilidade Java/Gradle](https://docs.gradle.org/current/userguide/compatibility.html). O backend continua com seu próprio Java 25.

No frontend, executar no PowerShell com Node compatível com `package.json`:

```powershell
Set-Location C:\workspace\frontend\mercado
npm test
npm run lint
npm run format:check
npm run verify:sqlite
npm run build
npx cap sync android
npx cap open android
```

No Android Studio, aguardar a sincronização, selecionar o aparelho e executar o app. Para gerar APK pela linha de comando, configurar previamente o SDK e o JDK 21 na sessão; então:

```powershell
Set-Location C:\workspace\frontend\mercado\android
.\gradlew.bat assembleDebug
```

O APK esperado é `android/app/build/outputs/apk/debug/app-debug.apk`, relativo à raiz do frontend. Com depuração USB habilitada e autorizada no aparelho:

```powershell
Set-Location C:\workspace\frontend\mercado
& C:\platform-tools\adb.exe devices
& C:\platform-tools\adb.exe install -r android/app/build/outputs/apk/debug/app-debug.apk
```

O caminho do adb acima corresponde a este computador. A instalação com `-r` preserva dados de um app com o mesmo identificador e assinatura; assinatura incompatível exige resolver a instalação antes do teste. Não desinstalar nem limpar dados ao verificar persistência ou atualização.

## Roteiro no aparelho

Registrar modelo, versão Android, commit, versão do APK e resultado de cada etapa. Usar dados de teste; não conectar banco remoto.

| Etapa               | Ação e resultado esperado                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primeiro uso        | Abrir sem pedir câmera imediatamente. Criar mercado e compra com limite opcional.                                                                                   |
| Unidade             | Adicionar duas unidades de R$ 7,99: R$ 15,98. Controles avançam uma unidade e respeitam o mínimo.                                                                   |
| Peso                | Adicionar 824 g a R$ 6,99/kg: R$ 5,76. Editar para 500 g: R$ 3,50.                                                                                                  |
| Promoção            | Cadastrar 3 por R$ 10,00: seis unidades custam R$ 20,00. Controles avançam grupos completos; quantidade inválida é recusada.                                        |
| Scanner e permissão | Abrir Escanear, permitir câmera e ler código físico. Repetir com permissão negada e confirmar alternativa manual e orientação para configurações.                   |
| Ciclo da câmera     | Cancelar, trocar aba e colocar em segundo plano: captura deve parar. Retornar e iniciar nova leitura. Leituras repetidas não abrem várias confirmações simultâneas. |
| Código desconhecido | Cadastrar nome e preço; confirmar somente uma vez. Verificar zeros iniciais do código e item no Carrinho.                                                           |
| Finalização         | Informar total do caixa diferente e finalizar. Histórico mostra total calculado, caixa e diferença; itens permanecem somente leitura.                               |
| Catálogo            | Criar outra compra no mesmo mercado, buscar nome acentuado com caixa diferente ou código. Seleção mostra referência anterior e exige preço de hoje.                 |
| Sem conexão         | Em modo avião, repetir cadastro manual, edição, finalização, Histórico e busca local. Testar scanner e registrar sua disponibilidade offline neste aparelho.        |
| Persistência        | Fechar o processo e reabrir: compra ativa, itens, compras finalizadas e catálogo devem permanecer. Repetir após instalação de atualização com `-r`.                 |
| Histórico           | Conferir Todas/Este mês, grupos mensais e detalhes. Verificar retorno do segundo plano em mudança de mês quando possível.                                           |
| Visual              | Conferir safe areas, barra inferior, teclado, rolagem, botões, fonte ampliada e orientação. Finalização deve continuar acessível sem cobrir itens.                  |

## Registro de execução

Preencher após a execução real. Nenhuma linha pendente significa aprovação implícita.

| Verificação                 | Resultado atual | Evidência                                                |
| --------------------------- | --------------- | -------------------------------------------------------- |
| Testes e ferramentas locais | Passou          | 62 testes; lint, Prettier, SQLite real, build e cap sync |
| Navegador                   | Passou          | Fluxos interativos em larguras de celular                |
| Compilação APK              | Pendente        | SDK/JDK 21 não disponíveis nesta sessão                  |
| Aparelho                    | Pendente        | adb sem dispositivo conectado                            |
| Câmera e permissões         | Pendente        | Requer execução nativa                                   |
| SQLite nativo e atualização | Pendente        | Requer execução nativa                                   |

Ao encontrar falha, registrar etapa, valores, resultado esperado/obtido e evidência. Corrigir em branch `fix/<correcao>` a partir da main e repetir a etapa afetada antes de considerar a validação concluída.
