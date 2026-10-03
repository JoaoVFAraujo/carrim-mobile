# Carrim Mobile

Aplicativo do Carrim para acompanhar compras de supermercado. Este repositório e `JoaoVFAraujo/carrim-api` formam o mesmo produto.

## Estado: 0.0.1 — Fluxo local de compras

Base Angular/Ionic standalone, navegação com carregamento sob demanda, Tailwind e Capacitor Android. SQLite suporta compra ativa, produtos manuais ou por código, orçamento, finalização, Histórico somente leitura e compras recentes no Início. O scanner MLKit está integrado; sua execução com câmera em aparelho Android permanece pendente. Produtos por peso, autenticação e sincronização remota ficam para próximas entregas.

## Stack e pré-requisitos

- Node.js 24 LTS, a partir de 24.15.0; npm 11.
- Angular 22.2, Ionic 9, Capacitor 8.5, TypeScript 6 e Tailwind CSS 4.
- Vitest, ESLint e Prettier. As versões resolvidas estão no `package-lock.json`.
- Android Studio/SDK são necessários para compilar e executar o aplicativo Android.
- macOS e Xcode serão necessários para validar a plataforma iOS.

## Executar e validar

```bash
npm ci
npm start
```

```bash
npm run lint
npm run format:check
npm test
npm run verify:sqlite
npm run build
```

```bash
npm run format
```

A aplicação web de desenvolvimento fica em `http://localhost:4200`.

## Android

O projeto nativo está em `android/`; o applicationId é `br.com.carrim` e o nome é Carrim.

```bash
npm run build
npx cap sync android
npx cap open android
```

A versão nativa acompanha `0.0.1`; o versionCode começa em 1. `cap sync` atualiza os assets web e plugins, mas não compila um APK. A validação de APK e dispositivo real ainda está pendente.

O bundle identifier iOS também será `br.com.carrim`. A plataforma iOS ainda não foi gerada.

## Estrutura e UI

- `src/app/app.ts`, `app.html`, `app.config.ts` e `app.routes.ts`: raiz, providers e rotas.
- `src/app/features/home/pages`: primeira página, com HTML separado.
- `src/app/theme`: variáveis de tema Ionic.
- `src/styles.css`: CSS Ionic e Tailwind.
- `src/app/core/database`: conexão SQLite e migrations.
- `src/app/features/shopping`: modelos e estado da compra ativa.
- `src/app/shared/components`: estados vazios reutilizáveis.

Prioridade: Ionic/Angular → Tailwind → CSS manual. As classes Tailwind usam prefixo `tw:`. O Preflight do Tailwind não é importado, preservando os resets do Ionic. Não recriar componentes Ionic com CSS quando existir uma API nativa adequada.

Signals controlam o estado da compra ativa, supermercados, carregamento e erros. Os imports standalone do Ionic 9 vêm de `@ionic/angular`.

## Segurança

Nenhum segredo ou token deve entrar no bundle. Tokens não serão armazenados em localStorage. Arquivos `.env` reais são ignorados. O app usa SQLite local para supermercados, catálogo, compras e preços. A câmera é solicitada somente ao tocar em Abrir câmera no aplicativo nativo. Não faz chamadas à API; a fila local ainda não envia operações ao servidor.

## Referência e evolução

