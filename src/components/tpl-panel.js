import { TemplateStore } from '../templates.js';

const tpl = document.createElement('template');
tpl.innerHTML = `
  <style>
    :host { display:flex; flex-direction:column; gap:8px; }
    ul { list-style:none; margin:0; padding:0; border:1px solid #ddd; background: rgba(0,0,0, 0.2); min-height:120px }
    li { padding:6px 8px; cursor:pointer }
    li.active { background:#e6f0ff }
    .actions { display:flex; gap:8px }
    input { width:100%; box-sizing:border-box; }

    @media (prefers-color-scheme: dark) {
        ul { border:1px solid #232330; }
        li.active { background: #232330 }
        button {
            background: #1f1f27;
            color: #e8e8ea;
            border-color: var(--border);
        }
        button:hover{
            background: #232330;
        }
        input{
            background: #1f1f27;
            color: #e8e8ea;
        }
    }
  </style>
  <h3>Templates</h3>
  <ul id="list" role="listbox" aria-label="Templates"></ul>
  <div class="actions">
    <button id="del" title="Удалить выбранный">−</button>
    <button id="add" title="Добавить новый">+</button>
  </div>
  <label>Edit template</label>
  <input id="edit" type="text" placeholder="template" />
`;

export class TplPanel extends HTMLElement {
    #selected = 0;
    #unsubscribe = null;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' }).appendChild(tpl.content.cloneNode(true));
        this.$list = this.shadowRoot.getElementById('list');
        this.$edit = this.shadowRoot.getElementById('edit');
        this.shadowRoot.getElementById('add').addEventListener('click', this.#onAdd);
        this.shadowRoot.getElementById('del').addEventListener('click', this.#onDel);
        this.$list.addEventListener('click', this.#onPick);
        this.$edit.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); this.#commit(); this.$edit.blur(); }
        });
        this.$edit.addEventListener('blur', this.#commit);
    }

    connectedCallback() {
        this.#unsubscribe = TemplateStore.onChange(this.#render);
    }
    disconnectedCallback() {
        this.#unsubscribe?.();
    }

    #render = (arr) => {
        if (arr.length === 0) this.#selected = 0;
        else if (this.#selected >= arr.length) this.#selected = arr.length - 1;

        this.$list.innerHTML = arr.map((t, i) => `<li data-i="${i}">${this.#esc(t)}</li>`).join('');
        [...this.$list.children].forEach((li, i) => li.classList.toggle('active', i === this.#selected));

        this.$edit.value = arr[this.#selected] ?? '';
        this.dispatchEvent(new CustomEvent('select-change', { detail: { index: this.#selected } }));
    };

    #onPick = (e) => {
        const li = e.target.closest('li[data-i]');
        if (!li) return;
        this.#selected = Number(li.dataset.i);
        this.#render(TemplateStore.get());
        this.$edit.focus();
    };
    #onAdd = () => {
        TemplateStore.add('template');
        this.#selected = TemplateStore.get().length - 1;
    };
    #onDel = () => {
        TemplateStore.removeAt(this.#selected);
        this.#selected = Math.max(0, this.#selected - 1);
    };
    #commit = () => {
        const v = this.$edit.value.trim();
        if (v) TemplateStore.updateAt(this.#selected, v);
    };
    #esc(s) { return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
}

customElements.define('tpl-panel', TplPanel);
