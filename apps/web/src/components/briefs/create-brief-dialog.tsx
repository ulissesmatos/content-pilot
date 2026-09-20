'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { createBriefAction, listSiteCategoriesAction, updateBriefAction } from '@/actions/briefs';
import { ChoiceCards, Field, FormSection, MoreOptions, TemplateChips, stickyFooterClass } from '@/components/form-layout';
import { Button } from '@/components/ui/button';
import { useRunTracker } from '@/components/runs/run-tracker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface Option {
  id: string;
  name: string;
  /** O que o template faz (revisão, imagens, embeds), para quem escolhe saber sem abrir o editor. */
  summary?: string[];
}

/** Valores iniciais para o modo edição. */
export interface BriefFormInitial {
  id: string;
  topic: string;
  language: string;
  keywords: string;
  targetCategoryWpId: string;
  extraInstructions: string;
  publishMode: 'draft' | 'publish';
}

const LANGUAGES = [
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'es-ES', label: 'Español (España)' },
];

function BriefDialog({
  sites,
  templates,
  initial,
  trigger,
}: {
  sites: Option[];
  templates: Option[];
  initial?: BriefFormInitial;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const { track } = useRunTracker();
  const isEdit = !!initial;
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [language, setLanguage] = useState(initial?.language ?? 'pt-BR');
  const [publishMode, setPublishMode] = useState<'draft' | 'publish'>(initial?.publishMode ?? 'draft');
  const [categoryId, setCategoryId] = useState(initial?.targetCategoryWpId ?? '');
  const [moreOpen, setMoreOpen] = useState(false);
  // categorias do WordPress por site; `items: null` = não consegui listar (cai no ID digitável)
  const [categories, setCategories] = useState<{ siteId: string; items: Array<{ id: number; name: string }> | null } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);

  const disabled = !isEdit && (sites.length === 0 || templates.length === 0);
  const template = templates.find((t) => t.id === templateId);

  // A lista de categorias só é buscada quando há site e o usuário abriu "Mais opções":
  // é uma ida ao WordPress, e a maioria das pautas não usa categoria.
  const loadedForSite = categories?.siteId === siteId;
  useEffect(() => {
    if (isEdit || !moreOpen || !siteId || loadedForSite) return;
    let cancelled = false;
    void listSiteCategoriesAction({ siteId }).then((res) => {
      if (!cancelled) setCategories({ siteId, items: res.ok ? res.data : null });
    });
    return () => {
      cancelled = true;
    };
  }, [isEdit, moreOpen, siteId, loadedForSite]);

  const categoryList = loadedForSite ? (categories?.items ?? null) : null;
  const categoryLoading = !isEdit && moreOpen && !!siteId && !loadedForSite;

  function submit(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    startTransition(async () => {
      try {
        const shared = {
          topic: formData.get('topic'),
          language,
          keywords: formData.get('keywords') ?? '',
          targetCategoryWpId: categoryId === 'none' ? '' : categoryId,
          extraInstructions: formData.get('extraInstructions') ?? '',
          publishMode,
        };
        if (isEdit) {
          const result = await updateBriefAction({ ...shared, id: initial.id });
          if (result.ok) {
            toast.success('Pauta atualizada.');
            setFieldErrors({});
            setOpen(false);
            router.refresh();
          } else {
            setFieldErrors(result.fieldErrors ?? {});
            toast.error(result.error);
          }
          return;
        }
        const result = await createBriefAction({ ...shared, siteId, templateId });
        if (result.ok) {
          setFieldErrors({});
          setOpen(false);
          // painel ao vivo com a geração, em vez de mandar para uma tela que só mostra a fila
          track(result.data.runId);
        } else {
          setFieldErrors(result.fieldErrors ?? {});
          toast.error(result.error);
        }
      } finally {
        submittingRef.current = false;
      }
    });
  }

  const err = (field: string) => fieldErrors[field]?.[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar pauta' : 'Nova pauta'}</DialogTitle>
          <DialogDescription>
            {disabled
              ? 'Cadastre um site e tenha ao menos um template antes de criar pautas.'
              : isEdit
                ? 'A pauta ainda não gerou post: ajuste e gere quando quiser.'
                : 'O artigo é escrito com base em fontes reais pesquisadas na web e criado no seu WordPress.'}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-6">
          <FormSection title="Assunto">
            <Field label="Sobre o que é o artigo" htmlFor="brief-topic" error={err('topic')}>
              <Input
                id="brief-topic"
                name="topic"
                placeholder='ex.: códigos de "Anime Vanguards"'
                defaultValue={initial?.topic}
                required
              />
            </Field>
            <Field
              label="Instruções extras"
              htmlFor="brief-extra"
              optional
              hint="Enfoque, público ou algo que precisa ser citado."
              error={err('extraInstructions')}
            >
              <Textarea
                id="brief-extra"
                name="extraInstructions"
                rows={2}
                placeholder="ex.: foque em jogadores iniciantes"
                defaultValue={initial?.extraInstructions}
              />
            </Field>
          </FormSection>

          {!isEdit ? (
            <FormSection title="Onde publicar">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Site">
                  <Select
                    value={siteId}
                    onValueChange={(v) => {
                      setSiteId(v);
                      setCategoryId(''); // a categoria é do site anterior
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {sites.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Template">
                  <Select value={templateId} onValueChange={setTemplateId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <TemplateChips chips={template?.summary} />
            </FormSection>
          ) : null}

          <FormSection title="Ao terminar">
            <ChoiceCards
              label="Ao terminar"
              value={publishMode}
              onChange={setPublishMode}
              options={[
                {
                  value: 'draft',
                  label: 'Salvar como rascunho',
                  description: 'Você revisa o texto e as imagens aqui no sistema e publica com um clique. Recomendado.',
                },
                {
                  value: 'publish',
                  label: 'Publicar direto',
                  description: 'Vai ao ar assim que terminar. Sem capa, o post continua como rascunho.',
                },
              ]}
            />
          </FormSection>

          <MoreOptions label="Mais opções: idioma, categoria e palavras-chave" onToggle={setMoreOpen}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Idioma">
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="Categoria"
                htmlFor="brief-category"
                optional
                hint={categoryList || categoryLoading || isEdit ? undefined : siteId ? 'Não consegui listar: digite o ID da categoria.' : 'Escolha o site para listar as categorias.'}
                error={err('targetCategoryWpId')}
              >
                {categoryList ? (
                  <Select value={categoryId || 'none'} onValueChange={setCategoryId}>
                    <SelectTrigger className="w-full" id="brief-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Deixar a IA escolher</SelectItem>
                      {categoryList.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="brief-category"
                    inputMode="numeric"
                    placeholder={categoryLoading ? 'Carregando categorias...' : 'ID da categoria, ex.: 5'}
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    disabled={categoryLoading}
                  />
                )}
              </Field>
            </div>
            <Field label="Palavras-chave" htmlFor="brief-keywords" optional hint="Separadas por vírgula.">
              <Input
                id="brief-keywords"
                name="keywords"
                placeholder="ex.: códigos anime vanguards, resgatar"
                defaultValue={initial?.keywords}
              />
            </Field>
          </MoreOptions>

          <DialogFooter className={stickyFooterClass}>
            <Button type="submit" disabled={pending || disabled || (!isEdit && (!siteId || !templateId))}>
              {pending ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Criar e gerar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CreateBriefDialog({ sites, templates }: { sites: Option[]; templates: Option[] }) {
  return (
    <BriefDialog
      sites={sites}
      templates={templates}
      trigger={
        <Button>
          <Plus className="size-4" />
          Nova pauta
        </Button>
      }
    />
  );
}

export function EditBriefButton({ initial }: { initial: BriefFormInitial }) {
  return (
    <BriefDialog
      sites={[]}
      templates={[]}
      initial={initial}
      trigger={
        <Button variant="ghost" size="icon" aria-label={`Editar ${initial.topic}`}>
          <Pencil className="size-4" />
        </Button>
      }
    />
  );
}
