import { escapeHtml } from '../html/managed-block';
import { todayLong } from '../i18n/dates';
import type { ManagedBlockRenderer } from './types';

/**
 * Widget interativo de códigos — porta exata do "Code - Build Codes Widget"
 * do n8n (CSS/JS inline auto-contidos, localStorage de códigos usados),
 * com strings localizadas por idioma.
 */

interface CodeItem {
  code: string;
  reward?: string | null;
  isNew?: boolean;
}

const STRINGS: Record<string, Record<string, string>> = {
  pt: {
    title: '🎮 Códigos Ativos',
    updated: 'Atualizado',
    copy: 'Copiar',
    copied: '✓ Copiado!',
    isNew: 'novo',
    used: 'usado',
    expired: 'Códigos expirados',
    reset: '↺ Resetar códigos usados',
    noCodesTitle: 'Sem códigos ativos no momento',
    noCodesText:
      'Ainda não há códigos válidos disponíveis para <strong>{topic}</strong>. Esta página é verificada e atualizada automaticamente — volte em breve!',
  },
  en: {
    title: '🎮 Active Codes',
    updated: 'Updated',
    copy: 'Copy',
    copied: '✓ Copied!',
    isNew: 'new',
    used: 'used',
    expired: 'Expired codes',
    reset: '↺ Reset used codes',
    noCodesTitle: 'No active codes right now',
    noCodesText:
      'There are no valid codes available for <strong>{topic}</strong> yet. This page is checked and updated automatically — check back soon!',
  },
  es: {
    title: '🎮 Códigos Activos',
    updated: 'Actualizado',
    copy: 'Copiar',
    copied: '✓ ¡Copiado!',
    isNew: 'nuevo',
    used: 'usado',
    expired: 'Códigos expirados',
    reset: '↺ Restablecer códigos usados',
    noCodesTitle: 'Sin códigos activos por ahora',
    noCodesText:
      'Todavía no hay códigos válidos disponibles para <strong>{topic}</strong>. Esta página se verifica y actualiza automáticamente — ¡vuelve pronto!',
  },
};

function stringsFor(locale: string) {
  const lang = locale.slice(0, 2).toLowerCase();
  return STRINGS[lang] ?? STRINGS.en!;
}

