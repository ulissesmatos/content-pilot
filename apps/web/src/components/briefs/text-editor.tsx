'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Save, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { saveTextEditsAction } from '@/actions/brief-edit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Ajustes básicos no texto do artigo, direto na prévia.
 *
 * O texto continua sendo o HTML já sanitizado que a página desenha. Ao entrar no modo de edição,
 * cada parágrafo, título de seção e item de lista (os elementos com `data-edit-index`) vira
 * editável no próprio lugar. Ao salvar, o navegador manda só o que mudou, com o texto original
 * de cada trecho: se o WordPress mudou aquele trecho nesse meio tempo, o servidor recusa tudo em
 * vez de sobrescrever o trabalho de outra pessoa.
 *
 * Limites de propósito: sem criar nem apagar parágrafos (Enter é bloqueado) e a colagem entra
 * como texto puro. Reestruturar o artigo é trabalho do editor do WordPress.
 */

interface PendingEdit {
  beforeText: string;
  afterHtml: string;
}

interface State {
  canEdit: boolean;
  editing: boolean;
  saving: boolean;
  dirtyCount: number;
  title: string;
}

interface Actions {
  start: () => void;
  cancel: () => void;
  save: () => Promise<void>;
  setTitle: (title: string) => void;
  /** Um trecho mudou (edit) ou voltou ao que era (null). */
  report: (index: number, edit: PendingEdit | null) => void;
  /** Quem desenha texto registra como desfazer as próprias edições. */
  subscribeReset: (reset: () => void) => () => void;
}

const StateCtx = createContext<State | null>(null);
const ActionsCtx = createContext<Actions | null>(null);

