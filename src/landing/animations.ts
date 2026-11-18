import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function initLandingAnimations() {
  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  if (prefersReducedMotion) {
    // Si prefiere movimiento reducido, mostrar todo estático
    document.querySelectorAll('.propuesta').forEach((el) => el.classList.add('visible'));
    const arco = document.getElementById('arco');
    const pct = document.getElementById('pct');
    if (arco) arco.style.strokeDashoffset = '293'; // 408 * (1 - 0.28)
    if (pct) pct.textContent = '28%';
    return;
  }

  // 1. HERO TIMELINE DE ENTRADA (≤ 1.2 s)
  const heroTl = gsap.timeline({ defaults: { ease: 'power3.out' } });

  heroTl
    .from('.hero__titulo', {
      /* opacity: 0 */
      y: 20,
      duration: 0.6,
    })
    .from(
      '.hero__bajada',
      {
        /* opacity: 0 */
        y: 16,
        duration: 0.5,
      },
      '-=0.3'
    )
    .from(
      '.hero__acciones .boton',
      {
        /* opacity: 0 */
        y: 16,
        duration: 0.4,
        stagger: 0.1,
      },
      '-=0.3'
    )
    .from(
      '.hero__peor',
      {
        /* opacity: 0 */
        scale: 0.8,
        duration: 0.5,
      },
      '-=0.2'
    );

  // 2. MOMENTO 1: "¿TE ALCANZA?" (Morphing de alerta a resuelto)
  const estadoEl = document.querySelector('.estado');
  const accionBtn = document.querySelector('.estado__accion');
  const montoPeor = document.getElementById('montoPeor');

  if (estadoEl && accionBtn) {
    accionBtn.addEventListener('click', () => {
      estadoEl.classList.toggle('resuelto');
      if (montoPeor) {
        montoPeor.textContent = estadoEl.classList.contains('resuelto')
          ? '$1.395.000'
          : '$615.000';
      }
    });

    ScrollTrigger.create({
      trigger: '#alcanza',
      start: 'top 70%',
      onEnter: () => {
        // Demostración automática guiada
        gsap.to(estadoEl, {
          y: 0,
          opacity: 1,
          duration: 0.6,
        });
      },
    });
  }

  // 3. MOMENTO 2: REGISTRO EN 10 SEGUNDOS (Voz y Propuesta)
  const dichoEl = document.getElementById('dicho');
  const pensandoEl = document.querySelector('.hoja__pensando') as HTMLElement;
  const propuestaEl = document.querySelector('.propuesta') as HTMLElement;
  const listoEl = document.querySelector('.hoja__listo') as HTMLElement;

  if (dichoEl) {
    const frase = 'pagué 80 mil de harina a Molinos';
    let charIndex = 0;

    ScrollTrigger.create({
      trigger: '#registro',
      start: 'top 65%',
      once: true,
      onEnter: () => {
        const typeInterval = setInterval(() => {
          if (charIndex < frase.length) {
            dichoEl.textContent = frase.slice(0, charIndex + 1);
            charIndex++;
          } else {
            clearInterval(typeInterval);
            if (pensandoEl) pensandoEl.style.opacity = '1';

            setTimeout(() => {
              if (pensandoEl) pensandoEl.style.opacity = '0';
              if (propuestaEl) propuestaEl.classList.add('visible');
              if (listoEl) listoEl.style.opacity = '1';
            }, 600);
          }
        }, 35);
      },
    });
  }

  // 4. MOMENTO 3: SIMULADOR Y MEDIDOR SEMICIRCULAR
  const arco = document.getElementById('arco');
  const pctEl = document.getElementById('pct');
  const totalLength = 408; // Longitud del arco SVG semicircular

  function setPorcentaje(targetPct: number) {
    const offset = totalLength * (1 - targetPct / 100);
    if (arco) {
      arco.style.strokeDashoffset = String(offset);
    }
    if (pctEl) {
      gsap.to(
        { val: parseInt(pctEl.textContent || '0', 10) || 0 },
        {
          val: targetPct,
          duration: 0.8,
          ease: 'power2.out',
          onUpdate: function () {
            pctEl.textContent = `${Math.round(this.targets()[0].val)}%`;
          },
        }
      );
    }
  }

  ScrollTrigger.create({
    trigger: '#simular',
    start: 'top 65%',
    once: true,
    onEnter: () => {
      setPorcentaje(28); // 28% seguro
    },
  });

  const opciones = document.querySelectorAll('.opciones li');
  const pctValores = [57, 35, 28];
  opciones.forEach((li, idx) => {
    li.addEventListener('click', () => {
      opciones.forEach((o) => o.classList.remove('activa'));
      li.classList.add('activa');
      setPorcentaje(pctValores[idx] || 28);
    });
  });

  // 5. PLANES DE PRECIOS CON STAGGER
  gsap.from('.plan', {
    scrollTrigger: {
      trigger: '#precios',
      start: 'top 75%',
    },
    y: 40,
    /* opacity: 0 */
    duration: 0.6,
    stagger: 0.15,
    ease: 'power3.out',
  });

  // 6. EFECTO IMÁN EN BOTONES (.iman)
  const imanes = document.querySelectorAll('.iman');
  imanes.forEach((btn) => {
    const el = btn as HTMLElement;
    el.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      gsap.to(el, {
        x: x * 0.25,
        y: y * 0.25,
        duration: 0.3,
        ease: 'power2.out',
      });
    });

    el.addEventListener('mouseleave', () => {
      gsap.to(el, {
        x: 0,
        y: 0,
        duration: 0.6,
        ease: 'elastic.out(1, 0.4)',
      });
    });
  });
}
