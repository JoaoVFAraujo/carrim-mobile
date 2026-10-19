# Instruções para agentes

## Revisão de pull requests

Todo pull request com branch de destino `main` deve receber um comentário contendo exatamente `@codex review` após sua criação. Ao continuar um PR existente para `main`, verifique se o comentário já foi publicado; publique-o se estiver ausente.

Commit, push, criação de PR, merge e deploy dependem da autorização do usuário para a operação correspondente. Esta regra não autoriza criar ou publicar um PR por conta própria.

## Fluxo obrigatório para main

1. Antes de alterar arquivos, conferir status/diffs e preservar todas as mudanças existentes. Criar uma branch separada a partir da main atualizada, com prefixo feature/ ou fix/; não usar codex/.
2. Nunca fazer commit diretamente na main nem push direto para main. Toda alteração, inclusive documentação e este AGENTS.md, deve passar por pull request de uma branch separada para main.
3. Após criar o PR, publicar um comentário contendo exatamente `@codex review`. Ao retomar um PR existente, verificar se o comentário existe e se a revisão corresponde ao último commit.
4. Aguardar a revisão concluir e os checks obrigatórios passarem. Corrigir os problemas apontados, testar as correções e responder/resolver as discussões. Após novos commits, solicitar outra revisão com o mesmo comentário e aguardar a revisão do novo head; revisão antiga não aprova código novo.
5. Só integrar quando não houver apontamentos pendentes, a revisão do head atual estiver concluída e os checks estiverem aprovados. Usar Create a merge commit, nunca squash. Depois, atualizar a main local e excluir somente a branch de trabalho já integrada.
6. Na entrega, informar os links dos PRs, o resultado da revisão, as correções e as validações. Distinguir merge via PR de push direto.

Autorização para integrar na main não dispensa este fluxo. Respeitar as autorizações já concedidas na conversa; esta regra não autoriza deploy.
