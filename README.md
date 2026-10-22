# Carrim Mobile

Aplicativo de supermercado offline-first, com compras, catálogo, orçamento e Histórico no SQLite. Manifest **0.0.2**, Android versionCode **2**. Não há release V1.0.0 publicada.

Sync push/pull funciona no navegador e no app nativo. No navegador, /api/v1 deve ser servido na mesma origem; no nativo, configurar a API HTTPS. Cada alteração salva SQLite e fila atomicamente e desperta o envio, com recuperação automática após indisponibilidade. Conflitos pausam sync preservando dados; a revisão assistida compara a alteração local com o servidor antes de uma reaplicação explícita. Testes físicos ainda pendentes.

O Carrinho permite definir/editar/remover o limite e cancelar a compra com confirmação. Alterações ficam no SQLite e na fila na mesma transação; cancelamento preserva itens encerrados e não gera histórico de preços.

A validação em 320/390 px não equivale à aprovação visual. Após a correção do Carrinho, Início, Escanear e Histórico foram recompostos pelas referências: cesta própria, hierarquia tipográfica, cartões expansíveis e ficha inferior de produto. Fotos persistentes na ficha/Carrinho estão implementadas; conferência visual do usuário e aparelho permanecem pendentes. Veja [Layout](docs/LAYOUT.md) antes de avançar para o APK de teste.

No Início nativo, Revisar sincronização permite reaplicar UPDATE de catálogo/limite e alterações de itens de uma compra ainda ativa, após consultar o servidor com a identidade vinculada. A decisão guarda cópias locais e remotas e o pedido anterior, e cria um novo comando explícito; o pedido anterior nunca é reciclado automaticamente. Mudança local durante a revisão invalida a decisão. Compras encerradas, criação de cadastros conflitante e falhas de importação permanecem pausadas para análise, sem sobrescrita automática. As últimas revisões ficam acessíveis no mesmo painel.

## Documentação essencial

O scanner consulta primeiro SQLite e, para código desconhecido, o backend autenticado em `/products/lookup/{code}`. Quando disponível, a sugestão Open Food Facts preenche nome, marca/conteúdo e foto opcional para conferência. Preço de hoje e confirmação continuam obrigatórios; consulta não grava produto/item. Ausência, falha ou limite preservam cadastro manual. Fotos otimizadas ficam no SQLite e seguem por fila de mídia própria ao PostgreSQL. Autor vê sua foto pendente; outros clientes somente após aprovação no painel /admin/fotos. Câmera/galeria, troca, remoção e restauração explícita estão disponíveis. Produto confirmado usa o mesmo fluxo de compras, sem imagens no JSON de sync. API nativa HTTPS e teste físico completo continuam pendentes.

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

SQLite real de teste é isolado; scripts verificam migrations V1–V11, constraints, transações, fila, importação e preservação. O teste integrado usa HTTP, PostgreSQL **local isolado** e SQLite reais nos modos web e nativo; cria dados e não deve apontar para banco pessoal/produção. No backend, scripts/verify-local-postgres.ps1 -MobileSync prepara banco/API em portas temporárias, executa os testes e encerra seus processos. Ajustar -MobileRoot se o checkout estiver em outro caminho. Para uma API isolada já iniciada, CARRIM_LIVE_API aceita somente http://127.0.0.1:PORTA ou http://localhost:PORTA (padrão 8082).

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

Não existe domínio/HTTPS público configurado nesta retomada. Homologação deve validar TLS e CORS/origens WebView conforme o guia de Segurança. Em produção web, o proxy deve encaminhar /api/v1 à API preservando a origem pública e informando HTTPS por uma configuração confiável. A API recusa bootstrap web sem HTTPS no perfil prod. Não usar CORS amplo nem endpoint web de outra origem.

JDK **21 completo** para Android (API usa JDK 25); SDK/plataformas 35 e 36, Build Tools 35/36, Gradle 8.14.3 e plugin 8.13.0. APK debug, instalação e roteiro no [guia Android](docs/VALIDACAO-ANDROID.md). iOS não foi gerado/validado; exige macOS/Xcode.

No navegador, usar uma aba por origem: Web Locks impede instâncias SQLite/IndexedDB concorrentes. Recarregar mantém a identidade e os dados; apagar o cookie num banco vinculado pausa a conexão, sem criar outro proprietário. O Início informa confirmação ou pendências de envio. Todas as entidades de negócio são sincronizadas; fila, cursor e metadados são controles internos de cada ambiente. Histórico de preços é derivado da finalização nos dois bancos.

