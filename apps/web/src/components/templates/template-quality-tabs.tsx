'use client';

import { useState } from 'react';
import {
  IMAGE_DEFAULTS,
  IMAGE_SIZE_LIMITS,
  IMAGE_SIZE_PRESETS,
  embedPolicyOf,
  isStructuredTemplate,
  presetIdOf,
  reviewEnabledOf,
  stylePolicyOf,
  type ImageSizeValue,
} from '@content-pilot/core/client';
import { Card, CardContent } from '@/components/ui/card';
import { ChoiceCards, Field, FormSection, MoreOptions, SwitchRow } from '@/components/form-layout';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * Abas "Imagens" e "Texto e revisão" do editor de template. Editam os blocos
 * `images`, `style`, `review` e `embeds` do config. O que o template não define vale
 * o padrão do worker (`@content-pilot/core/client`), então a tela mostra exatamente o
 * que vai acontecer, e só grava um campo quando o usuário o muda.
 */

export type Block = 'images' | 'style' | 'review' | 'embeds';
export type PatchBlock = (block: Block, patch: Record<string, unknown>) => void;

type LooseCfg = Record<string, unknown>;

const block = <T extends object>(cfg: LooseCfg, key: Block): Partial<T> => (cfg[key] as Partial<T> | undefined) ?? {};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

/** Confirma um número ao sair do campo. Vazio ou inválido volta ao valor atual em vez de virar 0. */
function commitInt(input: HTMLInputElement, current: number, min: number, max: number, apply: (n: number) => void) {
  const n = Number(input.value);
  if (input.value.trim() === '' || !Number.isFinite(n)) {
    input.value = String(current);
    return;
  }
  const next = clamp(n, min, max);
  input.value = String(next);
  apply(next);
}

