import { TemplateStore } from './templates.js';

export let editor;

export function initEditor() {
    return new Promise((resolve) => {
        if (!window.tinymce) {
            console.error('TinyMCE not loaded');
            return resolve();
        }

        tinymce.init({
            selector: '#editor',
            menubar: false,
            toolbar: false,
            statusbar: true,
            min_height: 500,
            max_height: 1200,
            resize: true,
            elementpath: false,
            object_resizing: false,
            // Разрешаем наш виджет и нужные атрибуты
            extended_valid_elements:
                'span[class|data-tpl|contenteditable|draggable|unselectable|data-mce-resize],select[class|value],option[value|selected|class],span[class|contenteditable]',
            content_style: `
              .tpl-select { padding: 2px 4px; font: inherit; }
              .tpl-wrap { display:inline-block; }
              /* Ошибку показываем рамкой у select, без покраски текста опций */
              .tpl-select--error { outline: 2px solid #d11; }

              @media (prefers-color-scheme: dark) {
                .mce-content-body{ color: #e8e8ea}
                .tpl-select { background: #1f1f27; color: #e8e8ea; }
                .tox { color: #e8e8ea; }
              }
            `,
            setup(ed) {
                editor = ed;

                ed.on('init', () => {
                    const btn = document.getElementById('btn-insert');
                    if (btn) btn.addEventListener('click', () => insertDropdown(ed));

                    TemplateStore.onChange((templates) => updateAllDropdowns(ed, templates));

                    // 1) Надёжно подавляем размножение при Enter РЯДОМ с компонентом
                    ed.getBody().addEventListener(
                        'beforeinput',
                        (evt) => {
                            if (evt.inputType === 'insertParagraph' && isCaretAdjacentToWidget(ed)) {
                                evt.preventDefault();
                                insertNewLineAtCaret(ed);
                            }
                        },
                        { capture: true }
                    );

                    // 2) Даём нативному select нормально открываться и не закрываться:
                    //    глушим всплытие указательных событий (но НЕ preventDefault),
                    //    и прямо здесь приводим ERROR к нужному виду для выпадения списка.
                    const body = ed.getBody();
                    const pointerEvents = ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup', 'touchstart', 'touchend'];
                    body.addEventListener(
                        'mousedown',
                        (evt) => {
                            const sel = evt.target && (evt.target.closest?.('select.tpl-select') || (evt.target.tagName === 'SELECT' ? evt.target : null));
                            if (sel) {
                                handleSelectOpen(sel); // спрячем ERROR из выпадающего списка (если есть валидные)
                                evt.stopPropagation();
                            }
                        },
                        { capture: true }
                    );
                    pointerEvents
                        .filter((t) => t !== 'mousedown')
                        .forEach((t) =>
                            body.addEventListener(
                                t,
                                (evt) => {
                                    const sel = evt.target && (evt.target.closest?.('select.tpl-select') || (evt.target.tagName === 'SELECT' ? evt.target : null));
                                    if (sel) evt.stopPropagation();
                                },
                                { capture: true }
                            )
                        );

                    // 3) Когда пользователь ВЫБРАЛ валидный пункт — снимаем ошибку и удаляем ERROR-опцию.
                    body.addEventListener(
                        'change',
                        (evt) => {
                            const sel = evt.target && (evt.target.closest?.('select.tpl-select') || (evt.target.tagName === 'SELECT' ? evt.target : null));
                            if (!sel) return;
                            const val = decodeURIComponent(sel.value || '');
                            if (val !== '__ERR__') {
                                // Снимаем ошибку и удаляем ERROR-опцию, если она ещё есть
                                sel.classList.remove('tpl-select--error');
                                sel.removeAttribute('aria-invalid');
                                sel.removeAttribute('title');
                                const err = sel.querySelector('option[value="__ERR__"]');
                                if (err) err.remove();
                            }
                        },
                        { capture: true }
                    );

                    resolve(ed);
                });

                // Клавиатура для спецкомпонента
                ed.on('keydown', (e) => {
                    const target = e.target;

                    // Удаление всего компонента по Backspace/Delete (когда фокус в select)
                    if ((e.key === 'Backspace' || e.key === 'Delete') && target && target.tagName === 'SELECT') {
                        const wrap = target.closest('.tpl-wrap') || target;
                        ed.dom.remove(wrap);
                        e.preventDefault();
                        return;
                    }

                    if (e.key === 'Enter') {
                        // НЕ перехватываем Enter внутри самого select — только если каретка рядом с виджетом
                        if (isCaretAdjacentToWidget(ed)) {
                            e.preventDefault();
                            insertNewLineAtCaret(ed);
                        }
                    }
                });
            }
        });
    });
}