export const renderGameCodesWidget: ManagedBlockRenderer = ({ data, slug, topicLabel, locale, now }) => {
  const activeCodes = (Array.isArray(data.activeCodes) ? data.activeCodes : []) as CodeItem[];
  const expiredCodes = (Array.isArray(data.expiredCodes) ? data.expiredCodes : []) as CodeItem[];
  const s = stringsFor(locale);
  const today = todayLong(locale, now);

  const slugSafe = String(slug || 'post').replace(/[^a-zA-Z0-9_-]/g, '');
  const widgetId = 'dg-codes-' + slugSafe;

  const cardsHtml = activeCodes
    .map(
      (c) =>
        `  <div class="dg-code-card" data-code="${escapeHtml(c.code)}">\n` +
        '    <div class="dg-code-left">\n' +
        `      <div class="dg-code-str">${escapeHtml(c.code)}` +
        (c.isNew ? ` <span class="dg-badge-new">${s.isNew}</span>` : '') +
        ` <span class="dg-badge-used">${s.used}</span></div>\n` +
        (c.reward ? `      <div class="dg-code-reward">🎁 ${escapeHtml(c.reward)}</div>\n` : '') +
        '    </div>\n' +
        `    <button class="dg-copy-btn" type="button">${s.copy}</button>\n` +
        '  </div>',
    )
    .join('\n');

  const topicHtml = escapeHtml(topicLabel || 'este jogo');
  const noCodesHtml =
    '<div class="dg-no-codes">\n' +
    '  <div class="dg-no-codes-icon">🔍</div>\n' +
    `  <p class="dg-no-codes-title">${s.noCodesTitle}</p>\n` +
    `  <p class="dg-no-codes-text">${s.noCodesText!.replace('{topic}', topicHtml)}</p>\n` +
    '</div>';

  const expiredHtml = expiredCodes.length
    ? '<div class="dg-expired-section">\n' +
      `  <div class="dg-expired-title">${s.expired} (${expiredCodes.length})</div>\n` +
      '  <div class="dg-expired-list">\n' +
      expiredCodes
        .map(
          (c) =>
            `    <div class="dg-expired-card"><span class="dg-expired-code">${escapeHtml(c.code)}</span>` +
            (c.reward ? `<span class="dg-expired-reward">🎁 ${escapeHtml(c.reward)}</span>` : '') +
            '</div>',
        )
        .join('\n') +
      '\n  </div>\n</div>'
    : '';

  return `<div class="dg-codes-widget" id="${widgetId}">
<style>
.dg-codes-widget{font-family:system-ui,sans-serif;margin:24px 0}
.dg-codes-widget .dg-cw-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px}
.dg-codes-widget .dg-cw-title{font-size:18px;font-weight:700;color:#0f172a;margin:0}
.dg-codes-widget .dg-cw-updated{font-size:12px;color:#475569;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:3px 10px}
.dg-codes-widget .dg-cw-grid{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}
.dg-codes-widget .dg-code-card{display:flex;align-items:center;gap:10px;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;transition:border-color .15s}
.dg-codes-widget .dg-code-card:hover{border-color:#7c6ff7}
.dg-codes-widget .dg-code-card.dg-used{opacity:.6}
.dg-codes-widget .dg-code-card.dg-used .dg-code-str{text-decoration:line-through;color:#94a3b8}
.dg-codes-widget .dg-code-left{flex:1;min-width:0}
.dg-codes-widget .dg-code-str{font-family:monospace;font-size:14px;font-weight:700;color:#1e293b;display:flex;align-items:center;gap:6px;word-break:break-all}
.dg-codes-widget .dg-badge-new{font-size:9px;font-weight:700;background:#7c6ff7;color:#fff;padding:2px 6px;border-radius:4px;letter-spacing:.04em;text-transform:uppercase;flex-shrink:0}
.dg-codes-widget .dg-badge-used{font-size:9px;font-weight:700;background:#e2e8f0;color:#64748b;padding:2px 6px;border-radius:4px;letter-spacing:.04em;text-transform:uppercase;flex-shrink:0;display:none}
.dg-codes-widget .dg-code-card.dg-used .dg-badge-used{display:inline}
.dg-codes-widget .dg-code-reward{font-size:12px;color:#64748b;margin-top:3px}
.dg-codes-widget .dg-copy-btn{flex-shrink:0;font-size:12px;font-weight:600;padding:7px 14px;border-radius:8px;border:none;background:#7c6ff7;color:#fff;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}
.dg-codes-widget .dg-copy-btn:hover{background:#6457e0}
.dg-codes-widget .dg-copy-btn.dg-copied{background:#059669}
.dg-codes-widget .dg-code-card.dg-used .dg-copy-btn{background:#f1f5f9;color:#94a3b8;cursor:default}
.dg-codes-widget .dg-no-codes{background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:24px 16px;text-align:center;margin-bottom:16px}
.dg-codes-widget .dg-no-codes-icon{font-size:28px;margin-bottom:8px}
.dg-codes-widget .dg-no-codes-title{font-size:15px;font-weight:700;color:#334155;margin:0 0 6px}
.dg-codes-widget .dg-no-codes-text{font-size:13px;color:#64748b;margin:0}
.dg-codes-widget .dg-expired-section{margin-top:8px}
.dg-codes-widget .dg-expired-title{font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:6px}
.dg-codes-widget .dg-expired-title::after{content:'▾';transition:transform .2s}
.dg-codes-widget .dg-expired-title.open::after{transform:rotate(180deg)}
.dg-codes-widget .dg-expired-list{display:none}
.dg-codes-widget .dg-expired-list.open{display:flex;flex-direction:column;gap:6px}
.dg-codes-widget .dg-expired-card{display:flex;align-items:center;gap:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;opacity:.6}
.dg-codes-widget .dg-expired-code{font-family:monospace;font-size:13px;color:#94a3b8;text-decoration:line-through;flex:1}
.dg-codes-widget .dg-expired-reward{font-size:11px;color:#64748b}
.dg-codes-widget .dg-reset-btn{font-size:11px;color:#64748b;background:none;border:none;cursor:pointer;font-family:inherit;text-decoration:underline;margin-top:8px;display:block}
.dg-codes-widget .dg-reset-btn:hover{color:#0f172a}
@media(max-width:480px){
  .dg-codes-widget .dg-copy-btn{padding:7px 10px;font-size:11px}
  .dg-codes-widget .dg-code-str{font-size:13px}
}
</style>

<div class="dg-cw-header">
  <h3 class="dg-cw-title">${s.title}</h3>
  <span class="dg-cw-updated">${s.updated}: ${today}</span>
</div>

${activeCodes.length ? '<div class="dg-cw-grid">\n' + cardsHtml + '\n</div>' : noCodesHtml}

${expiredHtml}

${activeCodes.length ? `<button class="dg-reset-btn" type="button">${s.reset}</button>` : ''}

<script>
(function(){
  var root = document.getElementById('${widgetId}');
  if (!root) return;
  var NS = 'dg_used_${slugSafe}';

  function getUsed(){ try { return JSON.parse(localStorage.getItem(NS) || '[]'); } catch(_) { return []; } }
  function saveUsed(arr){ try { localStorage.setItem(NS, JSON.stringify(arr)); } catch(_) {} }

  function applyUsed(){
    var used = getUsed();
    var cards = root.querySelectorAll('.dg-code-card[data-code]');
    for (var i = 0; i < cards.length; i++) {
      if (used.indexOf(cards[i].getAttribute('data-code')) > -1) cards[i].classList.add('dg-used');
    }
  }

  root.addEventListener('click', function(ev){
    var target = ev.target;
    if (!target || !target.closest) return;

    var btn = target.closest('.dg-copy-btn');
    if (btn) {
      var card = btn.closest('.dg-code-card');
      var code = card ? card.getAttribute('data-code') : '';
      if (!code) return;
      navigator.clipboard.writeText(code).then(function(){
        btn.textContent = '${s.copied}';
        btn.classList.add('dg-copied');
        setTimeout(function(){ btn.textContent = '${s.copy}'; btn.classList.remove('dg-copied'); }, 2200);
        card.classList.add('dg-used');
        var used = getUsed();
        if (used.indexOf(code) === -1) { used.push(code); saveUsed(used); }
      });
      return;
    }

    var title = target.closest('.dg-expired-title');
    if (title) {
      title.classList.toggle('open');
      if (title.nextElementSibling) title.nextElementSibling.classList.toggle('open');
      return;
    }

    var reset = target.closest('.dg-reset-btn');
    if (reset) {
      try { localStorage.removeItem(NS); } catch(_) {}
      var all = root.querySelectorAll('.dg-code-card');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('dg-used');
    }
  });

  applyUsed();
})();
</script>
</div>`;
};
