import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom lacks browser APIs that Radix primitives and the router use for
// positioning, sizing and scrolling. Minimal stand-ins are enough: tests
// assert behaviour, not layout.

class ResizeObserverStub {
  observe(): void {
    // No layout in jsdom.
  }
  unobserve(): void {
    // No layout in jsdom.
  }
  disconnect(): void {
    // No layout in jsdom.
  }
}

// The DOM typings declare these as always present; jsdom does not provide them.
Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
Object.assign(Element.prototype, { hasPointerCapture: () => false, scrollIntoView: () => undefined });
window.scrollTo = () => undefined;
// No colour scheme in jsdom: the dark one, which never changes.
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;

// Without Vitest globals Testing Library cannot register its own clean-up.
afterEach(() => {
  cleanup();
});
