import { jest } from '@jest/globals';
import {
    DOUBLE_TAP_INTERVAL_MS,
    isDoubleTapAccelerator,
    parseDoubleTapAccelerator,
    createDoubleTapDetector,
} from '../doubleTap.js';

describe('double-tap accelerator parsing', () => {
    test('detects the double-tap syntax', () => {
        expect(isDoubleTapAccelerator('Alt×2')).toBe(true);
        expect(isDoubleTapAccelerator('Shift+Alt×2')).toBe(true);
        expect(isDoubleTapAccelerator('Ctrl+E')).toBe(false);
        expect(isDoubleTapAccelerator('')).toBe(false);
        expect(isDoubleTapAccelerator(undefined)).toBe(false);
    });

    test('parses a plain double tap', () => {
        expect(parseDoubleTapAccelerator('Alt×2')).toEqual({ tapKey: 'Alt', mods: [] });
        expect(parseDoubleTapAccelerator('Ctrl×2')).toEqual({ tapKey: 'Ctrl', mods: [] });
    });

    test('parses held modifiers in canonical order', () => {
        expect(parseDoubleTapAccelerator('Shift+Alt×2')).toEqual({ tapKey: 'Alt', mods: ['Shift'] });
        expect(parseDoubleTapAccelerator('Shift+Ctrl+Alt×2'))
            .toEqual({ tapKey: 'Alt', mods: ['Ctrl', 'Shift'] });
    });

    test('rejects invalid double-tap accelerators', () => {
        expect(parseDoubleTapAccelerator('E×2')).toBeNull();
        expect(parseDoubleTapAccelerator('Alt+Alt×2')).toBeNull();
        expect(parseDoubleTapAccelerator('X+Alt×2')).toBeNull();
        expect(parseDoubleTapAccelerator('Shift+Shift+Alt×2')).toBeNull();
        expect(parseDoubleTapAccelerator('Ctrl+E')).toBeNull();
    });
});

describe('double-tap detector', () => {
    const bind = (detector, accel) => {
        const handler = jest.fn();
        const parsed = parseDoubleTapAccelerator(accel);
        detector.setBindings([{ ...parsed, handler }]);
        return handler;
    };

    test('fires on a quick double tap of the bound modifier', () => {
        const detector = createDoubleTapDetector();
        const handler = bind(detector, 'Alt×2');

        detector.keydown('Alt', 0);
        detector.keyup('Alt', 50);
        detector.keydown('Alt', 200);
        detector.keyup('Alt', 250);

        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('does not fire on a single tap or a slow second tap', () => {
        const detector = createDoubleTapDetector();
        const handler = bind(detector, 'Alt×2');

        detector.keydown('Alt', 0);
        detector.keyup('Alt', 50);
        expect(handler).not.toHaveBeenCalled();

        detector.keydown('Alt', DOUBLE_TAP_INTERVAL_MS + 100);
        detector.keyup('Alt', DOUBLE_TAP_INTERVAL_MS + 150);
        expect(handler).not.toHaveBeenCalled();
    });

    test('fires with a held modifier (Shift+Alt×2)', () => {
        const detector = createDoubleTapDetector();
        const handler = bind(detector, 'Shift+Alt×2');

        detector.keydown('Shift', 0);
        detector.keydown('Alt', 100);
        detector.keyup('Alt', 150);
        detector.keydown('Alt', 300);
        detector.keyup('Alt', 350);
        detector.keyup('Shift', 400);

        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('held modifiers must match the binding exactly', () => {
        const detector = createDoubleTapDetector();
        const handler = bind(detector, 'Alt×2');

        // Shift を押しながらの Alt 2連打は "Shift+Alt×2" であり "Alt×2" ではない
        detector.keydown('Shift', 0);
        detector.keydown('Alt', 100);
        detector.keyup('Alt', 150);
        detector.keydown('Alt', 300);
        detector.keyup('Alt', 350);
        detector.keyup('Shift', 400);

        expect(handler).not.toHaveBeenCalled();
    });

    test('a non-modifier key press breaks the sequence (Alt+Tab)', () => {
        const detector = createDoubleTapDetector();
        const handler = bind(detector, 'Alt×2');

        detector.keydown('Alt', 0);
        detector.keydown(null, 50); // Tab など
        detector.keyup(null, 80);
        detector.keyup('Alt', 100);
        detector.keydown('Alt', 200);
        detector.keyup('Alt', 250);

        expect(handler).not.toHaveBeenCalled();
    });

    test('a non-modifier key between two taps breaks the sequence', () => {
        const detector = createDoubleTapDetector();
        const handler = bind(detector, 'Alt×2');

        detector.keydown('Alt', 0);
        detector.keyup('Alt', 50);
        detector.keydown(null, 100);
        detector.keyup(null, 120);
        detector.keydown('Alt', 200);
        detector.keyup('Alt', 250);

        expect(handler).not.toHaveBeenCalled();
    });

    test('an intervening different modifier tap breaks the pair', () => {
        const detector = createDoubleTapDetector();
        const handler = bind(detector, 'Alt×2');

        detector.keydown('Alt', 0);
        detector.keyup('Alt', 50);
        detector.keydown('Ctrl', 100);
        detector.keyup('Ctrl', 150);
        detector.keydown('Alt', 200);
        detector.keyup('Alt', 250);

        expect(handler).not.toHaveBeenCalled();
    });

    test('OS auto-repeat keydowns while holding do not count as taps', () => {
        const detector = createDoubleTapDetector();
        const handler = bind(detector, 'Alt×2');

        detector.keydown('Alt', 0);
        detector.keydown('Alt', 100); // オートリピート
        detector.keydown('Alt', 200);
        detector.keyup('Alt', 300);

        expect(handler).not.toHaveBeenCalled();
    });

    test('fires repeatedly for consecutive double taps', () => {
        const detector = createDoubleTapDetector();
        const handler = bind(detector, 'Alt×2');

        for (let i = 0; i < 2; i++) {
            const base = i * 1000;
            detector.keydown('Alt', base);
            detector.keyup('Alt', base + 50);
            detector.keydown('Alt', base + 200);
            detector.keyup('Alt', base + 250);
        }

        expect(handler).toHaveBeenCalledTimes(2);
    });

    test('dispatches to the binding that matches the held modifiers', () => {
        const detector = createDoubleTapDetector();
        const plain = jest.fn();
        const withShift = jest.fn();
        detector.setBindings([
            { ...parseDoubleTapAccelerator('Alt×2'), handler: plain },
            { ...parseDoubleTapAccelerator('Shift+Alt×2'), handler: withShift },
        ]);

        detector.keydown('Shift', 0);
        detector.keydown('Alt', 100);
        detector.keyup('Alt', 150);
        detector.keydown('Alt', 300);
        detector.keyup('Alt', 350);
        detector.keyup('Shift', 400);

        expect(withShift).toHaveBeenCalledTimes(1);
        expect(plain).not.toHaveBeenCalled();
    });
});
