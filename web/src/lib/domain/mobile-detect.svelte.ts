const MOBILE_QUERY = '(hover: none) and (pointer: coarse)';

class MobileDetectStore {
  isMobile = $state(false);

  init(): void {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia(MOBILE_QUERY);
    this.isMobile = mql.matches;
    mql.addEventListener('change', (e) => {
      this.isMobile = e.matches;
    });
  }
}

export const mobileDetect = new MobileDetectStore();
