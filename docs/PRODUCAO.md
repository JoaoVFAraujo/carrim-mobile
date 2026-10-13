# Configuração e verificações finais

O aplicativo continua funcionando localmente sem endpoint. Para habilitar sincronização nativa, informar CARRIM_API_URL com HTTPS e caminho `/api/v1`, executar `npm run configure:api`, `npm run build` e `npx cap sync android`. O arquivo gerado `public/api-config.json` contém somente o endereço público, é ignorado pelo Git e deve ser incluído no build antes da instalação. Não colocar tokens, provas ou senhas nesse arquivo.

No PowerShell: `$env:CARRIM_API_URL = 'https://seu-dominio/api/v1'`. Esse endereço é ilustrativo: esta entrega não configura DNS/HTTPS nem publica API. No navegador, a sincronização persistente permanece desabilitada porque a identidade é somente em memória; o cliente de consultas continua disponível.

Verificações: npm test, npm run lint, npm run format:check, npm run verify:sqlite, npm run build, npx cap sync android e Android assembleDebug com JDK 21 completo/SDK 35 e 36. O teste CARRIM_LIVE_SYNC=1 npm test exige API local isolada em 8082; ele substitui os plugins nativos e não valida hardware. CI executa as verificações locais e compila APK debug, mas não publica nem assina APK de release.

Antes da V1.0.0: instalar em aparelho, validar câmera/permissões, Keystore, SQLite nativo, atualização preservando dados e fluxo offline/online em HTTPS real; testar no supermercado; configurar assinatura de release e distribuição; concluir checklist de produção do backend e recuperação de backups. Conflitos sem resolução permanecem pausados preservando as compras; não limpar banco/identidade para contorná-los. O aviso de tamanho do bundle permanece aberto.
