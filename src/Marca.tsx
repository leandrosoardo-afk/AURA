export function Marca() {
  return (
    <a className="marca marca--animada" href="/landing" aria-label="AURA">
      {/* El mismo logo animado del menú de la app, en loop. */}
      <video className="marca__video" autoPlay loop muted playsInline poster="/logo-aura-completo.png" width={220} height={100} aria-hidden="true">
        <source src="/logo-aura-animado.webm" type="video/webm" />
        <source src="/logo-aura-animado.mp4" type="video/mp4" />
      </video>
    </a>
  );
}
