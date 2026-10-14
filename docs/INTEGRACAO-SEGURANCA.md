# Identidade e HTTP — 08/10/2026

Frontend 0.0.2 prepara os serviços para o contrato do backend 0.0.8. A interface e a fila continuam locais; esta entrega não envia compras nem inicia autenticação automaticamente.

## Preparação do vínculo local para sync — 12/10/2026

`SyncIdentityService` é a entrada de identidade para o futuro processador da fila. No nativo, confere o proprietário local antes de autenticar e grava o vínculo antes de liberar o token. O SQLite guarda apenas `installationId` e `userId` na chave `sync_owner` de `app_metadata`; prova e token permanecem no armazenamento protegido. Não exige migration nem altera compras ou operações já existentes.

O primeiro vínculo é criado após autenticação bem-sucedida. Verificações e gravação são serializadas com as operações locais do banco. Um vínculo existente não pode ser substituído: identidade ausente, instalação diferente, proprietário diferente ou vínculo corrompido interrompem a preparação do sync. Não há criação silenciosa de outro proprietário para um banco já vinculado. Renovação deve passar pela mesma entrada.

No navegador, essa entrada recusa sincronização porque a identidade atual é somente em memória. As consultas de desenvolvimento existentes continuam disponíveis. A interface ainda não chama este serviço: esta etapa prepara a proteção; não implementa envio, recebimento, retries ou conflitos. O processador futuro deverá obter sua identidade por este serviço, e não diretamente por `AnonymousIdentityService`.

Validação automatizada: 88 testes passaram, incluindo primeiro vínculo, concorrência, perda/corrupção de identidade, persistência recusada e reabertura do serviço com vínculo preservado. O plugin de banco e o Keystore foram simulados nesses testes; execução nativa real continua pendente.

## Agendamento persistente da fila — 12/10/2026

`SyncQueueService` implementa reserva, confirmação, falha e recuperação de operações. A migration SQLite V9 preserva compras e fila existentes e acrescenta próximo horário de tentativa, início do processamento, classificação segura do erro e reserva por tentativa. IDs e sequência das operações existentes permanecem intactos.

Somente a primeira entrada ainda não sincronizada pode ser reservada. Uma operação em espera, em processamento ou com falha permanente bloqueia as posteriores para preservar dependências. Tentativas são incrementadas ao reservar; falhas temporárias usam intervalos de 2 s, 5 s, 15 s, 1 min, 5 min, 15 min, 30 min e no máximo 1 hora. Falhas permanentes ficam `FAILED`; não são reenviadas automaticamente. Corpos HTTP e credenciais nunca são salvos como erro.

Operações `SYNCING` sem atividade por pelo menos dois minutos retornam a `PENDING`, preservando ID e contador. A reserva muda a cada tentativa: confirmação ou falha de uma tentativa anterior não pode alterar a atual. O transporte futuro deve reconhecer o mesmo ID de operação de forma idempotente, inclusive quando a resposta anterior se perdeu.

Este serviço ainda não é acionado pela interface nem envia requisições. O próximo passo é implementar o contrato de sync idempotente no backend e ligar um processador à identidade protegida e ao agendador. Coalescência, push/pull, conflitos e apresentação de falhas ao usuário permanecem pendentes. Recuperação deve ser chamada ao iniciar o futuro processador; não há recuperação automática no startup atual.

Verificação SQLite cobre atualização V8→V9 preservando itens, reservas concorrentes, ordem, backoff persistido após reabertura, recuperação de tentativa interrompida, respostas atrasadas e falha permanente. O teste unitário verifica os intervalos limitados.

## Endereço e transporte

`npm start` mantém o frontend em localhost:4202. O proxy de desenvolvimento encaminha apenas `/api/v1/**` para `http://127.0.0.1:8082`, sem liberar CORS no backend. HTTP é limitado a esse ambiente local. Não expor os servidores de desenvolvimento em interfaces públicas.

`API_BASE_URL` fica nulo em build de produção ou Capacitor nativo. Antes de habilitar a integração nesses ambientes, configurar explicitamente um endpoint HTTPS com caminho `/api/v1`, sem usuário, senha, query ou fragmento. Não há servidor público configurado nem mudança de banco nesta entrega.

O cliente recebe somente caminhos internos validados e parâmetros separados em `HttpParams`. Usa Angular HttpClient com Fetch, recusa redirecionamentos, omite cookies e desabilita cache. Bearer é adicionado apenas pelo cliente dedicado; chamadas HttpClient externas não recebem credenciais. Interceptadores globais não observam esse cliente. Consultas têm timeout de 15 segundos.

## Credenciais e recuperação

