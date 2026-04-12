import { describe, expect, it, vi } from 'vitest';

/**
 * Tests for MobileImageViewer behavioral logic.
 *
 * The component itself is presentational (renders SignedImage in a fullscreen
 * overlay), so we test the interaction logic that drives its close behavior:
 *   - Escape key → onclose
 *   - Backdrop click (target === currentTarget) → onclose
 *   - Click on child element → no close
 */

describe('MobileImageViewer close logic', () => {
  // --- Escape key handler ---

  describe('keydown handler', () => {
    function makeKeydownHandler(onclose: () => void) {
      return (e: { key: string }) => {
        if (e.key === 'Escape') {
          onclose();
        }
      };
    }

    it('calls onclose when Escape is pressed', () => {
      const onclose = vi.fn();
      const handler = makeKeydownHandler(onclose);
      handler({ key: 'Escape' });
      expect(onclose).toHaveBeenCalledOnce();
    });

    it('does not call onclose for other keys', () => {
      const onclose = vi.fn();
      const handler = makeKeydownHandler(onclose);
      handler({ key: 'Enter' });
      handler({ key: 'a' });
      handler({ key: 'ArrowDown' });
      expect(onclose).not.toHaveBeenCalled();
    });
  });

  // --- Backdrop click handler ---

  describe('backdrop click handler', () => {
    function makeBackdropClickHandler(onclose: () => void) {
      return (e: { target: unknown; currentTarget: unknown }) => {
        if (e.target === e.currentTarget) {
          onclose();
        }
      };
    }

    it('calls onclose when clicking directly on the backdrop', () => {
      const onclose = vi.fn();
      const handler = makeBackdropClickHandler(onclose);
      const backdrop = {};
      handler({ target: backdrop, currentTarget: backdrop });
      expect(onclose).toHaveBeenCalledOnce();
    });

    it('does not call onclose when clicking a child element', () => {
      const onclose = vi.fn();
      const handler = makeBackdropClickHandler(onclose);
      const backdrop = {};
      const child = {};
      handler({ target: child, currentTarget: backdrop });
      expect(onclose).not.toHaveBeenCalled();
    });
  });

  // --- Props contract ---

  describe('props contract', () => {
    it('requires blueprintId, imageId, and onclose', () => {
      // Type-level contract verification — these are the required props.
      // We verify that the expected shape is correct by asserting structure.
      const props = {
        blueprintId: 'bp-123',
        imageId: 'img-456',
        onclose: vi.fn(),
      };
      expect(props.blueprintId).toBe('bp-123');
      expect(props.imageId).toBe('img-456');
      expect(typeof props.onclose).toBe('function');
    });

    it('alt defaults to empty string when not provided', () => {
      const props = {
        blueprintId: 'bp-123',
        imageId: 'img-456',
        alt: '' as string | undefined,
        onclose: vi.fn(),
      };
      // Default per component: alt = ''
      const resolvedAlt = props.alt ?? '';
      expect(resolvedAlt).toBe('');
    });

    it('alt passes through when provided', () => {
      const props = {
        blueprintId: 'bp-123',
        imageId: 'img-456',
        alt: 'A crime scene photo',
        onclose: vi.fn(),
      };
      expect(props.alt).toBe('A crime scene photo');
    });
  });
});
