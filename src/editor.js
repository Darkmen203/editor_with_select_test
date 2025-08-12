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
            extended_valid_elements: 'select[class|value],option[value|selected|class],span[class|contenteditable]',
            content_style: `
            .tpl-select { padding: 2px 4px; font: inherit; }
            @media (prefers-color-scheme: dark) {
                .mce-content-body{ color: #e8e8ea} 
                .tpl-select { background: #1f1f27; color: #e8e8ea; }
                    .tox { color: #e8e8ea; }
                }
                .tpl-error { color: #d11; font-weight: 600; } /* для самой опции в списке */
                .tpl-select--error { color: #d11; font-weight: 600; }
            `,
            setup(ed) {
                editor = ed;

                ed.on('init', () => {
                    const btn = document.getElementById('btn-insert');
                    if (btn) btn.addEventListener('click', () => insertDropdown(ed));

                    TemplateStore.onChange((templates) => updateAllDropdowns(ed, templates));

                    resolve(ed);
                });
            }
        });
    });
}

function dropdownHTML(currentValue) {
    const opts = TemplateStore.get();
    const options = opts
        .map(t => `<option value="${encodeURIComponent(t)}"${t === currentValue ? ' selected' : ''}>${escapeHtml(t)}</option>`)
        .join('');
    return `<select class="tpl-select">${options}</select>`;
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

export function updateAllDropdowns(ed, templates) {
    if (!ed || !ed.getBody) return;
    const body = ed.getBody();
    if (!body) return;

    const selects = body.querySelectorAll('select.tpl-select');
    if (!selects.length) return;

    if (templates.length === 0) {
        selects.forEach(sel => {
            sel.innerHTML = `<option value="__ERR__" class="tpl-error" selected>ERROR</option>`;
            sel.value = '__ERR__';
            sel.classList.add('tpl-select--error');
            sel.setAttribute('aria-invalid', 'true');
            sel.title = 'Список шаблонов пуст';
        });
        return;
    }

    selects.forEach(sel => {
        const prev = decodeURIComponent(sel.value || '');
        const isPrevValid = templates.includes(prev);
        const nextSelected = (prev === '__ERR__' || !isPrevValid) ? templates[0] : prev;

        sel.innerHTML = templates
            .map(t => `<option value="${encodeURIComponent(t)}"${t === nextSelected ? ' selected' : ''}>${escapeHtml(t)}</option>`)
            .join('');

        sel.value = encodeURIComponent(nextSelected);
        sel.classList.remove('tpl-select--error');
        sel.removeAttribute('aria-invalid');
        sel.removeAttribute('title');
    });
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}