O documento mestre está em [carrim-api/docs/carrim-documento-base-v12.md](https://github.com/JoaoVFAraujo/carrim-api/blob/main/docs/carrim-documento-base-v12.md). Neste Windows, consulte `C:\workspace\backend\mercado\docs\carrim-documento-base-v12.md`. O link remoto estará disponível após a publicação autorizada dos arquivos.

As decisões são revisáveis. As quatro abas compartilham uma base visual clara, cabeçalhos integrados, cartões e ações Ionic. O fluxo local de compra está disponível. As seções datadas abaixo registram a evolução; limitações antigas podem ter sido resolvidas nas entregas seguintes. CI, commit, push, PR e deploy exigem autorização própria.

## Validação local — 30/09/2026

Fundação transferida para `C:\workspace\frontend\mercado`, na branch `main`, preservando `imagem-teste.png`.

Node instalado: 24.14.0; npm: 11.9.0. O Angular desta fundação exige Node 24.15.0 ou superior dentro da linha 24. A instalação de dependências foi tentada, mas o ambiente de execução não conseguiu acessar o registry. Lint, formatação, testes, build e sincronização Android permanecem pendentes no Windows. Os resultados anteriores do ambiente Linux não constituem validação local. Nenhuma ferramenta global foi instalada ou substituída.

## Base visual: quatro abas e estados vazios

Navegação Ionic com abas Início, Escanear, Carrinho e Histórico, sempre disponíveis sem compra ativa. Cada página é carregada sob demanda e mantém HTML separado do TypeScript. O componente compartilhado `empty-state` usa inputs Signals; não existe estado de negócio simulado.

Rotas para teste no navegador:

- `/tabs/home`: início e últimas compras vazias.
- `/tabs/scanner`: nenhuma compra em andamento; não solicita câmera.
- `/tabs/cart`: carrinho vazio.
- `/tabs/history`: nenhuma compra finalizada.

A raiz e rotas desconhecidas redirecionam para `/tabs/home`. Além da navegação, Nova compra permite cadastrar ou selecionar supermercado e persistir a sessão no SQLite. Scanner, autenticação e sincronização remota ficam para as próximas etapas. O Ionic controla safe areas e comportamento por plataforma; a validação em dispositivo real permanece pendente.

Validação desta entrega no Windows: lint, Prettier, build e três testes passaram, incluindo navegação pelas quatro páginas e redirecionamentos. A inspeção visual em navegador não foi executada pelo assistente, pois a ferramenta de controle de navegador não está disponível nesta sessão.

A sincronização Android desta entrega foi tentada, mas o CLI falhou antes de sincronizar com ERR_SYSTEM_ERROR em uv_os_get_passwd (ENOMEM). Os assets nativos ainda precisam ser atualizados executando npx cap sync android no terminal do usuário.

## Primeira compra local — 30/09/2026

O Início agora permite abrir Nova compra, selecionar um mercado existente ou cadastrar outro e informar limite opcional. A compra ativa e seu supermercado persistem no SQLite; criação e operações da futura sincronização são gravadas juntas. O banco impede duas compras ativas.

O resumo e o Carrinho ainda têm total zero porque produtos não foram implementados. Scanner, finalização, cancelamento e histórico preenchido ficam para as próximas entregas. Não há comunicação com o backend nem sincronização remota.

A migration 1 cria somente supermercados, sessões, fila e metadados já utilizados. Catálogo e histórico serão adicionados com migrations futuras. Essa divisão adapta o documento mestre ao desenvolvimento incremental.

Android usa SQLite nativo via @capacitor-community/sqlite 8.1.1. O navegador de desenvolvimento usa jeep-sqlite 2.8.0 e IndexedDB; sql.js está fixado em 1.11.0 para compatibilidade com o WebAssembly embutido no jeep-sqlite. O Angular copia o WASM para assets no build. Os dados do navegador pertencem à origem (host e porta); usar outra porta cria outro conjunto local.

O tema claro tem cabeçalhos integrados ao fundo. As camadas CSS mantêm Ionic como base e Tailwind como utilities. Não há fotos/logos fictícios nem login obrigatório.

Validações desta entrega: sete testes unitários, lint, formatação e build; criação com limite de R$ 200,09 e recuperação após recarregar no navegador; verificação com SQLite real de schema, restrição de compra ativa, rollback e exportação/reabertura. A validação em aparelho Android continua necessária.

Servidor de revisão nesta sessão: http://localhost:4300 (4200 estava ocupado por outro projeto).

## Produtos manuais e orçamento — 03/10/2026

Carrinho permite adicionar, editar e remover produtos com nome, preço por unidade e quantidade inteira (1–9999). A remoção exige confirmação. Valores são calculados em centavos; Início e Carrinho exibem total, saldo e limite ultrapassado.

A migration 2 adiciona shopping_items sem apagar as sessões existentes. Alterações de itens e operações locais da fila são gravadas na mesma transação. A sincronização remota continua desativada. Produtos vendidos por peso e quantidades fracionadas ainda não são suportados.

Validação: testes de preços, quantidades, totais, orçamento e falha de persistência; lint e build. SQLite real verificou migração de v1 para v2, preservação da sessão, exportação/reabertura e constraints. Revisão visual interativa e execução em aparelho Android continuam pendentes. Próxima entrega: finalizar compra e consultar o histórico.

## Finalização e histórico — 03/10/2026

Finalizar compra exige ao menos um item e confirmação. Após salvar, o app abre Histórico; a sessão deixa de ser ativa e outra compra pode ser iniciada. Histórico exibe supermercado, data, total, número de produtos e detalhes somente para consulta. Início mostra as três compras finalizadas mais recentes.

A migration 3 cria price_history com preço por unidade, nome manual, quantidade, mercado e data; a gravação acontece na mesma transação da finalização e da fila local. Esses registros ainda não identificam um produto global por código de barras. Triggers impedem inserir, alterar ou remover itens de uma sessão encerrada. A migração preserva os dados existentes.

Validação em SQLite real: migrations v1–v3, reabertura com histórico e preços, bloqueio de edição e criação de uma nova compra ativa. Testes também cobrem compra vazia, falha na finalização e atualização do estado após sucesso. Execução em aparelho e revisão visual interativa continuam pendentes. Scanner e sincronização remota ainda não foram implementados.

Regra de PR: consulte AGENTS.md; todo PR para main deve receber comentário com @codex review.

## Revisão de finalização e Histórico — 03/10/2026

Confirmações repetidas são bloqueadas e chamadas concorrentes de finalização compartilham uma única operação. A fila só recebe COMPLETE quando a sessão realmente muda de estado; repetir a transação não duplica preços ou operações. Uma falha de leitura após salvar limpa o carrinho encerrado e permite tentar carregar o Histórico novamente, sem informar incorretamente que a finalização falhou. Navegação e feedback também distinguem compra salva de falha de gravação.

A migration 4 impede mover um item ativo para uma sessão encerrada. Ela também atualiza bancos que já executaram a migration 3, preservando compras e preços. Histórico tem título único, identificação acessível dos botões de detalhes e fechamento no cabeçalho do modal. A confirmação e o toast informam que a compra é salva neste aparelho.

Validação da revisão: 19 testes passaram; lint, Prettier, build e `cap sync android` passaram. A sincronização atualizou assets e plugins; não compilou nem executou um APK. SQLite real verificou migrations v1–v4, rollback, repetição sem duplicação, totais em centavos, exportação/reabertura, atualização de banco v3 com compra concluída e bloqueio de alteração dos itens encerrados.

Revisão interativa no navegador em largura de celular verificou criação, adição/edição, cancelamento de remoção e finalização, conclusão acima do limite, Histórico, detalhes somente leitura, compras recentes, persistência após recarregar e criação de outra compra sem limite. Os dados de teste pertencem à origem `http://127.0.0.1:4300`, separada de `http://localhost:4300`. A execução em aparelho Android permanece pendente. Total do caixa/diferença opcionais ainda não foram implementados.

## Scanner e base visual — 03/10/2026

As cinco atividades SCAN-001–005 receberam implementação: integração do [MLKit para Capacitor](https://capawesome.io/docs/sdks/capacitor/mlkit/barcode-scanning/), permissões de câmera, bloqueio de leituras simultâneas/repetidas, consulta de produto conhecido e cadastro rápido de código desconhecido. A câmera fecha ao sair da tela, cancelar ou colocar o app em segundo plano. Após confirmar ou fechar o produto, a leitura pode continuar. A alternativa manual permanece disponível.

O catálogo local usa códigos numéricos EAN/UPC de 8, 12 ou 13 dígitos armazenados como texto, preservando zeros iniciais. Não há validação de dígito verificador nem unificação entre formatos equivalentes nesta etapa. No navegador a consulta funciona por digitação; a captura por câmera usa o aplicativo nativo. A migration 5 preserva as compras anteriores e vincula os novos itens e preços ao código. Produto, item e fila são gravados juntos com rollback. O último preço vem de uma compra finalizada no mesmo mercado, com data, e nunca substitui a confirmação do preço de hoje.

A base visual da main reúne as quatro abas, cabeçalhos integrados ao fundo claro, verde como cor principal, cartões arredondados, progresso de orçamento e finalização fixa acima das abas. Fotos, logos de mercados, filtros de Histórico e total do caixa não fazem parte deste layout básico.

Validação: 34 testes unitários, lint, formatação, build, `verify:sqlite` e sincronização dos plugins Android passaram. O script SQLite usa um banco isolado em memória e as migrations/SQL da implementação para verificar preservação de dados, rollback, fila, preços por mercado, reabertura e imutabilidade de compras finalizadas. A revisão no navegador em larguras de 390 e 320 pixels confirmou cadastro por código, finalização, reconhecimento na compra seguinte, exigência de preço atual e persistência após recarregar. O build apresenta aviso de tamanho inicial acima de 1 MB; o limite de erro não foi excedido. A leitura física, permissões do sistema e compilação de APK permanecem pendentes: nenhum aparelho/SDK Android foi encontrado nesta sessão.

Esta entrega foi autorizada para publicação direta na main. Para próximas atividades, partir desta base em branches `codex/<atividade>`; publicação e merge continuam exigindo autorização, e PRs para main devem receber `@codex review` conforme AGENTS.md.

## CART-005 — Produtos repetidos — 03/10/2026

Adicionar novamente um produto com o mesmo nome (após remover espaços nas extremidades), preço e código incrementa a quantidade da linha existente. Produtos manuais são agrupados entre si; linhas com outro preço, nome ou código permanecem separadas. A edição continua substituindo a quantidade. Se a soma ultrapassar 9999, a adição é recusada antes de gravar.

Adições concorrentes são processadas em sequência e consultam a quantidade persistida. O incremento e a operação UPDATE da fila são gravados na mesma transação. Não há migração nem alteração retroativa de compras encerradas.

Validação: 38 testes, lint, Prettier, build, SQLite real e sincronização Android. No navegador, uma linha de uma unidade recebeu mais duas do scanner: quantidade 3 e total R$ 50,97, preservados após recarregar. SQLite verificou isolamento por configuração, quantidade máxima e rollback quando a fila falha. Continua pendente a execução em aparelho Android; o aviso de tamanho do bundle permanece.

O usuário autorizou o fluxo contínuo de branch a partir da main, validação, commit/push, PR para main com comentário `@codex review`, correções e merge antes da próxima atividade. Essa autorização vale para o desenvolvimento do Carrim nesta conversa; banco remoto continua fora desta etapa.
