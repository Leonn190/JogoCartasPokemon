# Card Forge — Editor de Cartas Pokémon

Editor estático em **Astro + TypeScript** para criação de cartas Pokémon de um jogo próprio. O projeto não usa backend, login, Firebase ou banco online. A PokéAPI é usada somente para acelerar o preenchimento de dados e o editor continua utilizável quando a API falha.

## Recursos implementados

- Busca de Pokémon por nome ou número, com autocomplete e debounce.
- PokéAPI v2: `/pokemon`, `/pokemon-species`, cadeia evolutiva e habilidades.
- Cache local de respostas da PokéAPI para evitar chamadas repetidas.
- Preenchimento automático de nome, Pokédex, altura, peso, espécie, região, descrição, pré-evolução, estágio, stats oficiais de referência e habilidades.
- 12 tipos próprios com cor + símbolo: Fogo, Água, Planta, Elétrico, Gelo, Lutador, Terra, Voador, Psíquico, Sombrio, Metal e Místico.
- Formas: Normal, EX, Mega, Radiante, Gigantamax e Lendário.
- Forma Lendário liberada apenas quando `pokemon-species.is_legendary === true`.
- Upload de PNG/JPG/WebP, drag & drop, zoom, posição X/Y e reposicionamento arrastando a arte no preview.
- Arte Expandida/full bleed para todas as formas, com camadas de legibilidade.
- Seis stats próprios da carta: HP, ATK, DEF, SPA, SPD e VEL.
- Stats oficiais da PokéAPI aparecem apenas como referência, com botão opcional para copiá-los.
- Uma habilidade por carta, com habilidades oficiais como sugestões.
- Preview reativo sem botão de atualizar.
- Autosave local: dados em `localStorage` e imagem em `IndexedDB`.
- Nova carta com confirmação quando existem alterações pendentes.
- Exportação de apenas a carta em PNG **1260 × 1760 px**.
- Layout responsivo: editor + preview no desktop, preview antes dos controles no mobile.
- Deploy estático via GitHub Pages e GitHub Actions.

## Estrutura principal

```text
src/
├─ components/
│  ├─ card/
│  │  ├─ PokemonCard.astro
│  │  ├─ CardHeader.astro
│  │  ├─ CardArtwork.astro
│  │  ├─ PokemonInfo.astro
│  │  ├─ StatsFlags.astro
│  │  ├─ AbilityBlock.astro
│  │  ├─ CardFooter.astro
│  │  └─ TypeBadge.astro
│  └─ editor/
│     ├─ EditorPanel.astro
│     ├─ PokemonSearch.astro
│     ├─ PokemonForm.astro
│     ├─ EvolutionEditor.astro
│     ├─ ArtworkControls.astro
│     ├─ PokedexEditor.astro
│     ├─ StatsEditor.astro
│     ├─ AbilityEditor.astro
│     └─ CardMetadataEditor.astro
├─ data/defaultCard.ts
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
npm run dev
```

O Astro mostrará a URL local no terminal (normalmente `http://localhost:4321`).

Para gerar o site estático:

```bash
npm run build
```

Para visualizar o build:

```bash
npm run preview
```

## GitHub Pages

O workflow está em:

```text
.github/workflows/deploy.yml
```

Ele usa a ação oficial `withastro/action` e `actions/deploy-pages`.

O `astro.config.mjs` lê automaticamente no GitHub Actions:

- `GITHUB_REPOSITORY_OWNER`
- `GITHUB_REPOSITORY`

Por isso, em um repositório comum como:

```text
https://github.com/meu-usuario/meu-editor
```

o build calcula automaticamente:

```text
site: https://meu-usuario.github.io
base: /meu-editor
```

Você não precisa editar o código para mudar usuário ou nome do repositório. Para um repositório especial `meu-usuario.github.io`, o `base` vira `/` automaticamente.

No GitHub, abra **Settings → Pages** e selecione **GitHub Actions** como Source. Depois faça push para a branch `main`.

### Simular o base path localmente

Se quiser testar localmente um caminho semelhante ao GitHub Pages, copie `.env.example` para `.env` e ajuste as variáveis.

## Decisões visuais

- **Normal:** frame base, cor principal do tipo e acabamento impresso discreto.
- **EX:** brilho de borda e diagonais sutis para aumentar a energia sem trocar o template.
- **Mega:** geometria um pouco mais angular e moldura interna mais agressiva.
- **Radiante:** frame prismático/iridescente com reflexos localizados.
- **Gigantamax:** detalhes magenta/roxo e presença de energia nas bordas.
- **Lendário:** mistura de dourado, marfim e acabamento nobre; opção condicionada à PokéAPI.
- **Arte Expandida:** a arte ocupa a carta inteira e as áreas textuais recebem painéis escuros/translúcidos e contraste localizado.

## Observação sobre a coleção

A especificação de referência recebida lista uma distribuição de categorias cuja soma não corresponde a 150. Os números não foram alterados silenciosamente. Nesta versão, o editor implementa apenas Pokémon e mantém o total da carta fixo em 150, conforme solicitado.
