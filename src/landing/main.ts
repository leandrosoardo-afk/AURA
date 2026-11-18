import './landing.css';
import { initLandingAnimations } from './animations';
import { initMicroInteractions } from './micro-interactions';

document.addEventListener('DOMContentLoaded', () => {
  // 1. Inicializar Microinteracciones
  initMicroInteractions();

  // 2. Inicializar Animaciones GSAP y ScrollTrigger
  initLandingAnimations();

  // 3. Posponer arranque de Three.js y cargar de forma dinámica/diferida (code-splitting)
  let particlesScene: any = null;
  const loadAndStartScene = async () => {
    const escenaEl = document.getElementById('escena');
    if (escenaEl && !particlesScene) {
      try {
        const { HeroParticlesScene } = await import('./hero-particles');
        const isMobile = window.innerWidth < 768;
        particlesScene = new HeroParticlesScene({
          container: escenaEl,
          particleCount: isMobile ? 1200 : 3500,
        });
      } catch (e) {
        console.warn('Error inicializando escena 3D diferida:', e);
      }
    }
  };

  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(loadAndStartScene, { timeout: 400 });
  } else {
    setTimeout(loadAndStartScene, 120);
  }

  // 4. Limpieza de memoria
  window.addEventListener('beforeunload', () => {
    if (particlesScene && typeof particlesScene.dispose === 'function') {
      particlesScene.dispose();
    }
  });
});
