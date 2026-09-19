import { editorRoot } from './common.ts';
import { directorColorSwatches } from './color-palette.ts';
import './native-controls.css';

type Control = HTMLSelectElement | HTMLInputElement;
type Dressed = { widget: HTMLElement; stop: () => void };

const dressed = new WeakMap<Control, Dressed>();
let menuSequence = 0;

function readValue(element: Control) {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    return String(Object.getOwnPropertyDescriptor(prototype, 'value')!.get!.call(element));
}

function bindProperty(element: Control, key: 'value' | 'disabled' | 'selectedIndex', refresh: () => void) {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const source = key === 'selectedIndex' ? HTMLSelectElement.prototype : prototype;
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor?.get || !descriptor.set) return;
    Object.defineProperty(element, key, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: () => descriptor.get!.call(element),
        set: (next) => { descriptor.set!.call(element, next); refresh(); return true; },
    });
}

function hideNative(element: Control) {
    element.classList.add('director-native-control');
    element.tabIndex = -1;
    element.setAttribute('aria-hidden', 'true');
    element.dataset.directorDressed = '1';
}

function controlName(element: Control) {
    return element.getAttribute('aria-label')
        || element.parentElement?.querySelector(':scope > span')?.textContent?.trim()
        || '选项';
}

function layerOpen(layer: HTMLElement) {
    if (layer.classList.contains('is-open')) return true;
    try { return layer.matches(':popover-open'); } catch { return false; }
}

function setLayer(layer: HTMLElement, open: boolean) {
    if (typeof layer.showPopover === 'function') {
        try {
            const visible = layerOpen(layer);
            if (open && !visible) layer.showPopover();
            if (!open && visible) layer.hidePopover();
            return;
        } catch { /* Keep the manual fallback for environments without the popover API. */ }
    }
    layer.hidden = !open;
    layer.classList.toggle('is-open', open);
}

function place(trigger: HTMLElement, layer: HTMLElement) {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(320, Math.max(rect.width, layer.classList.contains('director-color-popover') ? 248 : 180));
    layer.style.width = `${width}px`;
    layer.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    const below = rect.bottom + 4;
    layer.style.top = `${below}px`;
    const height = layer.offsetHeight || 240;
    if (below + height > window.innerHeight - 8) layer.style.top = `${Math.max(8, rect.top - height - 4)}px`;
}

function selectedText(select: HTMLSelectElement) {
    return select.selectedOptions[0]?.label || select.selectedOptions[0]?.textContent || '未选择';
}

function dressSelect(select: HTMLSelectElement) {
    hideNative(select);
    const widget = document.createElement('span');
    widget.className = 'director-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'director-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', controlName(select));
    const label = document.createElement('span');
    label.className = 'director-select-label';
    trigger.append(label);
    const menu = document.createElement('div');
    menu.className = 'director-select-menu';
    menu.setAttribute('popover', 'auto');
    menu.setAttribute('role', 'listbox');
    menu.id = select.id ? `${select.id}-menu` : `director-select-menu-${menuSequence += 1}`;
    trigger.setAttribute('aria-controls', menu.id);
    widget.append(trigger, menu);
    select.after(widget);

    const refresh = () => {
        label.textContent = selectedText(select);
        trigger.disabled = select.disabled;
        widget.hidden = select.hidden;
        menu.replaceChildren();
        if (!select.options.length) {
            const empty = document.createElement('p');
            empty.className = 'director-select-empty';
            empty.textContent = '没有可选项';
            menu.append(empty);
            return;
        }
        for (const option of select.options) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'director-select-option';
            item.setAttribute('role', 'option');
            item.textContent = option.label || option.textContent || option.value;
            item.disabled = option.disabled;
            item.setAttribute('aria-selected', option.selected ? 'true' : 'false');
            item.addEventListener('click', () => {
                if (option.disabled) return;
                if (select.value !== option.value) {
                    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, option.value);
                    refresh();
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }
                setLayer(menu, false);
                trigger.setAttribute('aria-expanded', 'false');
                trigger.focus();
            });
            menu.append(item);
        }
    };
    bindProperty(select, 'value', refresh);
    bindProperty(select, 'disabled', refresh);
    bindProperty(select, 'selectedIndex', refresh);
    const options = new MutationObserver(refresh);
    options.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'label'] });
    trigger.addEventListener('click', () => {
        if (select.disabled) return;
        const open = layerOpen(menu);
        setLayer(menu, !open);
        if (!open) place(trigger, menu);
        trigger.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
    trigger.addEventListener('keydown', event => {
        if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        setLayer(menu, true);
        place(trigger, menu);
        trigger.setAttribute('aria-expanded', 'true');
        menu.querySelector<HTMLButtonElement>('[aria-selected="true"], button')?.focus();
    });
    menu.addEventListener('keydown', event => {
        const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === 'Escape') { setLayer(menu, false); trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); }
        if (event.key === 'ArrowDown') items[Math.min(items.length - 1, index + 1)]?.focus();
        if (event.key === 'ArrowUp') items[Math.max(0, index - 1)]?.focus();
        if (event.key === 'Home') items[0]?.focus();
        if (event.key === 'End') items.at(-1)?.focus();
    });
    refresh();
    dressed.set(select, { widget, stop: () => options.disconnect() });
}

