// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import Sheet from '../../../src/components/shared/Sheet';

// test/unit/shared/sheetLayer.test.ts
// The layer a dialog's container takes. On the Android app it takes one from its first paint: the panel
// drops its own layer when the entry animation ends, and on that frame the Android compositor can show the
// layer behind it (the wall's visualizer, a blurred render surface) once more, over the dialog. Everywhere
// else it must take none — a promoted layer loses LCD text, which is visible on the desktop and in the
// screenshot baselines. Both halves are pinned here because the second is easy to break by "just making it
// the same everywhere".

let root: Root | null = null;
let host: HTMLElement | null = null;

const render = async (element: React.ReactElement) => {
    if (!root) {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    }
    await act(async () => {
        root!.render(element);
    });
};

/** The platform the app runs on, as the shell of a Capacitor app reports it. */
const platform = (value: 'android' | 'web') => {
    (window as unknown as { Capacitor?: { getPlatform: () => string } }).Capacitor = value === 'android'
        ? { getPlatform: () => value }
        : undefined;
};

const sheet = () => React.createElement(Sheet, { isOpen: true, onClose: () => {}, title: 'Sheet', children: 'content' });
const overlay = () => document.querySelector<HTMLElement>('[data-folia-themed-overlay="true"]');

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    await act(async () => {
        root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
    platform('web');
    document.body.replaceChildren();
});

describe('the layer of a dialog', () => {
    it('is its own from the first paint on the Android app', async () => {
        platform('android');
        await render(sheet());
        expect(overlay()?.style.transform).toBe('translate3d(0, 0, 0)');
    });

    it('is not taken anywhere else, so that a dialog keeps its LCD text', async () => {
        platform('web');
        await render(sheet());
        expect(overlay()?.style.transform).toBe('');
    });
});
