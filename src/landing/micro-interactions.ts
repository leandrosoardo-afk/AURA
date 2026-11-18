export interface MicroAnimationConfig {
  container: HTMLElement;
  type: 'mic' | 'loader' | 'check';
  lottieSrc?: string;
}

export function initMicroInteractions() {
  const elements = document.querySelectorAll<HTMLElement>('.micro');

  elements.forEach(async (el) => {
    const type = el.dataset.micro as 'mic' | 'loader' | 'check';
    const lottieSrc = el.dataset.lottie;

    if (lottieSrc) {
      // Dynamic import of lottie_light only if lottieSrc is provided
      try {
        const { default: lottie } = await import(
          'lottie-web/build/player/lottie_light'
        );
        lottie.loadAnimation({
          container: el,
          renderer: 'svg',
          loop: type !== 'check',
          autoplay: true,
          path: lottieSrc,
        });
      } catch (err) {
        console.warn('No se pudo cargar la animación Lottie:', err);
      }
      return;
    }

    // Animación SVG reactiva de alta fidelidad
    if (type === 'mic') {
      el.innerHTML = `
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M19 10a7 7 0 0 1-14 0M12 17v5" />
        </svg>
      `;
    } else if (type === 'loader') {
      el.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" class="spin-anim" style="animation: spin 1s linear infinite;">
          <circle cx="12" cy="12" r="9" stroke-opacity="0.25" />
          <path d="M12 3a9 9 0 0 1 9 9" />
        </svg>
      `;
    } else if (type === 'check') {
      el.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      `;
    }
  });
}