/** HTML спецкомпонента: обёртка не редактируется, чтобы TinyMCE не «сплитил» её на Enter */
function dropdownHTML(currentValue) {
    const opts = TemplateStore.get();
    const options = opts
        .map(
            (t) =>
                `<option value="${encodeURIComponent(t)}"${
                    t === currentValue ? ' selected' : ''
                }>${escapeHtml(t)}</option>`
        )
        .join('');
    return `
    <span class="tpl-wrap"
          contenteditable="false"
          data-tpl="1"
          draggable="false"
          unselectable="on"
          data-mce-resize="false">
      <select class="tpl-select">${options}</select>
    </span>`;
}

export function insertDropdown(ed) {
    const templates = TemplateStore.get();
    if (!templates.length) {
        ed.notificationManager.open({
            text: 'В списке шаблонов нет ни одного элемента.',
            type: 'warning',
            timeout: 3000
        });
        return;
    }
    ed.insertContent(dropdownHTML(templates[0]));
}

/**
 * Обновление всех select:
 *  - Пустой список -> показываем ERROR, подсвечиваем рамкой.
 *  - Удалили активный пункт -> ERROR выбран, остальные опции остаются.
 */
export function updateAllDropdowns(ed, templates) {
    if (!ed || !ed.getBody) return;
    const body = ed.getBody();
    if (!body) return;

    const selects = body.querySelectorAll('span.tpl-wrap > select.tpl-select');
    if (!selects.length) return;

    if (templates.length === 0) {
        selects.forEach((sel) => {
            sel.innerHTML = `<option value="__ERR__" selected>ERROR</option>`;
            sel.value = '__ERR__';
            sel.classList.add('tpl-select--error');
            sel.setAttribute('aria-invalid', 'true');
            sel.title = 'Список шаблонов пуст';
        });
        return;
    }

    selects.forEach((sel) => {
        const prev = decodeURIComponent(sel.value || '');
        const isPrevValid = templates.includes(prev);

        if (!isPrevValid && prev !== '__ERR__') {
            // ERROR выбран, но оставляем валидные опции для перевыбора
            const errorOpt = `<option value="__ERR__" selected>ERROR</option>`;
            const normalOpts = templates
                .map((t) => `<option value="${encodeURIComponent(t)}">${escapeHtml(t)}</option>`)
                .join('');
            sel.innerHTML = errorOpt + normalOpts;
            sel.value = '__ERR__';
            sel.classList.add('tpl-select--error');
            sel.setAttribute('aria-invalid', 'true');
            sel.title = 'Выбранный шаблон был удалён';
            return;
        }

        // Нормальный случай: строим список без ERROR-опции.
        const nextSelected = prev === '__ERR__' ? templates[0] : prev;

        sel.innerHTML = templates
            .map(
                (t) =>
                    `<option value="${encodeURIComponent(t)}"${
                        t === nextSelected ? ' selected' : ''
                    }>${escapeHtml(t)}</option>`
            )
            .join('');

        sel.value = encodeURIComponent(nextSelected);
        sel.classList.remove('tpl-select--error');
        sel.removeAttribute('aria-invalid');
        sel.removeAttribute('title');
    });
}

/* ======================= helpers ======================= */

