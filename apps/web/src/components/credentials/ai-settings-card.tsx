'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  listImageGenModelsAction,
  listProviderModelsAction,
  saveAiSettingsAction,
  saveImageGenSettingsAction,
  type ModelOption,
} from '@/actions/ai-settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { credentialTypeLabel } from './credential-type';

type LlmType = 'anthropic' | 'openai' | 'openrouter';

/** Sentinela do <Select>: nunca vai ao servidor, só sinaliza "sem escolha própria". */
const PLATFORM_DEFAULT = '__platform_default__';

/**
 * Escolha de provedor/modelo ativo (BYOK) + geração de imagem de IA (fallback
 * do illustrate). Só aparece quando o workspace já tem alguma credencial de
 * IA — sem isso não há o que escolher.
 */
export function AiSettingsCard({
  availableProviders,
  initialProvider,
  initialModel,
  initialImageGenModel,
}: {
  availableProviders: LlmType[];
  initialProvider: LlmType | null;
  initialModel: string | null;
  initialImageGenModel: string | null;
}) {
  const t = useTranslations('credentials.aiSettings');

  const [provider, setProvider] = useState<LlmType | typeof PLATFORM_DEFAULT>(
    initialProvider ?? PLATFORM_DEFAULT,
  );
  const [model, setModel] = useState<string | null>(initialModel);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loadingModels, startLoadingModels] = useTransition();
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    if (provider === PLATFORM_DEFAULT) return;
    startLoadingModels(async () => {
      const res = await listProviderModelsAction({ provider });
      if (res.ok) setModels(res.data);
      else {
        setModels([]);
        toast.error(res.error);
      }
    });
  }, [provider]);

  function save() {
    startSaving(async () => {
      const res = await saveAiSettingsAction({
        provider: provider === PLATFORM_DEFAULT ? null : provider,
        model: provider === PLATFORM_DEFAULT ? null : model,
      });
      if (res.ok) toast.success(t('saved'));
      else toast.error(res.error);
    });
  }

  const hasOpenAi = availableProviders.includes('openai');
  const [imageGenEnabled, setImageGenEnabled] = useState(Boolean(initialImageGenModel));
  const [imageGenModel, setImageGenModel] = useState<string | null>(initialImageGenModel);
  const [imageModels, setImageModels] = useState<ModelOption[]>([]);
  const [loadingImageModels, startLoadingImageModels] = useTransition();
  const [savingImageGen, startSavingImageGen] = useTransition();

  useEffect(() => {
    if (!imageGenEnabled || !hasOpenAi) return;
    startLoadingImageModels(async () => {
      const res = await listImageGenModelsAction();
      if (res.ok) setImageModels(res.data);
      else {
        setImageModels([]);
        toast.error(res.error);
      }
    });
  }, [imageGenEnabled, hasOpenAi]);

  function saveImageGen() {
    startSavingImageGen(async () => {
      const res = await saveImageGenSettingsAction({
        imageGenModel: imageGenEnabled ? imageGenModel : null,
      });
      if (res.ok) toast.success(t('imageGenSaved'));
      else toast.error(res.error);
    });
  }

  if (availableProviders.length === 0) return null;

  return (
    <div className="mb-6 grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t('providerLabel')}</Label>
            <Select
              value={provider}
              onValueChange={(v) => {
                setProvider(v as LlmType | typeof PLATFORM_DEFAULT);
                setModel(null);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PLATFORM_DEFAULT}>{t('providerDefault')}</SelectItem>
                {availableProviders.map((p) => (
                  <SelectItem key={p} value={p}>
                    {credentialTypeLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {provider !== PLATFORM_DEFAULT ? (
            <div className="space-y-2">
              <Label>{t('modelLabel')}</Label>
              <Select
                value={model ?? undefined}
                onValueChange={setModel}
                disabled={loadingModels || models.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={loadingModels ? t('loadingModels') : t('modelPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.modelId} value={m.modelId}>
                      {m.displayName}
                      {m.supportsVision ? ` (${t('visionBadge')})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <Button size="sm" disabled={saving || (provider !== PLATFORM_DEFAULT && !model)} onClick={save}>
            {t('save')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('imageGenTitle')}</CardTitle>
          <CardDescription>{t('imageGenDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Switch checked={imageGenEnabled} onCheckedChange={setImageGenEnabled} disabled={!hasOpenAi} />
            <Label>{t('imageGenEnable')}</Label>
          </div>
          {!hasOpenAi ? <p className="text-muted-foreground text-xs">{t('imageGenNoCredential')}</p> : null}
          {imageGenEnabled && hasOpenAi ? (
            <div className="space-y-2">
              <Label>{t('imageGenModelLabel')}</Label>
              <Select
                value={imageGenModel ?? undefined}
                onValueChange={setImageGenModel}
                disabled={loadingImageModels || imageModels.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={loadingImageModels ? t('loadingModels') : t('modelPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {imageModels.map((m) => (
                    <SelectItem key={m.modelId} value={m.modelId}>
                      {m.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <Button
            size="sm"
            disabled={savingImageGen || (imageGenEnabled && !imageGenModel)}
            onClick={saveImageGen}
          >
            {t('save')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