O agendador usa um único timer: após sincronizar, consulta novamente em 15/30/60 segundos se não houver novidades; atividade recebida reinicia o intervalo. Alterações locais, foco/retorno ao app e retorno da conexão despertam o envio, sem ignorar next_attempt_at_ms. Sem rede, não mantém polling; comandos FAILED e importações pausadas aguardam revisão. Documento oculto ou app nativo inativo pausa novos envios/páginas; uma requisição já em andamento pode terminar e ter a confirmação salva. O processador retoma pendências ao voltar ao primeiro plano. Testes unitários de ciclo de vida substituem o plugin e não comprovam comportamento físico Android.

## Fotos e administração

O plugin oficial de câmera 8.2.6 permite tirar/selecionar fotos por ação do usuário; navegador usa seletor de arquivo JPEG/PNG. Prévia confirma a escolha ao salvar. Captura interrompida pelo Android pode ser recuperada como rascunho, sem upload automático. Arquivos recebem limites e reprocessamento local/servidor, removendo EXIF. Foto própria substitui a externa somente na escolha do autor enquanto a nova candidata aguarda aprovação.

O painel `/admin/fotos` tem entrada por chave exclusiva de operador, mantida apenas em memória e removida ao sair. O servidor precisa de `CARRIM_PHOTO_ADMIN_TOKEN_SHA256` configurado; não existe chave padrão nem credencial no APK/SQLite/Web Storage. Fonte de configuração, geração e limites em Segurança/API do backend. Tokens normais de instalação não autenticam administração.

Banco nativo/web guarda JPEG base64 limitado em tabela própria por compatibilidade de binding do driver; PostgreSQL usa BYTEA. A mídia tem fila independente, retries persistidos e preferências versionadas; falha de foto não bloqueia compras. A saída usa no máximo 1024 px/500 KiB; o cliente otimiza normalmente até 256 KiB. Há limites locais de 100 imagens/200 intenções ativas. Itens manuais removidos liberam os bytes mesmo offline e enfileiram a exclusão remota; preferências desses itens não são reimportadas. A seleção automática consulta a preferência do servidor antes de escolher a foto do catálogo. Cópias públicas retiradas são invalidadas ao reconectar; o app offline só aprende a retirada quando voltar à rede.

Ferramentas Angular CLI/build 22.2.3 e override Vite 8.3.4 corrigem os avisos conhecidos identificados nesta entrega; `npm audit` não apontou vulnerabilidades no conjunto validado. A versão do aplicativo permanece 0.0.2 e isso não representa uma release de produção.

Validação em 21/10/2026: 298 testes passaram com HTTP/PostgreSQL/SQLite isolados, além de lint, formatação, SQLite real e build. Navegador confirmou miniaturas altas/largas/quadradas, cancelamento da troca, persistência após reabrir e aprovação administrativa. Outro proprietário recebeu somente a foto aprovada. O build mantém o aviso de bundle inicial de aproximadamente 1,20 MB. Câmera e fluxo completo no aparelho continuam sujeitos ao roteiro Android.

## Organização e cuidados

- core/database: conexão, migrations e vínculo de proprietário; core/api e core/sync: identidade, HTTP, fila e pull.
- features: páginas e estado por funcionalidade; ShoppingSessionStore mantém signals, validações e ordenação das ações; ShoppingRepository concentra consultas e transações SQLite de compras/itens/preços junto à fila. shared: componentes realmente reutilizados.
- Tema em src/app/theme/variables.css e estilos globais em src/styles.css.
- Signals e HTML separado; componentes/APIs Ionic/Angular primeiro, Tailwind tw: depois, CSS manual quando necessário.
- Câmera só após ação do usuário; negar permissão mantém cadastro manual.
- No nativo, credenciais no Keystore/Keychain. Na web, prova em cookie HttpOnly/SameSite=Strict (Secure e prefixo __Host- no HTTPS), Bearer só em memória. Nunca em SQLite/Web Storage/logs. Não limpar identidade/banco nem desinstalar para resolver conflito.

CI em [.github/workflows/verify.yml](.github/workflows/verify.yml) executa testes, lint, formatação, SQLite, build, cap sync e assembleDebug; live opt-in não roda por padrão. Não publica nem assina release. Build mantém aviso inicial acima de 1 MB; evidências e limites no roadmap.

Preservar mudanças locais. Fluxo autorizado: branch feature/fix da main, PR com comentário exato `@codex review`, correções, merge commit e exclusão da branch concluída. AGENTS.md e autorização do usuário regem publicação/deploy.
