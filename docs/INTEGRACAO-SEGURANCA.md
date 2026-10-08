# Identidade e HTTP — 08/10/2026

Frontend 0.0.2 prepara os serviços para o contrato do backend 0.0.8. A interface e a fila continuam locais; esta entrega não envia compras nem inicia autenticação automaticamente.

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

78 testes passaram, cobrindo isolamento de credenciais web/nativas, persistência antes do HTTP, concorrência, recuperação após resposta perdida, armazenamento indisponível, recusa de proprietário diferente, destinos externos, renovação única, 403 e reutilização após 401 atrasado. Build, lint, formatação, SQLite real e registro do plugin no Android passaram.

Os adaptadores Angular dos plugins expõem somente métodos utilizados. Isso evita invocar um `ngOnDestroy` sintetizado pelo proxy Capacitor durante descarte; um teste de navegação protege essa integração. Arquivos existentes receberam ajustes de formatação, sem alteração do comportamento das compras.

Pendentes: execução real do Keystore em Android, compilação de APK, testes de atualização/backup em aparelho e Keychain em iOS. Testes HTTP unitários usam backend simulado; a integração completa em aparelho exige configurar HTTPS. O build mantém aviso de tamanho inicial acima de 1 MB.
