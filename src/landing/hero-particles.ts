import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Points,
  BufferGeometry,
  BufferAttribute,
  ShaderMaterial,
  Vector3,
  CatmullRomCurve3,
  Color,
  Vector2,
  AdditiveBlending,
  Clock,
} from 'three';

export interface HeroParticlesOptions {
  container: HTMLElement;
  particleCount?: number;
}

export class HeroParticlesScene {
  private container: HTMLElement;
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private particles: Points | null = null;
  private geometry: BufferGeometry | null = null;
  private material: ShaderMaterial | null = null;

  private animationFrameId: number | null = null;
  private isVisible = true;
  private prefersReducedMotion = false;
  private intersectionObserver: IntersectionObserver | null = null;

  // Variables para interacción reutilizadas en bucle (zero GC allocations)
  private mouseX = 0;
  private mouseY = 0;
  private targetMouseX = 0;
  private targetMouseY = 0;
  private scrollProgress = 0;
  private clock = new Clock();

  // Atributos de partículas
  private particleCount: number;
  private basePositions: Float32Array;

  constructor(options: HeroParticlesOptions) {
    this.container = options.container;

    // Reducir partículas en celular para Lighthouse y 60 FPS
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    this.particleCount = options.particleCount ?? (isMobile ? 1200 : 3500);
    this.basePositions = new Float32Array(this.particleCount * 3);

    this.prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    this.init();
  }

