# Carrim Mobile

Aplicativo do Carrim para acompanhar compras de supermercado. Este repositório e `JoaoVFAraujo/carrim-api` formam o mesmo produto.

## Estado: 0.0.1 — Foundation

Base Angular/Ionic standalone, página inicial, navegação com carregamento sob demanda, Tailwind, lint, formatação, testes e configuração Capacitor Android. O fluxo de compra, SQLite, scanner, autenticação e sincronização ainda não estão implementados.

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
- `core` e `shared` serão criados quando houver código que justifique seu uso.

Prioridade: Ionic/Angular → Tailwind → CSS manual. As classes Tailwind usam prefixo `tw:`. O Preflight do Tailwind não é importado, preservando os resets do Ionic. Não recriar componentes Ionic com CSS quando existir uma API nativa adequada.

Signals serão a primeira opção para estado; nesta base ainda não existe estado de negócio. Os imports standalone do Ionic 9 vêm de `@ionic/angular`.

## Segurança

Nenhum segredo ou token deve entrar no bundle. Tokens não serão armazenados em localStorage. Arquivos `.env` reais são ignorados. A fundação não faz chamadas à API nem usa banco, plugins de câmera ou armazenamento.

## Referência e evolução

O documento mestre está em [carrim-api/docs/carrim-documento-base-v12.md](https://github.com/JoaoVFAraujo/carrim-api/blob/main/docs/carrim-documento-base-v12.md). Neste Windows, consulte `C:\workspace\backend\mercado\docs\carrim-documento-base-v12.md`. O link remoto estará disponível após a publicação autorizada dos arquivos.

As decisões são revisáveis. A navegação com quatro abas e estados vazios está implementada; a próxima entrega prevista é a infraestrutura SQLite. CI, commit, push, PR e deploy exigem autorização própria.

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

A raiz e rotas desconhecidas redirecionam para `/tabs/home`. Os botões disponíveis apenas navegam entre páginas; criação de compra, SQLite, scanner, autenticação e sincronização ficam para as próximas etapas. O Ionic controla safe areas e comportamento por plataforma; a validação em dispositivo real permanece pendente.

Validação desta entrega no Windows: lint, Prettier, build e três testes passaram, incluindo navegação pelas quatro páginas e redirecionamentos. A inspeção visual em navegador não foi executada pelo assistente, pois a ferramenta de controle de navegador não está disponível nesta sessão.

A sincronização Android desta entrega foi tentada, mas o CLI falhou antes de sincronizar com ERR_SYSTEM_ERROR em uv_os_get_passwd (ENOMEM). Os assets nativos ainda precisam ser atualizados executando npx cap sync android no terminal do usuário.
