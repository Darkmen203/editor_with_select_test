import { TemplateStore } from './templates.js';
import {
    dbgEvent, dbgSelection, dbgGroup, dumpMutationRecords, markNodeChanged, isWidgetNode
} from './debug.js';

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

                    window.__TPLDBG_ON = false; // отключаем дебаг по умолчанию


                    const btn = document.getElementById('btn-insert');
                    if (btn) btn.addEventListener('click', () => insertDropdown(ed));

                    TemplateStore.onChange((templates) => updateAllDropdowns(ed, templates));

                    // логируем всю цепочку событий ввода
                    const body = ed.getBody();
                    ['beforeinput', 'input', 'compositionstart', 'compositionend'].forEach(t => {
                        body.addEventListener(t, (evt) => dbgEvent(`DOM ${t}`, ed, evt), { capture: true });
                    });

                    ['keydown', 'keyup'].forEach(t => {
                        body.addEventListener(t, (evt) => dbgEvent(`DOM ${t}`, ed, evt), { capture: true });
                    });

                    // Наблюдаем (вставки/удаления узлов)
                    if (window.__TPLDBG_ON) {
                        const mo = new MutationObserver(dumpMutationRecords);
                        mo.observe(body, { childList: true, characterData: true, subtree: true, attributes: true });
                    }

                    // Логи TinyMCE-слоя
                    ed.on('BeforeExecCommand', (e) => dbgEvent('TinyMCE BeforeExecCommand', ed, e));
                    ed.on('ExecCommand', (e) => dbgEvent('TinyMCE ExecCommand', ed, e));
                    ed.on('NodeChange', (e) => dbgGroup('TinyMCE NodeChange', () => ({ selection: 'changed' })));
                    ed.on('Change', (e) => dbgEvent('TinyMCE Change', ed, e));

                    // подавляем размножение при Enter РЯДОМ с компонентом
                    ed.getBody().addEventListener(
                        'beforeinput',
                        (evt) => {
                            if (evt.inputType === 'insertParagraph' && isCaretAdjacentToWidget(ed)) {
                                evt.preventDefault();
                                splitBlockAfterWidget(ed);
                                cleanupAroundCaret(ed);
                                markNodeChanged(ed);
                            }
                        },
                        { capture: true }
                    );

                    // Даём нативному select нормально открываться и не закрываться:
                    const pointerEvents = ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup', 'touchstart', 'touchend'];
                    body.addEventListener(
                        'mousedown',
                        (evt) => {
                            const sel = evt.target && (evt.target.closest?.('select.tpl-select') || (evt.target.tagName === 'SELECT' ? evt.target : null));
                            if (sel) {
                                dbgEvent('select mousedown', ed, evt);
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
                                    if (sel) {
                                        dbgEvent(`select ${t}`, ed, evt);
                                        evt.stopPropagation();
                                    }
                                },
                                { capture: true }
                            )
                        );

                    // Когда пользователь ВЫБРАЛ валидный пункт — снимаем ошибку и удаляем ERROR-опцию.
                    body.addEventListener(
                        'change',
                        (evt) => {
                            const sel = evt.target && (evt.target.closest?.('select.tpl-select') || (evt.target.tagName === 'SELECT' ? evt.target : null));
                            if (!sel) return;
                            dbgEvent('select change', ed, evt, { value: sel.value });
                            const val = decodeURIComponent(sel.value || '');
                            if (val !== '__ERR__') {
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
                    dbgEvent('TinyMCE keydown', ed, e);

                    const target = e.target;

                    // Удаление всего компонента по Backspace/Delete (когда фокус в select)
                    if ((e.key === 'Backspace' || e.key === 'Delete') && target && target.tagName === 'SELECT') {
                        const wrap = target.closest('.tpl-wrap') || target;
                        ed.dom.remove(wrap);
                        e.preventDefault();
                        markNodeChanged(ed);
                        return;
                    }

                    if (e.key === 'Enter') {
                        if (isCaretAdjacentToWidget(ed)) {
                            e.preventDefault();
                            splitBlockAfterWidget(ed);
                            cleanupAroundCaret(ed);
                            markNodeChanged(ed);
                        }
                    }
                });
            }
        });
    });
}