  private init() {
    if (this.prefersReducedMotion) {
      this.renderFallback();
      return;
    }

    try {
      // 1. Configuración del Renderer
      this.renderer = new WebGLRenderer({
        antialias: false,
        alpha: true,
        powerPreference: 'high-performance',
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setSize(
        this.container.clientWidth,
        this.container.clientHeight
      );
      this.container.appendChild(this.renderer.domElement);

      // 2. Escena y Cámara
      this.scene = new Scene();
      const aspect =
        this.container.clientWidth / (this.container.clientHeight || 1);
      this.camera = new PerspectiveCamera(45, aspect, 0.1, 100);
      this.camera.position.set(0, 0, 18);

      // 3. Generación de la Curva de Caja de 30 Días
      this.buildParticleCurve();

      // 4. Listeners y Observadores
      this.setupEvents();

      // 5. Iniciar bucle
      this.startLoop();
    } catch (e) {
      console.warn('WebGL no disponible, utilizando fallback SVG:', e);
      this.renderFallback();
    }
  }

  private buildParticleCurve() {
    this.geometry = new BufferGeometry();
    const positions = new Float32Array(this.particleCount * 3);
    const colors = new Float32Array(this.particleCount * 3);
    const sizes = new Float32Array(this.particleCount);

    // Paleta de colores en Three.js
    const colorCyan = new Color('#7cf5c9');
    const colorViolet = new Color('#c4f76a');
    const colorAmber = new Color('#fbbf24');

    // 30 Días de proyección con bache profundo en día 5
    const dias = 30;
    const curvePoints: Vector3[] = [];
    for (let d = 0; d <= dias; d++) {
      const x = ((d - 15) / 15) * 11; // Rango [-11, 11]
      let y = 0;

      if (d === 0) y = 0.5;
      else if (d <= 3) y = 1.0 - d * 0.2;
      else if (d === 5) y = -3.2; // ¡Día 5: Tu peor día (bache de liquidez)!
      else if (d <= 10) y = -3.2 + (d - 5) * 0.45;
      else if (d <= 20) y = -1.0 + (d - 10) * 0.2;
      else y = 1.0 + Math.sin(d * 0.4) * 0.3; // Recuperación

      curvePoints.push(new Vector3(x, y, 0));
    }

    const spline = new CatmullRomCurve3(curvePoints);

    for (let i = 0; i < this.particleCount; i++) {
      const t = i / this.particleCount;
      const point = spline.getPoint(t);

      // Dispersión suave alrededor de la curva principal
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.pow(Math.random(), 2.2) * 1.8;
      const px = point.x + Math.cos(angle) * radius * 0.7;
      const py = point.y + Math.sin(angle) * radius * 0.9;
      const pz = (Math.random() - 0.5) * 3.5;

      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;

      this.basePositions[i * 3] = px;
      this.basePositions[i * 3 + 1] = py;
      this.basePositions[i * 3 + 2] = pz;

      // Coloración: Ámbar cerca del día 5 (t ~ 0.16), cian y violeta en el resto
      let pColor = colorCyan;
      if (Math.abs(t - 0.166) < 0.08) {
        pColor = colorAmber;
        sizes[i] = Math.random() * 6.0 + 3.0;
      } else {
        pColor =
          t > 0.5 ? colorViolet.clone().lerp(colorCyan, (t - 0.5) * 2) : colorCyan;
        sizes[i] = Math.random() * 4.0 + 1.5;
      }

      colors[i * 3] = pColor.r;
      colors[i * 3 + 1] = pColor.g;
      colors[i * 3 + 2] = pColor.b;
    }

    this.geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.geometry.setAttribute('color', new BufferAttribute(colors, 3));
    this.geometry.setAttribute('size', new BufferAttribute(sizes, 1));

    // Custom ShaderMaterial ligero para máximo rendimiento
    this.material = new ShaderMaterial({
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        uniform float uTime;
        uniform float uScroll;
        uniform vec2 uMouse;

        void main() {
          vColor = color;
          vec3 pos = position;

          // Parallax y oscilación sutil
          pos.x += sin(uTime * 0.8 + position.y) * 0.1;
          pos.y += cos(uTime * 0.6 + position.x) * 0.1;

          // Repulsión sutil con el cursor
          vec2 mouseDist = pos.xy - uMouse * 8.0;
          float d = length(mouseDist);
          if (d < 3.5) {
            float force = (3.5 - d) / 3.5;
            pos.xy += (mouseDist / (d + 0.001)) * force * 0.6;
          }

          // Efecto de ordenamiento al scrollear
          pos.z *= (1.0 - uScroll * 0.7);

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = size * (18.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float alpha = smoothstep(0.5, 0.05, dist);
          gl_FragColor = vec4(vColor, alpha * 0.85);
        }
      `,
      uniforms: {
        uTime: { value: 0 },
        uScroll: { value: 0 },
        uMouse: { value: new Vector2(0, 0) },
      },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
    });

    this.particles = new Points(this.geometry, this.material);
    this.scene!.add(this.particles);
  }

  private setupEvents() {
    // 1. Mouse Move / Parallax
    window.addEventListener(
      'mousemove',
      (e) => {
        this.targetMouseX = (e.clientX / window.innerWidth) * 2 - 1;
        this.targetMouseY = -(e.clientY / window.innerHeight) * 2 + 1;
      },
      { passive: true }
    );

    // 2. Scroll Reaction
    window.addEventListener(
      'scroll',
      () => {
        const scrollMax = window.innerHeight;
        this.scrollProgress = Math.min(window.scrollY / scrollMax, 1);
      },
      { passive: true }
    );

    // 3. Resize Handling
    window.addEventListener('resize', () => {
      if (!this.renderer || !this.camera) return;
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      this.camera.aspect = width / (height || 1);
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    });

    // 4. Pausa en tab oculta
    document.addEventListener('visibilitychange', () => {
      this.isVisible = !document.hidden;
      if (this.isVisible) {
        this.startLoop();
      } else {
        this.stopLoop();
      }
    });

    // 5. IntersectionObserver para pausar fuera de pantalla
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          this.isVisible = entry.isIntersecting;
          if (this.isVisible) {
            this.startLoop();
          } else {
            this.stopLoop();
          }
        });
      },
      { threshold: 0.05 }
    );
    this.intersectionObserver.observe(this.container);
  }

  private startLoop() {
    if (this.animationFrameId === null && this.isVisible) {
      this.animate();
    }
  }

  private stopLoop() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private animate = () => {
    if (!this.isVisible || !this.renderer || !this.scene || !this.camera) {
      this.animationFrameId = null;
      return;
    }

    // Suavizado de cursor
    this.mouseX += (this.targetMouseX - this.mouseX) * 0.06;
    this.mouseY += (this.targetMouseY - this.mouseY) * 0.06;

    const elapsedTime = this.clock.getElapsedTime();

    if (this.material) {
      this.material.uniforms.uTime.value = elapsedTime;
      this.material.uniforms.uScroll.value = this.scrollProgress;
      this.material.uniforms.uMouse.value.set(this.mouseX, this.mouseY);
    }

    if (this.particles) {
      this.particles.rotation.y = this.mouseX * 0.15;
      this.particles.rotation.x = -this.mouseY * 0.12;
    }

    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(this.animate);
  };

  private renderFallback() {
    this.container.innerHTML = `
      <svg viewBox="0 0 1000 350" preserveAspectRatio="none" style="width:100%;height:100%;opacity:0.35;">
        <defs>
          <linearGradient id="curveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#7cf5c9" />
            <stop offset="16%" stop-color="#fbbf24" />
            <stop offset="70%" stop-color="#c4f76a" />
            <stop offset="100%" stop-color="#7cf5c9" />
          </linearGradient>
        </defs>
        <path d="M 0 120 Q 150 100, 300 240 T 550 140 T 800 90 T 1000 80" fill="none" stroke="url(#curveGrad)" stroke-width="4" />
      </svg>
    `;
  }

  public dispose() {
    this.stopLoop();
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }
    if (this.geometry) {
      this.geometry.dispose();
    }
    if (this.material) {
      this.material.dispose();
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }
}