Android usa `@aparajita/capacitor-secure-storage` 8.0.1: dados cifrados com AES-GCM e chave no Android Keystore. iOS usa Keychain, sem iCloud e com acesso somente no aparelho desbloqueado, sem migração entre aparelhos. [Implementação e limitações do plugin](https://github.com/aparajita/capacitor-secure-storage).

A implementação web do plugin grava sem criptografia e nunca é chamada pelo Carrim. No navegador, a identidade dura somente enquanto o serviço estiver em memória. Recarregar cria uma nova identidade na próxima chamada; por isso o navegador ainda não pode sincronizar compras persistidas. A sincronização futura deverá vincular o SQLite a um proprietário estável e impedir mistura de usuários.

UUID e prova de 32 bytes são gerados por Web Crypto. A prova é salva antes do bootstrap; se a resposta se perder, a tentativa seguinte conserva a instalação. Respostas precisam preservar instalação e proprietário; valores inválidos são recusados. Falha ou corrupção no armazenamento interrompe a conexão, sem substituir silenciosamente o usuário e sem fallback em texto aberto.

Requisições concorrentes compartilham bootstrap/renovação. Token válido é reutilizado; renovação antecipada usa margem de um minuto. Uma consulta rejeitada com 401 renova e repete uma única vez; 403 ou falha de rede não geram tentativas automáticas. Nenhuma escrita de negócio é disponibilizada pelo cliente nesta etapa. Erros exibidos não carregam corpo da resposta, token ou erro interno do plugin.

Android desabilita tráfego sem TLS, backup automático e transferência dos dados do app. Não desinstalar nem limpar dados para atualizar: compras e identidade anônima não possuem recuperação remota nesta etapa. Instalação de atualização com `-r` deve preservar os dados.

## Dependências e validação

O CLI Capacitor foi fixado em 8.4.3 porque 8.5.2 trazia `xcode`/`uuid` com alerta GHSA-w5hq-g745-h8pq. Core e plataforma Android permanecem 8.5.2. Audit completo e de produção retornaram zero vulnerabilidades conhecidas após o ajuste; isso não comprova ausência de outras falhas.

79 testes passaram, cobrindo isolamento de credenciais web/nativas, persistência antes do HTTP, concorrência, recuperação após resposta perdida, armazenamento indisponível, recusa de proprietário diferente, destinos externos, renovação única, 403 e reutilização após 401 atrasado. Um teste adicional garante renovação quando um 401 chega durante a leitura de um token em cache. Build, lint, formatação, SQLite real e registro do plugin no Android passaram.

Os adaptadores Angular dos plugins expõem somente métodos utilizados. Isso evita invocar um `ngOnDestroy` sintetizado pelo proxy Capacitor durante descarte; um teste de navegação protege essa integração. Arquivos existentes receberam ajustes de formatação, sem alteração do comportamento das compras.

Pendentes: execução real do Keystore em Android, compilação de APK, testes de atualização/backup em aparelho e Keychain em iOS. Testes HTTP unitários usam backend simulado; a integração completa em aparelho exige configurar HTTPS. O build mantém aviso de tamanho inicial acima de 1 MB.

## Processador push

O processador inicia somente no Capacitor nativo com API HTTPS explicitamente configurada. Usa a identidade protegida, respeita offline e agenda tentativas a cada dois segundos; execuções concorrentes compartilham o mesmo processamento. O payload HTTP é salvo na fila antes do primeiro envio e reutilizado literalmente em retries, incluindo baseVersion, evitando reutilizar a chave idempotente com outra versão.

Confirmação e atualização da versão remota são atômicas e condicionadas à reserva da tentativa. Falhas temporárias preservam a operação; conflitos e rejeições interrompem dependentes. O navegador continua apenas com dados locais. A configuração do endpoint e pull/conflitos são entregas seguintes. Validação: 94 testes, lint, build e SQLite; Android físico ainda pendente.

## Pull, bootstrap e conflitos

Após esvaziar a fila, o processador recebe páginas do journal e salva snapshots/cursor juntos. A importação ocorre depois de alcançar a cabeça para ordenar catálogo e mercados antes das compras. Esse estágio sobrevive à interrupção do bootstrap. Uma edição local surgida durante o pull bloqueia a aplicação no banco; operações pendentes nunca são sobrescritas por snapshots.

Compras finalizadas são importadas com itens e preços, sem gerar novas operações na fila. Repetição de eventos mantém itens terminais intactos. Divergência de estado/caixa de uma compra local encerrada é recusada. Colisões de identidade ou códigos de produto que não possam ser aplicadas respeitando as referências locais pausam a importação, sem descartar os dados.

CONFLICT salva o estado remoto junto com FAILED e interrompe dependentes. A tela Início informa que a sincronização foi pausada e que as compras locais foram preservadas. Não há last-write-wins nem auto-rebase. Nesta entrega, a resolução manual assistida e a identidade web persistente continuam pendentes; não desbloquear FAILED nem trocar operationId automaticamente. Validação: 99 testes, SQLite real, lint e build.
