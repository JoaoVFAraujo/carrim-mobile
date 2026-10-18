# Carrim — direção visual

Referência aprovada em 30/09/2026, consolidada em 16/10 e revisada localmente em 17/10/2026. Imagens e decisões vieram da pasta original do PC. São conceitos de interface, não screenshots de funcionalidades entregues. A revisão local foi autorizada antes da preparação do APK de teste.

## Identidade e hierarquia

Visual claro, sofisticado e confortável durante a compra. Cabeçalho aberto integrado ao fundo, sem faixa cinza separada; títulos próximos do topo respeitando safe areas. Verde profundo, fundo levemente quente, superfícies suaves, bordas discretas, cantos arredondados e sombras leves.

| Papel                   | Referência                                   |
| ----------------------- | -------------------------------------------- |
| Principal               | #246B50                                      |
| Fundo                   | #F7F8F4                                      |
| Texto                   | Escuro, próximo do preto; tema atual #17251F |
| Superfícies secundárias | Sálvia suave                                 |
| Atenção                 | Âmbar discreto acompanhado de texto          |

Verificar contraste, fonte ampliada, leitor de tela, foco e áreas de toque. Não depender só de cor, gestos ou animação. Total e ação principal devem ser fáceis de encontrar; teclado e rolagem não podem esconder finalização.

## Início

![Conceito do Início](imagens/01-inicio.png)

Priorizar compra ativa: mercado, total, limite/restante quando informado e Continuar compra. Compras recentes abaixo; sem compra ativa, ação clara para começar. Saudação/perfil dependem de identidade futura, sem exigir conta para comprar offline.

## Escanear

![Conceito do scanner](imagens/02-escanear.png)

Área de câmera com controles discretos e alternativa manual. Ao detectar código, pausar leitura e confirmar preço/quantidade em sheet; evitar confirmações duplicadas. Preço anterior é referência com data, não preço atual preenchido automaticamente. Câmera negada deve orientar sem bloquear compra.

## Carrinho

![Conceito do Carrinho](imagens/03-carrinho.png)

Orçamento legível, subtotal por linha e total/finalização acessíveis. Unidade incrementa uma unidade; promoção incrementa grupo completo; peso usa edição apropriada, não copia o stepper ilustrado. Remoção tem confirmação e alternativa a gestos.

Contagem deve ter definição explícita: a lista atual conta linhas de produtos, não soma unidades com gramas. Não copiar contadores incoerentes dos exemplos. Valores persistidos em centavos e peso em gramas; interface em pt-BR.

## Histórico

![Conceito do Histórico](imagens/04-historico.png)

Compras agrupadas por período, com mercado, data, linhas e total. Segmento Todas/Este mês e detalhes somente leitura. Total do caixa e diferença são opcionais; nulo não é zero e diferença não muda itens. Estado vazio deve explicar a próxima ação.

## Implementação e aceitação

- Prioridade: componentes/APIs Ionic e Angular, Tailwind tw:, CSS manual quando necessário. Customização Ionic por variáveis/parts públicos, sem seletores internos frágeis.
- Angular standalone, Signals para estado e templates HTML separados. Não forçar modo iOS no Android.
- Quatro abas fixas: Início, Escanear, Carrinho e Histórico, inclusive sem compra ativa.
- Usar componentes Ionic para tabs, cards, botões, inputs, progress, toast, alert e modal. Estados vazios/carregamento/erro concretos, sem negócio fictício.
- Miniaturas, logos e cesta nas imagens são ilustrações. Não pressupor catálogo de fotos, parceria ou autorização de marcas; usar placeholders até haver assets adequados.
- Atenção de sync deve dizer que compras foram preservadas e orientar revisão, sem expor token, SQL ou internals.
- Haptics/transições úteis são melhorias a validar; respeitar redução de movimento. Não adicioná-las como requisito já entregue.
- Revisar telas pequenas (320/390 px), safe areas, fonte ampliada, teclado, orientação, navegação assistiva e acesso à ação principal.

Os PNGs foram copiados sem edição, mantendo os quatro originais e nomes para rastreabilidade. A pasta pessoal permanece intacta. Revisões de layout entram neste guia; estado e prioridade ficam no [roadmap](https://github.com/JoaoVFAraujo/carrim-api/blob/main/docs/ROADMAP.md), sem novos documentos visuais por versão.

## Revisão local — 17/10/2026

As quatro abas foram conferidas no navegador local em larguras de 390 e 320 px. A direção permanece clara/sálvia, com cabeçalho integrado, total em destaque, cantos suaves e componentes Ionic; fotos/marcas ilustrativas não foram copiadas para a interface.

Ajustes: resumo do Carrinho com orçamento em colunas, totais longos com quebra e finalização acessível, nomes de itens com largura mínima antes de quebrar a linha, hierarquia/espaçamento do cartão ativo, cartões do Histórico com data e total, botão Fechar no formulário de produtos, superfícies de revisão de sync e foco visível. Botões principais mantêm área mínima de 44 px.

Fluxos conferidos: nova compra com/sem limite; edição/remoção de limite e cancelamento; produto por unidade, peso e grupo promocional; erro de grupo incompleto; cadastro por código e produto conhecido exigindo preço de hoje; finalização com caixa diferente; filtro/detalhes do Histórico e persistência após recarregar. A amostra de unidade/peso/promoção totalizou R$ 54,66, caixa R$ 55,00 e diferença +R$ 0,34. Valores máximos e nome longo foram conferidos em 320 px sem rolagem horizontal.

Isso valida a revisão visual local, não a câmera física, teclado virtual, leitor de tela nativo ou Keystore/SQLite do aparelho. O painel de conflito tem testes de confirmação/concorrência em SQLite isolado; a execução nativa real permanece no roteiro Android. Aprovação final em aparelho e teste no supermercado continuam pendentes.
