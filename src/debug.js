// src/debug.js
// Включение/выключение логов: окно __TPLDBG_ON = true/false
const ON = (() => {
  if (typeof window === 'undefined') return true;
  if (window.__TPLDBG_ON === true) return true;
  if (localStorage.getItem('__TPLDBG_ON') === '1') return true;
  return true;
})();

function domPath(node) {
  if (!node || node === node.ownerDocument) return '';
  if (node.nodeType === Node.TEXT_NODE) {
    return domPath(node.parentNode) + ' > #text';
  }
  const idx = node.parentNode
    ? Array.prototype.indexOf.call(node.parentNode.childNodes, node)
    : -1;
  const id = node.id ? `#${node.id}` : '';
  const cls = node.classList?.length ? '.' + [...node.classList].join('.') : '';
  return domPath(node.parentNode) + ` > ${node.tagName || '?'}${id}${cls}[${idx}]`;
}

function shortHTML(node, max = 300) {
  try {
    if (!node) return '(null)';
    const s = node.outerHTML ?? node.textContent ?? String(node);
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return '(unserializable)';
  }
}

function htmlContext(ed, radius = 1) {
  try {
    const rng = ed.selection.getRng();
    if (!rng) return { info: 'no range' };
    let node = rng.startContainer;
    let offset = rng.startOffset;

    const around = [];
    let parent, idx;
    if (node.nodeType === Node.TEXT_NODE) {
      parent = node.parentNode;
      idx = Array.prototype.indexOf.call(parent.childNodes, node);
      const left = parent.childNodes[idx - (offset === 0 ? 1 : 0)];
      const right = parent.childNodes[idx + (offset === node.length ? 1 : 0)];
      around.push({ side: 'left', node: left, html: shortHTML(left) });
      around.push({ side: 'right', node: right, html: shortHTML(right) });
    } else {
      parent = node;
      const left = parent.childNodes[offset - 1];
      const right = parent.childNodes[offset];
      around.push({ side: 'left', node: left, html: shortHTML(left) });
      around.push({ side: 'right', node: right, html: shortHTML(right) });
    }
    return {
      selection: {
        collapsed: !!rng.collapsed,
        startContainerType: node.nodeType,
        startOffset: offset,
        path: domPath(node)
      },
      parent: { path: domPath(parent), html: shortHTML(parent, 600) },
      around
    };
  } catch (e) {
    return { error: String(e) };
  }
}

export function dbgGroup(title, dataFn) {
  if (!ON) return;
  try {
    console.groupCollapsed(`%c[tpl-dbg] ${title}`, 'color:#6b5cff;font-weight:600');
    const val = typeof dataFn === 'function' ? dataFn() : dataFn;
    console.log(val);
  } finally {
    console.groupEnd();
  }
}

export function dbgEvent(tag, ed, evt, extra = {}) {
  if (!ON) return;
  dbgGroup(`${tag}`, () => ({
    type: evt?.type,
    key: evt?.key,
    code: evt?.code,
    inputType: evt?.inputType,
    detail: extra,
    context: ed ? htmlContext(ed) : undefined
  }));
}

export function dumpMutationRecords(records) {
  if (!ON) return;
  console.groupCollapsed('%c[tpl-dbg] MutationObserver', 'color:#6b5cff;font-weight:600');
  records.forEach((r, i) => {
    console.log(`#${i}`, {
      type: r.type,
      target: shortHTML(r.target, 200),
      added: [...r.addedNodes].map(n => shortHTML(n)),
      removed: [...r.removedNodes].map(n => shortHTML(n)),
      attributeName: r.attributeName
    });
  });
  console.groupEnd();
}

export function markNodeChanged(ed) {
  if (!ON) return;
  dbgGroup('ed.nodeChanged()', () => htmlContext(ed));
}

export function dbgSelection(ed, label = 'selection') {
  if (!ON) return;
  dbgGroup(label, () => htmlContext(ed));
}

export function isWidgetNode(n) {
  try {
    if (!n) return false;
    if (n.tagName === 'SELECT') return true;
    if (n.classList?.contains?.('tpl-wrap')) return true;
    if (typeof n.closest === 'function') return !!n.closest('.tpl-wrap');
    return false;
  } catch {
    return false;
  }
}
