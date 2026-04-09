// Mobile keyboard proxy store.
//
// Desktop keyboard flow relies on global `<svelte:window onkeydown>` listeners,
// but on iOS the software keyboard only appears when a focusable form element
// receives focus. `MobileKeyboardProxy` mounts a hidden <input> that keeps
// focus on mobile so key events reach the existing window handlers.
//
// Pages set `inputMode` in onMount/$effect to pick the iOS keyboard layout:
//   'numeric' — compact number pad (menus, session lists picking 1-9)
//   'text'    — full keyboard (game session end-state "press any key")
//   'none'    — don't render the proxy (default; desktop-only screens)

export type MobileInputMode = 'numeric' | 'text' | 'none';

class MobileKeyboardStore {
  inputMode = $state<MobileInputMode>('none');
}

export const mobileKeyboard = new MobileKeyboardStore();
