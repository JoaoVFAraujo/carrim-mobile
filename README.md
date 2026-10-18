# Carrim Mobile

Aplicativo de supermercado offline-first, com compras, catálogo, orçamento e Histórico no SQLite. Manifest **0.0.2**, Android versionCode **2**. Não há release V1.0.0 publicada.

Sync nativo push/pull está integrado e inicia com API HTTPS configurada. Sem endpoint e no navegador, compras continuam locais. Conflitos pausam sync preservando dados; a revisão assistida compara a alteração local com o servidor antes de uma reaplicação explícita. Testes físicos ainda pendentes.

O Carrinho permite definir/editar/remover o limite e cancelar a compra com confirmação. Alterações ficam no SQLite e na fila na mesma transação; cancelamento preserva itens encerrados e não gera histórico de preços.

No Início nativo, Revisar sincronização permite reaplicar UPDATE de catálogo/limite e alterações de itens de uma compra ainda ativa, após consultar o servidor com a identidade vinculada. A decisão guarda cópias locais e remotas e o pedido anterior, e cria um novo comando explícito; o pedido anterior nunca é reciclado automaticamente. Mudança local durante a revisão invalida a decisão. Compras encerradas, criação de cadastros conflitante e falhas de importação permanecem pausadas para análise, sem sobrescrita automática. As últimas revisões ficam acessíveis no mesmo painel.

## Documentação essencial

| Assunto                                | Fonte principal                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| Produto, regras e arquitetura          | [Projeto](https://github.com/JoaoVFAraujo/carrim-api/blob/main/docs/PROJETO.md)     |
| Segurança e produção do produto        | [Segurança](https://github.com/JoaoVFAraujo/carrim-api/blob/main/docs/SEGURANCA.md) |
| Contratos REST/sync                    | [API](https://github.com/JoaoVFAraujo/carrim-api/blob/main/docs/API.md)             |
| Estado, métricas, prioridades e ideias | [Roadmap](https://github.com/JoaoVFAraujo/carrim-api/blob/main/docs/ROADMAP.md)     |
| Layout e imagens                       | [Layout](docs/LAYOUT.md)                                                            |
| Instalação e teste físico              | [Validação Android](docs/VALIDACAO-ANDROID.md)                                      |

Ao retomar, ler este README, AGENTS.md e roadmap. Atualizar a fonte do assunto, sem copiar status ou criar registros por sessão. Backend é a fonte de documentação geral do produto; o mobile mantém somente seus guias específicos. Histórico completo no Git, incluindo a retomada Cloud 915a113.

## Executar e validar

Node **>=24.15.0 e <25**, npm 11 (packageManager 11.9.0). Angular 22.2, Ionic 9, Capacitor 8.5, TypeScript 6 e Tailwind 4. Versões exatas em package.json/package-lock.json; não atualizar dependências só para retomar. CLI Capacitor permanece 8.4.3 por ajuste anterior de segurança.

```powershell
npm ci
npm start -- --host 127.0.0.1
```

Frontend local: http://127.0.0.1:4202. Proxy /api/v1/** aponta para 127.0.0.1:8082, sem abrir CORS. HTTP só no desenvolvimento local. Usar o mesmo host/porta para reencontrar os dados IndexedDB; localhost e 127.0.0.1 são origens diferentes.

```powershell
npm test
npm run lint
npm run format:check
npm run verify:sqlite
npm run build
```

SQLite real de teste é isolado; scripts verificam migrations V1–V10, constraints, transações, fila, importação e preservação. O teste integrado com HTTP exige API em 8082 e PostgreSQL **local isolado**, com Flyway V1–V6; ele cria dados, não prepara o servidor e não deve apontar para banco pessoal/produção.

```powershell
$env:CARRIM_LIVE_SYNC = '1'
try { npm test } finally { Remove-Item Env:CARRIM_LIVE_SYNC }
```

POSIX: `CARRIM_LIVE_SYNC=1 npm test`. Sem opt-in, live é explicitamente pulado. Plugins nativos são substituídos no teste; API/PostgreSQL e SQLite são reais.

## Configurar API nativa e gerar build

Sem configuração válida, a sincronização permanece desabilitada. O endpoint é público, não um segredo; exige HTTPS e caminho /api/v1, sem usuário/senha, query ou fragmento.

```powershell
$env:CARRIM_API_URL = 'https://api.example.com/api/v1'
npm run configure:api
npm run build
npx cap sync android
Remove-Item Env:CARRIM_API_URL
```

O domínio acima é ilustrativo. configure:api gera public/api-config.json, ignorado pelo Git e incluído no build. Não guardar token/prova/senha nesse arquivo. O arquivo gerado pode persistir após remover a variável: conferir configuração antes de cada build; para gerar app sem endpoint, remover somente esse arquivo gerado, sem tocar nos dados do app.

Não existe domínio/HTTPS público configurado nesta retomada. Homologação deve validar TLS e CORS/origens WebView conforme o guia de Segurança. Navegador continua sem sync persistente mesmo com configuração, pois identidade web só dura em memória.

JDK **21 completo** para Android (API usa JDK 25); SDK/plataformas 35 e 36, Build Tools 35/36, Gradle 8.14.3 e plugin 8.13.0. APK debug, instalação e roteiro no [guia Android](docs/VALIDACAO-ANDROID.md). iOS não foi gerado/validado; exige macOS/Xcode.

## Organização e cuidados

- core/database: conexão, migrations e vínculo de proprietário; core/api e core/sync: identidade, HTTP, fila e pull.
- features: páginas e estado por funcionalidade; shared: componentes realmente reutilizados.
- Tema em src/app/theme/variables.css e estilos globais em src/styles.css.
- Signals e HTML separado; componentes/APIs Ionic/Angular primeiro, Tailwind tw: depois, CSS manual quando necessário.
- Câmera só após ação do usuário; negar permissão mantém cadastro manual.
- Credenciais no Keystore/Keychain; nunca em SQLite/Web Storage/logs. Não limpar identidade/banco nem desinstalar para resolver conflito.

CI em [.github/workflows/verify.yml](.github/workflows/verify.yml) executa testes, lint, formatação, SQLite, build, cap sync e assembleDebug; live opt-in não roda por padrão. Não publica nem assina release. Build mantém aviso inicial acima de 1 MB; evidências e limites no roadmap.

Preservar mudanças locais. Fluxo autorizado: branch feature/fix da main, PR com comentário exato `@codex review`, correções, merge commit e exclusão da branch concluída. AGENTS.md e autorização do usuário regem publicação/deploy.