function dropdownHTML(currentValue) {
    const opts = TemplateStore.get();
    const options = opts
        .map(
            (t) =>
                `<option value="${encodeURIComponent(t)}"${t === currentValue ? ' selected' : ''
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

        const nextSelected = prev === '__ERR__' ? templates[0] : prev;

        sel.innerHTML = templates
            .map(
                (t) =>
                    `<option value="${encodeURIComponent(t)}"${t === nextSelected ? ' selected' : ''
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
    } catch { }
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// junk helpers: пропуск служебных и пустых узлов

const ZW_RE = /^[\u00A0\u200B-\u200D\uFEFF\s]*$/; // nbsp, zero-width, feff, whitespace

function isBogusEl(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.getAttribute?.('data-mce-bogus')) return true;
    if (el.id === 'mce_marker') return true;
    if (el.classList?.contains('mce-offscreen-selection')) return true;
    return false;
}

function isJunkNode(n) {
    if (!n) return true;
    if (n.nodeType === Node.TEXT_NODE) return ZW_RE.test(n.nodeValue || '');
    if (n.nodeType === Node.ELEMENT_NODE) {
        if (isBogusEl(n)) return true;
        // пустой спан/инлайн, содержащий только "невидимые" символы
        if (n.childNodes && n.childNodes.length === 1 && n.firstChild.nodeType === Node.TEXT_NODE) {
            return ZW_RE.test(n.firstChild.nodeValue || '');
        }
        // пустой inline элемент без содержимого
        if (!n.firstChild && n.tagName === 'SPAN') return true;
        return false;
    }
    return false;
}

function prevNonJunk(container, offset) {
    if (!container) return null;
    const parent = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;
    let idx = container.nodeType === Node.TEXT_NODE
        ? Array.prototype.indexOf.call(parent.childNodes, container) - (offset === 0 ? 1 : 0)
        : offset - 1;
    while (parent && idx >= 0) {
        const n = parent.childNodes[idx];
        if (!isJunkNode(n)) return n;
        idx--;
    }
    return null;
}

function nextNonJunk(container, offset) {
    if (!container) return null;
    const parent = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;
    let idx = container.nodeType === Node.TEXT_NODE
        ? Array.prototype.indexOf.call(parent.childNodes, container) + (offset === (container.nodeType === Node.TEXT_NODE ? container.length : 0) ? 1 : 0)
        : offset;
    while (parent && idx < parent.childNodes.length) {
        const n = parent.childNodes[idx];
        if (!isJunkNode(n)) return n;
        idx++;
    }
    return null;
}

function isCaretAdjacentToWidget(ed) {
    const rng = ed.selection.getRng();
    if (!rng || !rng.collapsed) return false;

    const node = rng.startContainer;
    const offset = rng.startOffset;

    const left = prevNonJunk(node, offset);
    const right = nextNonJunk(node, offset);

    // лог
    dbgGroup('isCaretAdjacentToWidget(SMART)', () => ({
        left: left ? left.outerHTML || left.nodeValue : null,
        right: right ? right.outerHTML || right.nodeValue : null,
        leftIsWidget: isWidget(left),
        rightIsWidget: isWidget(right)
    }));

    return isWidget(left) || isWidget(right);
}


function isWidget(n) {
    if (!n) return false;
    if (n.tagName === 'SELECT') return true;
    if (n.classList?.contains?.('tpl-wrap')) return true;
    if (typeof n.closest === 'function') return !!n.closest('.tpl-wrap');
    return false;
}

function splitBlockAfterWidget(ed) {
    const doc = ed.getDoc();
    const body = ed.getBody();
    const rng = ed.selection.getRng();

    const node = rng?.startContainer || body;
    const offset = rng?.startOffset || 0;
    const left = prevNonJunk(node, offset);
    const right = nextNonJunk(node, offset);

    const rawWidget =
        (left && (left.closest?.('.tpl-wrap') || (left.tagName === 'SELECT' ? left : null))) ||
        (right && (right.closest?.('.tpl-wrap') || (right.tagName === 'SELECT' ? right : null)));

    if (!rawWidget) {
        insertNewLineAtCaret(ed);
        return;
    }
    const widget = rawWidget.closest?.('.tpl-wrap') || rawWidget;

    const dom = ed.dom;
    const block = dom.getParent(widget, dom.isBlock) || body;

    // создаём новый абзац и гарантируем видимый caret
    const newP = doc.createElement('p');
    const br = doc.createElement('span');
    br.setAttribute('data-mce-type', 'bookmark');
    br.setAttribute('data-mce-bogus', 'all');
    newP.appendChild(br);

    const caretBeforeWidget = right && (right === widget || right.closest?.('.tpl-wrap') === widget);
    const startToMove = caretBeforeWidget ? widget : widget.nextSibling;

    let cursor = startToMove;
    const canMove = (n) => !!n && !isBogusEl(n);

    while (cursor && canMove(cursor)) {
        const next = cursor.nextSibling;
        if (!isJunkNode(cursor)) {
            newP.appendChild(cursor);  // фактический перенос (включая сам .tpl-wrap, если каретка перед ним)
        } else {
            try { cursor.remove(); } catch { }
        }
        cursor = next;
    }

    if (block.nextSibling) block.parentNode.insertBefore(newP, block.nextSibling);
    else block.parentNode.appendChild(newP);

    ensureBlockHasVisualContent(block, doc);

    try {
        const range = doc.createRange();
        range.setStartAfter(br);
        range.collapse(true);
        const sel = ed.selection.getSel();
        sel.removeAllRanges();
        sel.addRange(range);
    } catch {
        ed.selection.setCursorLocation(newP, 0);
    }

    cleanupAroundCaret(ed);
    ed.nodeChanged();
}

function ensureBlockHasVisualContent(block, doc) {
    if (!block) return;
    let hasVisible = false;
    block.childNodes.forEach?.(n => {
        if (!isJunkNode(n) && !isBogusEl(n)) hasVisible = true;
    });
    if (!hasVisible) {
        if (!block.firstChild || block.firstChild.tagName !== 'BR') {
            block.textContent = '';
            block.appendChild(doc.createElement('br'));
        }
    }
}




function cleanupAroundCaret(ed) {
    try {
        const rng = ed.selection.getRng();
        if (!rng) return;
        let container = rng.startContainer.nodeType === Node.TEXT_NODE ? rng.startContainer.parentNode : rng.startContainer;
        if (!container) return;

        const parent = container;
        const purge = (n) => {
            if (!n) return;
            if (n.nodeType === Node.TEXT_NODE && ZW_RE.test(n.nodeValue || '')) {
                n.remove();
            } else if (isBogusEl(n)) {
                n.remove();
            } else if (n.nodeType === Node.ELEMENT_NODE && n.tagName === 'SPAN' && n.childNodes.length === 1 &&
                n.firstChild.nodeType === Node.TEXT_NODE && ZW_RE.test(n.firstChild.nodeValue || '')) {
                n.remove();
            }
        };
        const left = parent.childNodes[rng.startOffset - 1] || null;
        const right = parent.childNodes[rng.startOffset] || null;
        purge(left);
        purge(right);
    } catch { }
}