/** Tamanho pronto (preset) ou personalizado, com os limites que o servidor aceita. */
function ImageSizePicker({
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  value: ImageSizeValue;
  onChange: (size: ImageSizeValue) => void;
  disabled: boolean;
  idPrefix: string;
}) {
  const [custom, setCustom] = useState(presetIdOf(value) === 'custom');
  const selected = custom ? 'custom' : presetIdOf(value);
  const { minWidth, maxWidth, minHeight, maxHeight } = IMAGE_SIZE_LIMITS;
  const hint = IMAGE_SIZE_PRESETS.find((p) => p.id === selected)?.hint;

  return (
    <div className="space-y-2">
      <Select
        value={selected}
        disabled={disabled}
        onValueChange={(v) => {
          if (v === 'custom') return setCustom(true);
          setCustom(false);
          const preset = IMAGE_SIZE_PRESETS.find((p) => p.id === v);
          if (preset) onChange({ width: preset.width, height: preset.height });
        }}
      >
        <SelectTrigger className="w-full" id={`${idPrefix}-preset`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {IMAGE_SIZE_PRESETS.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Personalizado</SelectItem>
        </SelectContent>
      </Select>

      {custom ? (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            aria-label="Largura em pixels"
            className="w-24"
            min={minWidth}
            max={maxWidth}
            disabled={disabled}
            key={`w${value.width}`}
            defaultValue={value.width}
            onBlur={(e) => commitInt(e.target, value.width, minWidth, maxWidth, (width) => onChange({ ...value, width }))}
          />
          <span className="text-muted-foreground text-sm">×</span>
          <Input
            type="number"
            aria-label="Altura em pixels"
            className="w-24"
            min={minHeight}
            max={maxHeight}
            disabled={disabled}
            key={`h${value.height}`}
            defaultValue={value.height}
            onBlur={(e) => commitInt(e.target, value.height, minHeight, maxHeight, (height) => onChange({ ...value, height }))}
          />
          <span className="text-muted-foreground text-xs">px</span>
        </div>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

export function ImagesSettings({ cfg, patch, readOnly }: { cfg: LooseCfg; patch: PatchBlock; readOnly: boolean }) {
  const img = { ...IMAGE_DEFAULTS, ...block<typeof IMAGE_DEFAULTS>(cfg, 'images') };
  const set = (p: Partial<typeof IMAGE_DEFAULTS>) => patch('images', p);

  return (
    <Card>
      <CardContent className="space-y-6 pt-2">
        <SwitchRow
          label="Adicionar imagens ao artigo"
          description="Uma capa e imagens no meio do texto, escolhidas para combinar com cada trecho."
          checked={img.enabled}
          onCheckedChange={(enabled) => set({ enabled })}
          disabled={readOnly}
        />

        {img.enabled ? (
          <>
            <FormSection
              title="Tamanhos"
              description="Toda imagem é recortada e convertida para o tamanho exato antes de ir para o WordPress."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Capa" htmlFor="img-cover-preset">
                  <ImageSizePicker
                    idPrefix="img-cover"
                    value={img.cover}
                    onChange={(cover) => set({ cover })}
                    disabled={readOnly}
                  />
                </Field>
                <Field label="Imagens no texto" htmlFor="img-inline-preset">
                  <ImageSizePicker
                    idPrefix="img-inline"
                    value={img.inline}
                    onChange={(inline) => set({ inline })}
                    disabled={readOnly}
                  />
                </Field>
              </div>
              <p className="text-muted-foreground text-xs">
                A capa é sempre recortada nesse tamanho. Nas imagens do texto, uma foto real só é reduzida, nunca
                esticada. A capa é obrigatória: sem ela o post fica como rascunho.
              </p>
            </FormSection>

            <FormSection title="Quantidade e formato">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Imagens no texto (máx.)" htmlFor="img-inline-max" hint="0 = só a capa. O total cresce com o tamanho do artigo.">
                  <Input
                    id="img-inline-max"
                    type="number"
                    min={0}
                    max={6}
                    disabled={readOnly}
                    key={`im${img.inlineMax}`}
                    defaultValue={img.inlineMax}
                    onBlur={(e) => commitInt(e.target, img.inlineMax, 0, 6, (inlineMax) => set({ inlineMax }))}
                  />
                </Field>
                <Field label="Formato" htmlFor="img-format" hint="WebP gera arquivos bem menores.">
                  <Select value={img.format} onValueChange={(format) => set({ format: format as 'webp' | 'original' })} disabled={readOnly}>
                    <SelectTrigger className="w-full" id="img-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="webp">WebP (recomendado)</SelectItem>
                      <SelectItem value="original">Manter o original</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {img.format === 'webp' ? (
                  <Field label="Qualidade do WebP" htmlFor="img-quality" hint="82 é um bom equilíbrio.">
                    <Input
                      id="img-quality"
                      type="number"
                      min={40}
                      max={100}
                      disabled={readOnly}
                      key={`q${img.quality}`}
                      defaultValue={img.quality}
                      onBlur={(e) => commitInt(e.target, img.quality, 40, 100, (quality) => set({ quality }))}
                    />
                  </Field>
                ) : null}
              </div>
            </FormSection>

            <FormSection
              title="De onde vêm as imagens"
              description="Quando nenhuma serve, a IA gera uma no tamanho certo (precisa da chave OpenAI)."
            >
              <SwitchRow
                label="Imagem de destaque das fontes"
                description="Usa a imagem principal das matérias que embasam o artigo: costuma ser a mais relevante."
                checked={img.sourceImages}
                onCheckedChange={(sourceImages) => set({ sourceImages })}
                disabled={readOnly}
              />
              <SwitchRow
                label="Buscar imagens na web"
                description="Além do acervo aberto (Openverse). A licença das imagens da web não é verificada."
                checked={img.webSearch}
                onCheckedChange={(webSearch) => set({ webSearch })}
                disabled={readOnly}
              />
            </FormSection>

            <MoreOptions label="Avançado">
              <Field
                label="Candidatas por imagem"
                htmlFor="img-candidates"
                hint="Quantas imagens o modelo de visão compara para cada posição (1 a 10). Mais candidatas escolhem melhor e custam mais."
                className="max-w-xs"
              >
                <Input
                  id="img-candidates"
                  type="number"
                  min={1}
                  max={10}
                  disabled={readOnly}
                  key={`c${img.candidates}`}
                  defaultValue={img.candidates}
                  onBlur={(e) => commitInt(e.target, img.candidates, 1, 10, (candidates) => set({ candidates }))}
                />
              </Field>
            </MoreOptions>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function TextQualitySettings({ cfg, patch, readOnly }: { cfg: LooseCfg; patch: PatchBlock; readOnly: boolean }) {
  const structured = isStructuredTemplate(cfg as { extraction?: { enabled?: boolean } });
  const style = stylePolicyOf(structured, block(cfg, 'style'));
  const embeds = embedPolicyOf(structured, block(cfg, 'embeds'));
  const review = reviewEnabledOf(structured, block(cfg, 'review'));

  return (
    <Card>
      <CardContent className="space-y-6 pt-2">
        <FormSection title="Estilo do texto" description="Regras aplicadas ao que a IA escreve, e conferidas no código depois.">
          <SwitchRow
            label="Sem travessão"
            description="Reescreve travessões (— e –) com vírgula, dois-pontos ou ponto. É um dos sinais mais óbvios de texto de IA."
            checked={style.noDashes}
            onCheckedChange={(noDashes) => patch('style', { noDashes })}
            disabled={readOnly}
          />
          <Field label="Datas no título" hint={structured ? 'Este template extrai dados: mês e ano no título costumam ser parte do assunto.' : undefined}>
            <ChoiceCards
              label="Datas no título"
              value={style.datePolicy}
              onChange={(datePolicy) => patch('style', { datePolicy })}
              disabled={readOnly}
              options={[
                { value: 'avoid', label: 'Evitar', description: 'Tira mês e ano decorativos do título e do texto, a menos que sejam o assunto.' },
                { value: 'allow', label: 'Permitir', description: 'Convenção de nichos como códigos de jogos ("Julho 2026").' },
              ]}
            />
          </Field>
        </FormSection>

        <FormSection title="Revisão editorial">
          <SwitchRow
            label="Um segundo modelo revisa o rascunho"
            description="Relê o texto atrás de trecho maçante, seção curta e tom de IA, e diz onde uma imagem ajudaria. Custa uma chamada de IA a mais por artigo. Nunca perde link nem inventa número: se a revisão piorar, o rascunho original é mantido."
            checked={review}
            onCheckedChange={(enabled) => patch('review', { enabled })}
            disabled={readOnly}
          />
        </FormSection>

        <FormSection title="Vídeos e tweets" description="Só entra o que existe de verdade: cada link é conferido na plataforma antes.">
          <SwitchRow
            label="Vídeo do YouTube"
            description="Um vídeo relevante, incorporado no meio do artigo."
            checked={embeds.video}
            onCheckedChange={(video) => patch('embeds', { video })}
            disabled={readOnly}
          />
          <Field label="Tweets (máx.)" htmlFor="embed-tweets" hint="0 desliga. Cada busca gasta uma consulta da sua chave Tavily." className="max-w-xs">
            <Input
              id="embed-tweets"
              type="number"
              min={0}
              max={4}
              disabled={readOnly}
              key={`t${embeds.maxTweets}`}
              defaultValue={embeds.maxTweets}
              onBlur={(e) => commitInt(e.target, embeds.maxTweets, 0, 4, (maxTweets) => patch('embeds', { maxTweets }))}
            />
          </Field>
        </FormSection>
      </CardContent>
    </Card>
  );
}
