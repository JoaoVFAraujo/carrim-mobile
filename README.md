# Carrim Mobile

Aplicativo do Carrim para acompanhar compras de supermercado. Este repositório e `JoaoVFAraujo/carrim-api` formam o mesmo produto.

## Estado: 0.0.1 — Foundation

Base Angular/Ionic standalone, página inicial, navegação com carregamento sob demanda, Tailwind, lint, formatação, testes e configuração Capacitor Android. SQLite e criação/recuperação da compra ativa estão implementados. Adição de produtos, scanner, finalização, autenticação e sincronização remota ficam para as próximas entregas.

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

Nenhum segredo ou token deve entrar no bundle. Tokens não serão armazenados em localStorage. Arquivos `.env` reais são ignorados. O app usa SQLite local para supermercados e compra ativa. Não faz chamadas à API nem solicita câmera; a fila local ainda não envia operações ao servidor.

## Referência e evolução

O documento mestre está em [carrim-api/docs/carrim-documento-base-v12.md](https://github.com/JoaoVFAraujo/carrim-api/blob/main/docs/carrim-documento-base-v12.md). Neste Windows, consulte `C:\workspace\backend\mercado\docs\carrim-documento-base-v12.md`. O link remoto estará disponível após a publicação autorizada dos arquivos.

As decisões são revisáveis. A navegação com quatro abas e estados vazios está implementada; a infraestrutura SQLite e a primeira compra local estão disponíveis; a próxima entrega é adicionar produtos manualmente. CI, commit, push, PR e deploy exigem autorização própria.

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
