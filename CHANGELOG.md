# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
versionamento [semver](https://semver.org/lang/pt-BR/). O monorepo versiona em
lockstep: `package.json` da raiz e de `apps/*`/`packages/*` sobem juntos —
mais simples que rastrear versões independentes num app que nunca é publicado
como pacote npm.

## Processo de release

1. Decida o bump (major.minor.patch) pelas mudanças em "Unreleased" abaixo.
2. Atualize a versão nos 5 `package.json` (raiz, `apps/web`, `apps/worker`,
   `packages/core`, `packages/db`) para o mesmo valor.
3. Mova o conteúdo de "Unreleased" para uma seção nova com a versão e a data.
4. Merge no `main`. O job `release` em `.github/workflows/verify.yml` cria a
   tag `vX.Y.Z` e a GitHub Release sozinho quando detecta a versão nova; o job
   `deploy` dispara o Coolify em seguida (ver `docs/runbook.md`).

## [Unreleased]

### Added
- Troca de imagem direto na prévia do artigo (`/briefs/[id]`): qualquer imagem do
  texto, ou a capa, pode ser substituída por uma do computador, arrastando o
  arquivo por cima dela, colando (Ctrl+V com a imagem em foco), escolhendo um
  arquivo ou informando o endereço de uma imagem da web (também vale arrastar
  uma imagem de outra aba). A capa que faltou ganha "Enviar capa".
- Toda imagem enviada passa pela compactação e vira WebP: a capa é recortada
  no tamanho exato do template, a imagem do texto só é reduzida (nunca esticada
  nem recortada), a orientação EXIF é aplicada e os metadados são removidos.
  Recusa SVG, arquivo acima de 15 MB, imagem minúscula e o que não é imagem.
- SEO da imagem no mesmo diálogo: texto alternativo (com contador), título do
  item na biblioteca de mídia, legenda e nome do arquivo. Também dá para
  ajustar só o SEO de uma imagem existente, sem trocar o arquivo. A legenda
  antiga (atribuição da imagem que saiu) é limpa ao trocar.
- Edição básica do texto na prévia: parágrafos, títulos de seção, itens de
  lista e o título do artigo, com negrito, itálico e links preservados. Se o
  WordPress mudou algum trecho depois que a tela foi aberta, nada é gravado
  (evita sobrescrever o trabalho de outra pessoa). Enter não cria parágrafo e a
  colagem entra como texto puro.
- Origem "Enviada por você" no relatório de imagens do artigo.
- `updateMedia` no adaptador do WordPress (alt, legenda e título do anexo).
- Checagem de embasamento na Descoberta: cada tema candidato precisa vir com
  uma citação literal das fontes pesquisadas que comprove a característica
  específica do ângulo (não só que o assunto existe) — descartado
  automaticamente sem uma citação real. Evita o autopilot propor (e depois
  escrever um artigo inteiro sobre) uma característica que o produto/jogo não
  tem de verdade.
- "Regerar" pauta falhada reaproveita a pesquisa e o rascunho anterior em vez
  de rodar tudo do zero — mesmo mecanismo que já existia para retry de
  atualização de post.
- Candidato "news" da Descoberta com fonte comprovadamente velha (mais de
  `newsMaxAgeDays`, padrão 10 dias) é descartado antes de virar pauta —
  notícia de 3 semanas atrás não vale mais como novidade. Só entra em vigor
  quando a própria IA aponta uma data e ela bate com uma data real nos
  resultados de busca; sem data verificável, o candidato passa normalmente
  (nunca descarta por incerteza, só por comprovação).

### Changed
- Datas e horas do painel passam a ser mostradas em UTC-3
  (`America/Sao_Paulo`); o banco continua guardando em UTC. A descoberta
  agendada para as 7h deixa de aparecer como 10h. O "hoje" e o mês usados nos
  prompts, nas buscas e no widget de códigos também seguem UTC-3: entre 21h e
  meia-noite o servidor em UTC já estava no dia seguinte.
- A conversão de imagem para WebP saiu do worker e foi para o `core`, para o
  painel e o worker usarem exatamente a mesma regra. O painel passou a depender
  do `sharp` (mesma versão do worker).

### Fixed
- O "último uso" das credenciais em `/credentials` só era gravado ao testar a
  conexão de um site. Agora é gravado quando o provedor aceita uma chamada de
  verdade (IA, busca Tavily, WordPress, geração de imagem, listagem de modelos
  com a chave do usuário). Chamada que falha, ou busca que devolve erro, não
  conta; no máximo uma gravação por minuto por credencial.
- O rodapé fixo dos modais (botão Salvar) deixava o conteúdo vazar por baixo
  dele, principalmente em janelas baixas.
- Prompt de geração de artigo NOVO (ambos os templates) listava só a tag de
  abertura dos blocos Gutenberg, nunca o par com o fechamento — causava
  "blocos Gutenberg desbalanceados" e reprovava a validação. O prompt de
  atualização já tinha o exemplo completo e nunca teve o problema; a etapa de
  revisão editorial recebeu o mesmo reforço.
- Seletor de idioma do autopilot existia no backend mas não tinha campo na
  tela — todo autopilot rodava em pt-BR independente da escolha. Também
  faltava uma instrução explícita de idioma no prompt: pedir outro idioma sem
  um template traduzido para ele silenciosamente saía no idioma padrão do
  template.

## [0.3.0] - 2026-09-20

### Added
- Recuperação automática de respostas inválidas da IA usando o rascunho já
  gerado e os erros determinísticos de validação.
- Retry manual por etapa, com reaproveitamento das fontes pesquisadas e do
  rascunho sem repetir pesquisa e extract quando o contexto está disponível.
- Acompanhamento ao vivo de execuções, prévia do artigo e troca de imagens por
  IA no painel.
- Etapa editorial separada, embeds verificados de YouTube/Twitter e geração de
  imagens por slot com capa garantida.

### Changed
- O revisor pode ajustar título e tema sugerido, com guardas para preservar
  fatos, links e qualidade do artigo.
- Perfis OpenAI/Anthropic/OpenRouter e configurações BYOK foram separados com
  seleção explícita de provedor/modelo.
- O cliente OpenAI passou a suportar modelos GPT-5 usando
  `max_completion_tokens` e diagnóstico detalhado de erros HTTP.
- O pipeline aplica guardas de estilo para remover travessão e datas
  decorativas do conteúdo gerado.

### Fixed
- Falhas de validação deixam de descartar automaticamente o trabalho já feito;
  quando o reparo não resolve, a execução continua bloqueada sem publicar
  conteúdo inválido.
- IDs de modelo no formato OpenRouter usados em provedores nativos são
  normalizados ou recusados antes da execução.
- Readiness, catálogo de modelos, health do worker e execução serial dos testes
  foram corrigidos no CI.

## [0.2.0] - 2026-09-20

### Added
- Workspaces BYOK podem escolher provedor e modelo ativo em `/credentials`,
  buscando a lista de modelos ao vivo com a própria API key (sem depender do
  catálogo sincronizado pelo admin).
- Fallback automático de provedor: sem a chave do provedor configurado no
  perfil do admin (ex.: OpenRouter) mas com outra chave de IA própria (ex.:
  OpenAI), o pipeline passa a usar essa outra automaticamente — para texto e
  para a visão do `illustrate`.
- Geração de imagem de capa via IA (OpenAI `gpt-image-1`/`dall-e-3`) como
  último recurso, quando nenhuma imagem da web/acervo passa na revisão de
  qualidade — exige credencial OpenAI própria e modelo escolhido em
  `/credentials`, nunca a chave da plataforma.
- Deploy automático: workflow do GitHub Actions dispara o webhook do Coolify
  após os testes passarem no `main`, e cria tag/release quando a versão sobe.

### Changed
- `illustrate` exige explicitamente boa resolução, ausência de marca d'água
  e de logo de outro site na capa, e deixa o modelo de visão decidir quantas
  imagens usar no corpo do texto em vez de sempre preencher até o limite.

### Fixed
- Perfil de modelo com provedor nativo (OpenAI/Anthropic) recusa salvar um id
  no formato do OpenRouter (`vendor/modelo`) — evita o HTTP 400 em runtime que
  isso causava.

## [0.1.0] - lançamento inicial

Fundação do monorepo (web + worker + db + core), pipeline de geração de posts,
autopilot com descoberta de temas, multi-tenant com RLS, BYOK, i18n e deploy
em produção (Docker + Coolify). Ver histórico de commits anteriores a este
arquivo para o detalhe de cada bloco.
