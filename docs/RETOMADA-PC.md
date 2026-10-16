# Retomada do Carrim no PC

Registro consolidado em 16/10/2026. Escopo: documentação; nenhuma funcionalidade nova. Os dois checkouts estavam limpos antes desta atualização. Evidências de execução abaixo pertencem ao ambiente cloud anterior; não demonstram execução no PC nem foram repetidas nesta atividade.

## Ponto de partida e versões

São dois repositórios independentes, `carrim-api` e `carrim-mobile`. A base integrada é `main` em ambos. Versões dos manifests não foram incrementadas pelas entregas de sincronização e não significam release publicada.

| Componente | Versão/configuração registrada                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| API        | 0.0.8; Java 25; Spring Boot 4.1.1; Maven Wrapper 3.9.16; PostgreSQL 18                                           |
| Mobile     | 0.0.2; Node >=24.15.0 e <25; npm 11.9.0                                                                          |
| Interface  | Angular 22.2.1 (CLI/build 22.2.0); Ionic 9.0.6; TypeScript ~6.0.0                                                |
| Capacitor  | core/Android 8.5.2; CLI 8.4.3; SQLite 8.1.1; secure-storage 8.0.1                                                |
| Android    | JDK 21 completo; Gradle 8.14.3; plugin 8.13.0; SDK mínimo 24, compile/target 36; plataformas/build-tools 35 e 36 |
| APK        | versionName 0.0.2; versionCode 2; somente debug compilado                                                        |

Usar os manifests e lockfiles para versões exatas; não atualizar dependências apenas para retomar. Java do Android e da API são distintos. iOS ainda não foi gerado/validado e exige macOS/Xcode.

## Branches, commits e PRs integrados

Todos os PRs abaixo foram mergeados em `main`; as branches são referências históricas, sua existência remota não é requisito. Os números de PR pertencem ao repositório da coluna. Consultar com `gh pr view NUMERO` dentro do respectivo checkout, ou na aba Pull requests do GitHub.

| Repositório | PR  | Branch da entrega                | Último commit da entrega                 | Merge em main                            |
| ----------- | --- | -------------------------------- | ---------------------------------------- | ---------------------------------------- |
| API         | #11 | feature/sync-idempotent-push     | f051743a1dc8bc5029c491398da2ef5f1dcc8508 | 02403b7775861ff91900564f3d1a6749a74451d5 |
| API         | #12 | feature/sync-pull-conflicts      | 42dacdd21dd7178805f7e62aeea57eaf740668dd | 711a7b233246aed01dc7bc8773c196ff88084426 |
| API         | #13 | feature/production-readiness     | c8fc6b125600f8346f284ddae1e0e9ef0b6a39ed | 8515b4891742c0c09b4d220d6b5d1c73df351d1b |
| Mobile      | #13 | feature/local-sync-owner         | 6044ec701f4b109d68f274fd1b9f53b3735e9250 | 361acfc63bcc7097d82c4f535b89b62b6b750546 |
| Mobile      | #14 | feature/sync-pull-conflicts      | 180050cbd8cd2e5e72193951854dbbb2cc1e8c09 | bc0f5c6a8b2f8391ebb039608bd40c2b640fda8f |
| Mobile      | #15 | feature/sync-integration-android | fdea7dd2b98903729ff467ca8e3c94e0df7dc3c4 | ea5ad496b56c8777f2100eadd99516960bab9fec |
| Mobile      | #16 | feature/production-api-config    | c0bd7c57fdfa42a1801d68b4d5d78fd47f680d09 | 700bccec4fe2e9d2c864e0e94b82ec97cb96d2bc |

As revisões corrigiram importação e ordenação de snapshots, pausas/retries, limite de corpo após autorização, health sem sessão/cache, normalização de HTTPS e snapshots remotos inválidos. O conteúdo das mains após os merges foi comparado com as árvores das entregas finais validadas. CI pós-merge passou nos dois repositórios; execução mobile registrada: 38494822936. Não houve deploy ou release V1.0.0.

## Funcionalidades implementadas

