// doubleTap.js
// 修飾キー2連打ショートカット（"Alt×2" / "Shift+Alt×2" など）の解析と検出ロジック。
// Electron の globalShortcut は修飾キー単独・2連打を扱えないため、
// グローバルキーフック（uiohook-napi）のイベントをこのモジュールで解釈する。

"use strict";

/** Suffix that marks the last accelerator part as a double tap (e.g. "Alt×2"). */
export const DOUBLE_TAP_SUFFIX = "×2";

/** Longest allowed delay between the two key-downs of a double tap, in milliseconds. */
export const DOUBLE_TAP_INTERVAL_MS = 400;

/** Canonical modifier names in Electron accelerator order. */
const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Super"];

/**
 * Determine whether an accelerator string uses the double-tap syntax.
 *
 * @param {string} accel - Accelerator such as "Alt×2" or "Ctrl+E".
 * @returns {boolean} `true` when the accelerator is a double-tap binding.
 */
export function isDoubleTapAccelerator(accel) {
    return typeof accel === "string" && accel.endsWith(DOUBLE_TAP_SUFFIX);
}

/**
 * Parse a double-tap accelerator such as "Alt×2" or "Shift+Alt×2".
 * The tapped key and every held modifier must be a modifier key, and the
 * tapped key may not be repeated in the held-modifier list.
 *
 * @param {string} accel - Accelerator string to parse.
 * @returns {{tapKey: string, mods: string[]}|null} Parsed parts, or null when invalid.
 */
export function parseDoubleTapAccelerator(accel) {
    if (!isDoubleTapAccelerator(accel)) return null;
    const parts = accel.split("+");
    const tapKey = parts.pop().slice(0, -DOUBLE_TAP_SUFFIX.length);
    if (!MODIFIER_ORDER.includes(tapKey)) return null;
    const seen = new Set();
    for (const mod of parts) {
        if (!MODIFIER_ORDER.includes(mod) || mod === tapKey || seen.has(mod)) return null;
        seen.add(mod);
    }
    const mods = MODIFIER_ORDER.filter((mod) => seen.has(mod));
    return { tapKey, mods };
}

/**
 * Create a stateful detector that turns raw global keyboard events into
 * double-tap shortcut activations.
 *
 * Feed every global keydown/keyup into `keydown()` / `keyup()` with the
 * canonical modifier name ("Ctrl" | "Alt" | "Shift" | "Super"), or `null`
 * for any non-modifier key, plus a timestamp in milliseconds. A binding
 * fires when its key is tapped twice in a row within `intervalMs`, with
 * exactly the bound modifiers held and no other key pressed in between.
 *
 * @param {{intervalMs?: number}} [options] - Optional detector options.
 * @returns {{setBindings: Function, keydown: Function, keyup: Function, reset: Function}}
 */
export function createDoubleTapDetector(options = {}) {
    const intervalMs = options.intervalMs ?? DOUBLE_TAP_INTERVAL_MS;
    let bindings = [];
    const held = new Set();
    let pending = null; // 押下中の修飾キー（タップ候補）
    let lastTap = null; // 直前に完了したクリーンなタップ

    const reset = () => {
        held.clear();
        pending = null;
        lastTap = null;
    };

    /**
     * Replace the active bindings.
     *
     * @param {Array<{tapKey: string, mods: string[], handler: Function}>} next - New bindings.
     * @returns {void}
     */
    const setBindings = (next) => {
        bindings = Array.isArray(next) ? next.filter((b) => b && b.tapKey) : [];
        reset();
    };

    /**
     * Process a global keydown event.
     *
     * @param {string|null} name - Canonical modifier name, or null for other keys.
     * @param {number} time - Event timestamp in milliseconds.
     * @returns {void}
     */
    const keydown = (name, time) => {
        if (!name) {
            // 修飾キー以外が押されたらタップ列は成立しない（Alt+Tab や通常入力を除外）
            if (pending) pending.invalidated = true;
            lastTap = null;
            return;
        }
        if (held.has(name)) return; // OS のオートリピートは無視
        held.add(name);
        const mods = MODIFIER_ORDER.filter((mod) => held.has(mod) && mod !== name);
        pending = { key: name, modsKey: mods.join("+"), downTime: time, invalidated: false };
    };

    /**
     * Process a global keyup event; fires a binding when a double tap completes.
     *
     * @param {string|null} name - Canonical modifier name, or null for other keys.
     * @param {number} time - Event timestamp in milliseconds.
     * @returns {void}
     */
    const keyup = (name, time) => {
        if (!name) return;
        held.delete(name);
        if (!pending || pending.key !== name) return;
        const tap = pending;
        pending = null;
        if (tap.invalidated) {
            lastTap = null;
            return;
        }
        const paired = lastTap
            && lastTap.key === tap.key
            && lastTap.modsKey === tap.modsKey
            && tap.downTime - lastTap.downTime <= intervalMs;
        if (paired) {
            lastTap = null;
            const binding = bindings.find(
                (b) => b.tapKey === tap.key && b.mods.join("+") === tap.modsKey);
            if (binding && typeof binding.handler === "function") binding.handler();
            return;
        }
        lastTap = tap;
    };

    return { setBindings, keydown, keyup, reset };
}
