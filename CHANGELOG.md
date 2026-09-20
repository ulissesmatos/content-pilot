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
