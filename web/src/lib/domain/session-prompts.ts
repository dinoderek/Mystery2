/**
 * What the session screen's "any key" prompts do. A key and a tap both call
 * these, so one gesture cannot run an action twice: a focused button's Enter
 * or Space reaches the window key handler and may click the button too.
 */

/** The part of the game store the prompts use. */
export interface PromptStore {
  status: string;
  enterStartingLocation(): Promise<void>;
  loadSessionCatalog(force?: boolean): Promise<void>;
  clearSessionForMysteryList(): void;
}

let leaving = false;

/** Step into the starting location. The store ignores a call while one is in flight. */
export async function beginInvestigation(store: PromptStore): Promise<void> {
  if (store.status === 'loading') return;
  await store.enterStartingLocation();
}

/** Leave a finished case for the mystery list, once however many gestures ask. */
export async function returnToMysteryList(
  store: PromptStore,
  navigate: (path: string) => Promise<unknown>,
): Promise<void> {
  if (leaving) return;
  leaving = true;
  try {
    try {
      await store.loadSessionCatalog(true);
    } finally {
      store.clearSessionForMysteryList();
      await navigate('/');
    }
  } finally {
    leaving = false;
  }
}
