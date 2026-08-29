# Card Forge — Editor de Cartas

Editor estático em **Astro + TypeScript** para criação de cartas de um jogo próprio inspirado na linguagem física de TCGs. O projeto não usa backend, login, Firebase ou banco online. A PokéAPI acelera o preenchimento de Pokémon e a seleção de compatibilidade de Ataques; os demais campos continuam editáveis manualmente.

## Tipos de carta

- **Pokémon** — Normal, EX, Mega, Radiante, Gigantamax e Lendário, com Arte Expandida em todas as formas.
- **Ataque** — carta separada com visual prateado inspirado em TCG físico, subtipo **Ataque Normal / Ataque Especial**, arte, efeito e compatibilidade por Pokémon específicos ou por tipo.
- **Estádio, Apoiador, Item, Ferramenta e Campeão** — pertencem à família **Treinador** e compartilham um template prateado com faixa de subtipo, título TREINADOR, área de regras texturizada e identidade cromática própria.
- **Campeão** — novo subtipo de Treinador, por enquanto com a mesma estrutura base e identidade dourada discreta.

## Recursos principais

- Busca de Pokémon por nome ou número, com autocomplete, debounce e cache local.
- PokéAPI v2 para Pokémon, espécie, cadeia evolutiva, habilidades e sprites/artwork usados em Ataques.
- 12 tipos próprios: Fogo, Água, Planta, Elétrico, Gelo, Lutador, Terra, Voador, Psíquico, Sombrio, Metal e Místico.
- Upload de PNG/JPG/WebP, drag & drop, zoom, posição X/Y e reposicionamento arrastando a arte no preview.
- Preview reativo sem recarregar a página ao trocar o tipo de carta.
- Autosave local com migração simples do rascunho Pokémon antigo: dados em `localStorage` e arte em `IndexedDB`.
- Exportação PNG de apenas o template atualmente selecionado em **1260 × 1760 px**.
- Layout responsivo e deploy estático via GitHub Pages/GitHub Actions.

## Pokémon

- Fundos agora usam camadas de gradiente, brilho, microtrama e variação tonal por tipo para evitar cores chapadas.
- Flags de status usam acabamento metalizado com luz, sombra interna e reflexo.
- Cabeçalho compacto de 70 px na composição base.
- Pokémon Básico mostra apenas `BÁSICO`, sem explicações redundantes.
- Pré-evolução em medalhão próprio e imagem ligeiramente maior.
- Pokédex, espécie/vulgo, altura, peso e região integrados à base do quadro da arte.
- Borda externa sólida e moldura de arte simplificada.
- Full Art real: o quadro normal da imagem deixa de participar do layout, as características da espécie somem da composição e a arte ocupa toda a área interna da carta.
- Full Art usa contorno tipográfico sutil, contraste localizado e flags de status semitransparentes.
- Cores dos status: HP verde, ATK laranja, DEF dourado, SPA magenta, SPD azul e VEL vermelho.

## Ataques

- Cabeçalho no mesmo idioma visual das cartas de Treinador, com **ATAQUE** e faixa **Ataque Normal / Ataque Especial**.
- Nome do ataque em uma faixa própria abaixo do cabeçalho e repetido discretamente no painel de efeito.
- Descrição multlinha com limite de 360 caracteres e contador no editor.
- Módulo inferior dimensionado para continuar útil quando o restante da carta estiver embaixo de um Pokémon.
- Compatibilidade em modos alternativos:
  - até 10 Pokémon específicos, sem duplicatas, com busca/autocomplete PokéAPI e remoção individual;
  - todos os Pokémon de um dos 12 tipos do jogo.
- Distribuição automática dos círculos de 1 a 10 Pokémon, com no máximo 5 por linha.

## Estrutura principal

```text
src/
├─ components/
│  ├─ card/
│  │  ├─ CardPreview.astro
│  │  ├─ PokemonCard.astro
│  │  ├─ AttackCard.astro
│  │  ├─ UtilityCard.astro
│  │  ├─ SharedArtwork.astro
│  │  └─ ...componentes Pokémon existentes
│  └─ editor/
│     ├─ EditorPanel.astro
│     ├─ CardTypeSelector.astro
│     ├─ AttackEditor.astro
│     ├─ UtilityEditor.astro
│     └─ ...editores Pokémon existentes
├─ data/
│  ├─ defaultCard.ts
│  ├─ cardCategories.ts
│  └─ gameConfig.ts
├─ lib/
│  ├─ pokeapi.ts
│  ├─ pokemonMapping.ts
│  ├─ evolution.ts
│  ├─ exportCard.ts
│  └─ storage.ts
├─ scripts/editor.ts
├─ styles/
│  ├─ global.css
│  ├─ editor.css
│  └─ card.css
├─ types/
│  ├─ card.ts
│  └─ pokeapi.ts
└─ pages/index.astro
```

## Rodar localmente

Requer Node.js **22.12+**.

```bash
npm install
npm run check
npm run build
npm run dev
```

## GitHub Pages

O workflow existente em `.github/workflows/deploy.yml` e o cálculo de `site`/`base` em `astro.config.mjs` foram preservados. O projeto continua usando `BASE_URL`/base path do Astro para assets estáticos e não exige backend para funcionar.

## Observação sobre a coleção

As coleções têm composição livre, sem tamanho máximo e sem limites por categoria. A numeração é recalculada a partir das cartas regulares existentes; Full Arts continuam como extras numerados depois do total regular. Editar uma carta preserva sua posição na coleção.