function dressMultiple(select: HTMLSelectElement) {
    hideNative(select);
    const list = document.createElement('div');
    list.className = 'director-multi';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', controlName(select));
    select.after(list);
    const refresh = () => {
        list.hidden = select.hidden;
        list.replaceChildren();
        for (const option of select.options) {
            const row = document.createElement('label');
            row.className = 'director-multi-option';
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = option.selected;
            box.disabled = select.disabled || option.disabled;
            box.addEventListener('click', event => event.stopPropagation());
            box.addEventListener('change', () => {
                option.selected = box.checked;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            });
            row.append(box, document.createTextNode(option.label || option.textContent || option.value));
            list.append(row);
        }
    };
    bindProperty(select, 'value', refresh);
    bindProperty(select, 'disabled', refresh);
    const options = new MutationObserver(refresh);
    options.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
    refresh();
    dressed.set(select, { widget: list, stop: () => options.disconnect() });
}

function normalizedHex(value: string) {
    const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
    return match ? `#${match[1].toLowerCase()}` : '';
}

function dressColor(input: HTMLInputElement) {
    hideNative(input);
    const widget = document.createElement('span');
    widget.className = 'director-color';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'director-color-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', controlName(input));
    const chip = document.createElement('i');
    chip.className = 'director-color-swatch';
    chip.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    trigger.append(chip, text);
    const popover = document.createElement('div');
    popover.className = 'director-color-popover';
    popover.setAttribute('popover', 'auto');
    const swatches = document.createElement('div');
    swatches.className = 'director-color-swatches';
    swatches.setAttribute('role', 'group');
    swatches.setAttribute('aria-label', '常用色板');
    const hexLabel = document.createElement('label');
    hexLabel.className = 'director-color-hex';
    hexLabel.append(document.createTextNode('HEX 色值'));
    const hex = document.createElement('input');
    hex.type = 'text';
    hex.maxLength = 7;
    hex.spellcheck = false;
    hex.setAttribute('aria-label', 'HEX 色值');
    hexLabel.append(hex);
    popover.append(swatches, hexLabel);
    widget.append(trigger, popover);
    input.after(widget);

    const commit = (value: string) => {
        const next = normalizedHex(value);
        if (!next || next === readValue(input)) return;
        input.value = next;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const refresh = () => {
        const current = normalizedHex(readValue(input)) || '#000000';
        chip.style.setProperty('--swatch', current);
        text.textContent = current.toUpperCase();
        trigger.disabled = input.disabled;
        widget.hidden = input.hidden;
        if (document.activeElement !== hex) hex.value = current;
        for (const button of swatches.querySelectorAll<HTMLButtonElement>('button'))
            button.setAttribute('aria-pressed', button.dataset.swatch === current ? 'true' : 'false');
    };
    for (const [name, value] of directorColorSwatches) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.swatch = value;
        button.style.setProperty('--swatch', value);
        button.title = name;
        button.setAttribute('aria-label', `${name} ${value}`);
        button.addEventListener('click', () => commit(value));
        swatches.append(button);
    }
    bindProperty(input, 'value', refresh);
    bindProperty(input, 'disabled', refresh);
    const options = new MutationObserver(refresh);
    options.observe(input, { attributes: true, attributeFilter: ['hidden', 'disabled'] });
    trigger.addEventListener('click', () => {
        if (input.disabled) return;
        const open = layerOpen(popover);
        setLayer(popover, !open);
        if (!open) place(trigger, popover);
        trigger.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
    hex.addEventListener('change', () => commit(hex.value));
    hex.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); commit(hex.value); } });
    refresh();
    dressed.set(input, { widget, stop: () => options.disconnect() });
}

function isColor(element: Element): element is HTMLInputElement {
    return element instanceof HTMLInputElement && element.type === 'color';
}

function follow(element: Control) {
    const widget = dressed.get(element)?.widget;
    if (widget && element.isConnected) element.after(widget);
}

function forget(element: Control) {
    const current = dressed.get(element);
    if (!current) return;
    current.stop();
    current.widget.remove();
    dressed.delete(element);
}

function dress(element: Control) {
    if (element.dataset.directorDressed === '1') { follow(element); return; }
    if (element instanceof HTMLSelectElement) (element.multiple ? dressMultiple : dressSelect)(element);
    else dressColor(element);
}

function scan(node: Node) {
    const found: Control[] = [];
    if (node instanceof HTMLSelectElement || isColor(node)) found.push(node);
    if (node instanceof HTMLElement) node.querySelectorAll('select, input[type="color"]').forEach(item => {
        if (item instanceof HTMLSelectElement || isColor(item)) found.push(item);
    });
    for (const element of found) {
        if (!element.isConnected) forget(element);
        else dress(element);
    }
}

/** Dress native selects and color inputs without changing their value or change contract. */
export function mountNativeControls(root: ParentNode = editorRoot()) {
    scan(root);
    const observer = new MutationObserver(records => {
        for (const record of records) {
            for (const node of record.removedNodes) {
                if (!(node instanceof HTMLElement)) continue;
                if ((node instanceof HTMLSelectElement || isColor(node)) && !node.isConnected) forget(node);
                node.querySelectorAll('select, input[type="color"]').forEach(item => {
                    if ((item instanceof HTMLSelectElement || isColor(item)) && !item.isConnected) forget(item);
                });
            }
            for (const node of record.addedNodes) scan(node);
        }
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
        observer.disconnect();
        if (root instanceof HTMLElement) root.querySelectorAll('select, input[type="color"]').forEach(item => {
            if (item instanceof HTMLSelectElement || isColor(item)) forget(item);
        });
    };
}