export function TextEditProvider({
  briefId,
  initialTitle,
  canEdit,
  children,
}: {
  briefId: string;
  initialTitle: string;
  canEdit: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('editor');
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [title, setTitleState] = useState(initialTitle);
  const edits = useRef(new Map<number, PendingEdit>());
  const resets = useRef(new Set<() => void>());
  // As ações precisam ser ESTÁVEIS: quem desenha o texto refaz a edição se elas mudarem (e perderia o
  // "como era antes" de cada trecho). Por isso leem o valor mais recente por aqui, e não por fechamento.
  const latest = useRef({ title, initialTitle, t });
  useEffect(() => {
    latest.current = { title, initialTitle, t };
  });

  // o título vem do servidor: depois de salvar e recarregar, o campo acompanha
  const [seenTitle, setSeenTitle] = useState(initialTitle);
  if (seenTitle !== initialTitle) {
    setSeenTitle(initialTitle);
    setTitleState(initialTitle);
  }

  const titleDirty = title.trim() !== initialTitle.trim();
  const totalDirty = dirtyCount + (titleDirty ? 1 : 0);

  const exit = useCallback(() => {
    edits.current.clear();
    setDirtyCount(0);
    setEditing(false);
  }, []);

  const actions = useMemo<Actions>(
    () => ({
      start: () => setEditing(true),
      cancel: () => {
        for (const reset of resets.current) reset();
        setTitleState(latest.current.initialTitle);
        exit();
      },
      setTitle: setTitleState,
      report: (index, edit) => {
        if (edit) edits.current.set(index, edit);
        else edits.current.delete(index);
        setDirtyCount(edits.current.size);
      },
      subscribeReset: (reset) => {
        resets.current.add(reset);
        return () => {
          resets.current.delete(reset);
        };
      },
      save: async () => {
        const { title: typed, initialTitle: original, t } = latest.current;
        const titleChanged = typed.trim() !== original.trim();
        if (edits.current.size === 0 && !titleChanged) {
          toast.message(t('nothingChanged'));
          exit();
          return;
        }
        setSaving(true);
        try {
          const result = await saveTextEditsAction({
            id: briefId,
            title: titleChanged ? typed.trim() : undefined,
            edits: [...edits.current.entries()].map(([index, e]) => ({ index, beforeText: e.beforeText, afterHtml: e.afterHtml })),
          });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(t('textSaved'));
          exit();
          router.refresh();
        } finally {
          setSaving(false);
        }
      },
    }),
    [briefId, exit, router],
  );

  // avisa antes de fechar a aba com alteração não salva
  useEffect(() => {
    if (!editing || totalDirty === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editing, totalDirty]);

  const state = useMemo<State>(() => ({ canEdit, editing, saving, dirtyCount: totalDirty, title }), [canEdit, editing, saving, totalDirty, title]);

  return (
    <ActionsCtx.Provider value={actions}>
      <StateCtx.Provider value={state}>{children}</StateCtx.Provider>
    </ActionsCtx.Provider>
  );
}

function useEditor() {
  return { state: useContext(StateCtx), actions: useContext(ActionsCtx) };
}

/** Botão do cabeçalho que liga o modo de edição. */
export function EditTextButton() {
  const t = useTranslations('editor');
  const { state, actions } = useEditor();
  if (!state?.canEdit || state.editing || !actions) return null;
  return (
    <Button type="button" variant="outline" size="sm" onClick={actions.start}>
      <Pencil className="size-4" />
      {t('editText')}
    </Button>
  );
}

/** O título do artigo: texto na leitura, campo no modo de edição. */
export function EditableTitle({ className }: { className?: string }) {
  const t = useTranslations('editor');
  const { state, actions } = useEditor();
  if (!state || !actions) return null;
  if (!state.editing) return <h1 className={className}>{state.title}</h1>;
  return (
    <Input
      aria-label={t('titleField')}
      value={state.title}
      maxLength={200}
      onChange={(e) => actions.setTitle(e.target.value)}
      className="h-auto text-2xl font-semibold tracking-tight md:text-2xl"
    />
  );
}

/** Barra fixa no topo do artigo enquanto se edita: instrução, descartar e salvar. */
export function TextEditBar() {
  const t = useTranslations('editor');
  const { state, actions } = useEditor();
  if (!state?.editing || !actions) return null;
  return (
    <div className="bg-background/95 sticky top-0 z-20 -mx-5 -mt-5 mb-2 flex flex-wrap items-center gap-3 border-b px-5 py-3 backdrop-blur sm:-mx-8 sm:-mt-8 sm:px-8">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t('editingTitle')}</p>
        <p className="text-muted-foreground text-xs">{t('editingHint')}</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={actions.cancel} disabled={state.saving}>
        <X className="size-4" />
        {t('discard')}
      </Button>
      <Button type="button" size="sm" onClick={() => void actions.save()} disabled={state.saving || state.dirtyCount === 0}>
        <Save className="size-4" />
        {t('saveText', { count: state.dirtyCount })}
      </Button>
    </div>
  );
}

/**
 * Um trecho de HTML do artigo (já sanitizado pelo servidor). Sem o provedor de edição, ou fora do
 * modo de edição, é só texto. No modo de edição, os elementos marcados com `data-edit-index` viram
 * editáveis no lugar.
 */
export function HtmlSegment({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { state, actions } = useEditor();
  const editing = Boolean(state?.editing);

  useEffect(() => {
    const root = ref.current;
    if (!root || !editing || !actions) return;

    const elements = [...root.querySelectorAll<HTMLElement>('[data-edit-index]')];
    const original = new Map<number, { html: string; text: string }>();
    for (const el of elements) {
      original.set(Number(el.dataset.editIndex), { html: el.innerHTML, text: el.textContent ?? '' });
      el.contentEditable = 'true';
      el.spellcheck = true;
      el.dataset.editing = 'true';
    }

    const targetOf = (ev: Event) => (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-edit-index]') ?? null;
    const onInput = (ev: Event) => {
      const el = targetOf(ev);
      if (!el) return;
      const index = Number(el.dataset.editIndex);
      const o = original.get(index);
      if (!o) return;
      actions.report(index, el.innerHTML === o.html ? null : { beforeText: o.text, afterHtml: el.innerHTML });
    };
    // Enter criaria <div> ou parágrafo novo: fora do escopo deste modo
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Enter') ev.preventDefault();
    };
    // colar entra sempre como texto puro: nada de HTML de outra página dentro do artigo
    const onPaste = (ev: ClipboardEvent) => {
      ev.preventDefault();
      const text = (ev.clipboardData?.getData('text/plain') ?? '').replace(/\s+/g, ' ');
      document.execCommand('insertText', false, text);
    };
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('paste', onPaste);

    const unsubscribe = actions.subscribeReset(() => {
      for (const el of elements) {
        const o = original.get(Number(el.dataset.editIndex));
        if (o) el.innerHTML = o.html;
      }
    });

    return () => {
      unsubscribe();
      root.removeEventListener('input', onInput);
      root.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('paste', onPaste);
      for (const el of elements) {
        el.removeAttribute('contenteditable');
        delete el.dataset.editing;
      }
    };
  }, [editing, actions]);

  return <div ref={ref} className={cn(editing && 'article-editing')} dangerouslySetInnerHTML={{ __html: html }} />;
}
