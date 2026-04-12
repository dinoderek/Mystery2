import { describe, expect, it, beforeEach, vi } from 'vitest';
import { MobileInputBarState } from './mobile-input-bar.svelte';

describe('MobileInputBarState', () => {
  let state: MobileInputBarState;

  beforeEach(() => {
    state = new MobileInputBarState();
  });

  // --- Initial state ---

  it('defaults value to empty string', () => {
    expect(state.value).toBe('');
  });

  it('defaults disabled to false', () => {
    expect(state.disabled).toBe(false);
  });

  it('canSend is false when value is empty', () => {
    expect(state.canSend).toBe(false);
  });

  // --- init with prefill ---

  it('init() sets value from prefill', () => {
    state.init('accuse ');
    expect(state.value).toBe('accuse ');
  });

  it('init() without prefill leaves value empty', () => {
    state.init();
    expect(state.value).toBe('');
  });

  it('init() with undefined prefill leaves value empty', () => {
    state.init(undefined);
    expect(state.value).toBe('');
  });

  it('init() with empty string prefill leaves value empty', () => {
    state.init('');
    expect(state.value).toBe('');
  });

  // --- canSend ---

  it('canSend is true when value has non-whitespace content', () => {
    state.value = 'hello';
    expect(state.canSend).toBe(true);
  });

  it('canSend is false when value is only whitespace', () => {
    state.value = '   ';
    expect(state.canSend).toBe(false);
  });

  it('canSend is false when disabled even with content', () => {
    state.value = 'hello';
    state.disabled = true;
    expect(state.canSend).toBe(false);
  });

  // --- send ---

  it('send() calls onsend with trimmed value and clears input', () => {
    const onsend = vi.fn();
    state.value = '  hello world  ';
    const result = state.send(onsend);
    expect(result).toBe(true);
    expect(onsend).toHaveBeenCalledWith('hello world');
    expect(state.value).toBe('');
  });

  it('send() returns false and does not call onsend when value is empty', () => {
    const onsend = vi.fn();
    state.value = '';
    const result = state.send(onsend);
    expect(result).toBe(false);
    expect(onsend).not.toHaveBeenCalled();
  });

  it('send() returns false and does not call onsend when value is whitespace', () => {
    const onsend = vi.fn();
    state.value = '   ';
    const result = state.send(onsend);
    expect(result).toBe(false);
    expect(onsend).not.toHaveBeenCalled();
  });

  it('send() returns false and does not call onsend when disabled', () => {
    const onsend = vi.fn();
    state.value = 'hello';
    state.disabled = true;
    const result = state.send(onsend);
    expect(result).toBe(false);
    expect(onsend).not.toHaveBeenCalled();
  });

  it('send() clears value after successful send', () => {
    const onsend = vi.fn();
    state.value = 'test message';
    state.send(onsend);
    expect(state.value).toBe('');
  });

  // --- handleKeydown ---

  function makeKeyEvent(key: string, shiftKey = false) {
    return { key, shiftKey, preventDefault: vi.fn() };
  }

  it('handleKeydown submits on Enter', () => {
    const onsend = vi.fn();
    state.value = 'hello';
    const event = makeKeyEvent('Enter');
    state.handleKeydown(event, onsend);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onsend).toHaveBeenCalledWith('hello');
    expect(state.value).toBe('');
  });

  it('handleKeydown does not submit on Shift+Enter', () => {
    const onsend = vi.fn();
    state.value = 'hello';
    const event = makeKeyEvent('Enter', true);
    state.handleKeydown(event, onsend);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onsend).not.toHaveBeenCalled();
  });

  it('handleKeydown ignores non-Enter keys', () => {
    const onsend = vi.fn();
    state.value = 'hello';
    const event = makeKeyEvent('a');
    state.handleKeydown(event, onsend);
    expect(onsend).not.toHaveBeenCalled();
  });

  it('handleKeydown does not submit when disabled', () => {
    const onsend = vi.fn();
    state.value = 'hello';
    state.disabled = true;
    const event = makeKeyEvent('Enter');
    state.handleKeydown(event, onsend);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onsend).not.toHaveBeenCalled();
    expect(state.value).toBe('hello');
  });

  it('handleKeydown does not submit when value is empty', () => {
    const onsend = vi.fn();
    state.value = '';
    const event = makeKeyEvent('Enter');
    state.handleKeydown(event, onsend);
    expect(onsend).not.toHaveBeenCalled();
  });
});
