export const TemplateStore = (() => {
    let templates = ['template 1'];
    const listeners = new Set();
    const emit = () => listeners.forEach(fn => fn([...templates]));

    const inRange = (i) => Number.isInteger(i) && i >= 0 && i < templates.length;

    return {
        get: () => [...templates],
        add: (txt = 'template') => { templates.push(String(txt)); emit(); },
        removeAt: (i) => {
            if (!inRange(i)) return;
            templates.splice(i, 1);
            emit();
        },
        updateAt: (i, txt) => {
            if (!inRange(i)) return;
            const v = String(txt);
            if (templates[i] === v) return;
            templates[i] = v;
            emit();
        },
        onChange: (fn) => {
            listeners.add(fn);
            fn([...templates]);
            return () => listeners.delete(fn);
        }
    };
})();