- Compras locais com SQLite: mercados, catálogo por código/nome, unidade/peso/promoção, orçamento, scanner integrado, finalização com total do caixa, histórico/filtro e reutilização de produtos. A integração do scanner não comprova leitura física.
- API protegida com identidade anônima, propriedade derivada do token, validação, versionamento e isolamento de usuários.
- Push idempotente: lote ordenado de até 50 operações, recibo e mutação atômicos, replay sem duplicação, hash do payload e interrupção no primeiro erro. V5 adiciona recibos de sync.
- Pull paginado por proprietário com journal transacional e cursor opaco; V6 inclui journal e estado preexistente.
- Identidade nativa em armazenamento protegido e vínculo SQLite ao proprietário; perda/divergência de identidade bloqueia sync, preservando compras.
- Fila nativa ordenada com reserva, recuperação de execução interrompida, backoff persistido e proteção contra respostas atrasadas (SQLite V9); pedido congelado antes do primeiro envio e preservado no retry (V10).
- Bootstrap/pull com estágio persistente e aplicação por dependências; edições locais pendentes são preservadas. Conflitos explícitos pausam dependentes; ainda não há resolução assistida nem auto-rebase seguro.
- Endpoint HTTPS configurável antes do build; sync inicia apenas no Capacitor com endpoint configurado. Navegador mantém compras locais, sem sincronização persistente.
- Preparação de produção: TLS verificado no PostgreSQL, health privado, logs JSON, imagem sem root, limite de corpo de 2 MiB e payload de sync de 32 KiB; CI de backend e mobile, incluindo compilação Android.

## Verificações executadas e limites

| Verificação anterior                      | Resultado                                                                                                                      | O que não comprova                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Backend `mvnw verify`, PostgreSQL isolado | 130 testes, zero falhas/erros/skips; BUILD SUCCESS                                                                             | Banco/infraestrutura de produção e execução no PC          |
| Mobile com `CARRIM_LIVE_SYNC=1 npm test`  | 107 testes passaram, 21 arquivos                                                                                               | Plugins nativos reais, câmera, Keystore/Keychain           |
| Integração live                           | API/PostgreSQL e SQLite reais; compra offline, reabertura, resposta de push perdida, replay e alteração REST recebida por pull | Execução física offline/online e HTTPS público             |
| Ferramentas mobile                        | lint, formatação, verify:sqlite, build e cap sync passaram                                                                     | Funcionamento no aparelho                                  |
| Android                                   | assembleDebug passou localmente e no CI                                                                                        | APK release assinado, instalação/atualização e compra real |
| Produção local descartável                | Imagem sem root; TLS com CA de teste; readiness UP/DOWN; health negado na porta principal                                      | Domínio, CA, segredos, backup e monitoramento reais        |
| Navegador                                 | Fluxos de compra/histórico em larguras de celular revisados em entregas anteriores                                             | Aprovação do layout pretendido ou sync web persistente     |

Sem `CARRIM_LIVE_SYNC=1`, o teste live é explicitamente pulado. CI mobile padrão não executa essa integração com API. Aviso de bundle inicial acima de 1 MB permanece, sem exceder o limite de erro.

Logs da sessão cloud (`/workspace/setup/health-session-tests.log` e `malformed-snapshot-tests.log`) confirmam as contagens, mas não fazem parte do Git nem estarão necessariamente no PC. O APK cloud em `/workspace/artifacts/carrim-sync-debug.apk` também não é um artefato versionado; pode ser regenerado. Não copiar caches, bancos, logs brutos ou configurações privadas para o repositório.

## Retomada segura no PC

1. Em cada checkout, executar `git status --short --branch`. Preservar trabalho local: não usar reset, clean, descarte ou desinstalação para alinhar ambientes. Resolver mudanças locais conscientemente antes de trocar de branch.
2. Com a árvore preparada, executar `git fetch origin`, `git switch main` e `git pull --ff-only origin main`. Conferir `git log -5 --oneline` contra os merges acima; commits posteriores podem existir. Não recriar as branches antigas para continuar.
3. Conferir ferramentas. API: JDK 25 e Docker para PostgreSQL descartável ou roteiro Windows `scripts/verify-local-postgres.ps1`. Mobile: Node compatível, npm 11.9.0; Android com JDK 21 completo e SDK 35/36. Não reutilizar caminhos absolutos do cloud no PC.
4. API: `./mvnw verify` (Windows: `.\mvnw.cmd verify`); alternativa Windows sem Docker: `./scripts/verify-local-postgres.ps1`. Para executar a API, configurar as variáveis de banco no ambiente local, sem gravar valores em documentos, e usar `mvnw spring-boot:run`. Ver README e API-LOCAL.
5. Mobile: `npm ci`, `npm test`, `npm run lint`, `npm run format:check`, `npm run verify:sqlite`, `npm run build`. Iniciar API em 8082 e `npm start` em 4202 para desenvolvimento via proxy local. Não usar banco real nos testes.
6. Integração opt-in com API local e banco isolado: shell POSIX `CARRIM_LIVE_SYNC=1 npm test`; PowerShell `$env:CARRIM_LIVE_SYNC='1'; npm test` e depois remover a variável com `Remove-Item Env:CARRIM_LIVE_SYNC`.
7. Android: configurar endpoint HTTPS de teste conforme PRODUCAO, gerar configuração antes do build, executar build, `npx cap sync android` e `assembleDebug` com JDK 21. Configuração gerada é ignorada pelo Git e não vem automaticamente do clone. Instalar com atualização preservando assinatura/dados; nunca limpar SQLite/identidade para contornar conflito.