/**
 * При попытке ОТКРЫТЬ select в состоянии ERROR:
 * - если есть валидные опции, скрываем ERROR-опцию в списке (hidden+disabled),
 *   но оставляем её выбранной, чтобы пользователь ЯВНО перевыбрал значение;
 * - после выбора валидного пункта (событие change) — снимаем подсветку и удаляем ERROR-опцию.
 */
function handleSelectOpen(sel) {
    try {
        if (decodeURIComponent(sel.value || '') !== '__ERR__') return;

        const options = Array.from(sel.options);
        const hasValid = options.some((o) => decodeURIComponent(o.value) !== '__ERR__');
        if (!hasValid) return;

        const err = sel.querySelector('option[value="__ERR__"]');
        if (err) {
            // Прячем ERROR из выпадающего списка, но оставляем текущим выбранным
            err.hidden = true;
            err.disabled = true;
        }
        // Подсветка и aria-атрибуты остаются до change (человек сам выбирает валидный пункт)
    } catch {}
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function isCaretAdjacentToWidget(ed) {
    const rng = ed.selection.getRng();
    if (!rng || !rng.collapsed) return false;

    let node = rng.startContainer;
    let offset = rng.startOffset;

    if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentNode;
        if (!parent) return false;
        const idx = Array.prototype.indexOf.call(parent.childNodes, node);
        const prev = parent.childNodes[idx - (offset === 0 ? 1 : 0)];
        const next = parent.childNodes[idx + (offset === node.length ? 1 : 0)];
        return isWidget(prev) || isWidget(next);
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
        const prev = node.childNodes[offset - 1];
        const next = node.childNodes[offset];
        return isWidget(prev) || isWidget(next);
    }
    return false;
}

function isWidget(n) {
    if (!n) return false;
    if (n.tagName === 'SELECT') return true;
    if (n.classList?.contains?.('tpl-wrap')) return true;
    if (typeof n.closest === 'function') return !!n.closest('.tpl-wrap');
    return false;
}

function insertNewLineAfterNode(ed, node) {
    const br = ed.getDoc().createElement('br');
    const parent = node.parentNode;
    if (node.nextSibling) parent.insertBefore(br, node.nextSibling);
    else parent.appendChild(br);

    const pos = Array.prototype.indexOf.call(parent.childNodes, br) + 1;
    ed.selection.setCursorLocation(parent, pos);
}

function insertNewLineAtCaret(ed) {
  const doc = ed.getDoc();
  const body = ed.getBody();
  const rng = ed.selection.getRng();

  // создаём пустой параграф как у TinyMCE при Enter
  const p = doc.createElement('p');
  const br = doc.createElement('br');
  br.setAttribute('data-mce-bogus', '1');
  p.appendChild(br);

  if (!rng) {
    body.appendChild(p);
  } else if (rng.startContainer.nodeType === Node.TEXT_NODE) {
    // курсор внутри текста: сплитим и вставляем <p> между частями
    const text = rng.startContainer;
    const off = rng.startOffset;
    const tail = text.splitText(off);
    tail.parentNode.insertBefore(p, tail);
  } else if (rng.startContainer.nodeType === Node.ELEMENT_NODE) {
    // курсор «между узлами»: вставляем <p> в это место
    const parent = rng.startContainer;
    const ref = parent.childNodes[rng.startOffset] || null;
    parent.insertBefore(p, ref);
  } else {
    body.appendChild(p);
  }

  // Если вдруг <p> оказался внутри виджета (.tpl-wrap), переносим его сразу за виджет
  if (p.closest && p.closest('.tpl-wrap')) {
    const wrap = p.closest('.tpl-wrap');
    if (wrap && wrap.parentNode) {
      wrap.parentNode.insertBefore(p, wrap.nextSibling);
    }
  }

  // ставим курсор в начало нового параграфа и уведомляем редактор
  ed.selection.setCursorLocation(p, 0);
  ed.nodeChanged();
}