Não é necessário endpoint público para testar o fluxo web local; a validação de sincronização nativa exige HTTPS configurado. Guardar segredos somente no ambiente/gerenciador apropriado. Não enviar valores no chat ou em commits.

## Decisões e próximas atividades

1. Consolidar este registro e as correções documentais no Git. A atividade atual altera apenas documentação; sem incremento de versão.
2. Próximo desenvolvimento: resolução assistida de conflitos, com preservação do estado local/remoto e critérios de reconciliação explícitos. Auto-rebase seguro do documento-base ainda não está entregue; não desbloquear FAILED nem trocar operationId automaticamente.
3. Preparar ambiente de homologação HTTPS com banco/CA/segredos próprios, gateway/rate limit distribuído, monitoramento privado e backup com restauração testada. Requer escolha/configuração de infraestrutura; nenhum deploy foi realizado.
4. Executar roteiro em aparelho Android: câmera e permissões, Keystore, SQLite nativo, fechamento/reabertura, segundo plano, atualização preservando dados e sync offline/online. Registrar modelo/versão Android, commit e resultados sem dados pessoais. Depois testar uma compra real no supermercado.
5. Preparar assinatura/distribuição Android e checklist de release V1.0.0. A validação iOS depende de ambiente Apple. Layout foi adiado pelo usuário; não redesenhar nesta retomada.

Não confundir implementação com aprovação de hardware, homologação pública ou release. Compras e identidade anônima não possuem recuperação garantida após limpeza/desinstalação; não realizar essas ações para testar atualização.

## Documentos antigos e contradições

- `carrim-api/docs/STATUS-DESENVOLVIMENTO.md`: dizia “em PR”, “sem merge” e que as entregas não estavam na main. Resumo corrigido nesta atividade.
- README da API: dizia que sincronização estava pendente e toda rota era negada. Resumo corrigido; seções históricas preservadas não substituem API-LOCAL nem o código atual.
- `carrim-api/docs/API-LOCAL.md`: introdução do cliente dizia que não enviava fila. Corrigida; exemplos de versões antigas representam o contrato daquela etapa.
- README mobile: dizia que APK não fora compilado e que não havia envio automático. Resumo corrigido. Relatos datados antigos foram preservados como histórico, não checklist atual.
- `carrim-mobile/docs/VALIDACAO-ANDROID.md`: abertura/tabela de 08/10 dizia SDK ausente e APK pendente, enquanto a seção cloud registrava compilação. Tabela atual e aviso histórico corrigidos; contagem live consolidada em 107.
- `carrim-mobile/docs/INTEGRACAO-SEGURANCA.md`: seções incrementais falam em processador/pull/endpoint futuros e APK pendente. Permanecem como histórico, com aviso de precedência para este registro e seções finais.
- PRODUCAO da API descrevia ordem futura dos PRs: atualizado para merges concluídos. Os checklists externos continuam abertos nos dois PRODUCAO.
- `carrim-api/docs/carrim-documento-base-v12.md`: referência de produto/backlog, não status de execução. Caixas não marcadas e “próxima etapa” ao longo das seções são históricas; não assumir que tudo falta nem que auto-rebase já existe. Layout de referência não é aprovação do layout atual.
- CHANGELOG da API registra 119 testes em 0.0.8; é o resultado histórico dessa entrega. Acrescentado registro não lançado para as mudanças posteriores sem inventar versão nova.

Este registro e o status resumido prevalecem para retomada; manifests/código e novas evidências devem resolver divergências futuras.

## Como disponibilizar esta atualização

O registro está em `docs/RETOMADA-PC.md` nos dois repositórios para consulta independente. Alterações documentais ficam inicialmente locais: só estarão no PC depois de commit/push e integração no remoto. Não presumir que salvar um arquivo na sessão publica no GitHub.

Revisar `git diff --check` e `git diff` em cada repositório. Em branch `docs/retomada-pc` criada da main preparada, adicionar apenas os Markdown alterados, fazer commit, push e abrir PR para main. Todo PR para main deve receber o comentário exato `@codex review` conforme AGENTS.md. Corrigir apontamentos antes do merge. Autorizações anteriores de PR/merge permanecem válidas no escopo já acordado; este documento não autoriza deploy.

Após integração, no PC usar `git pull --ff-only` nos dois checkouts e abrir `docs/RETOMADA-PC.md`. Se os repositórios não estiverem lado a lado, consultar o arquivo equivalente no outro repositório. Não incluir dados locais ou credenciais ao publicar.
