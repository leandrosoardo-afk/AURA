import { Router } from 'express';
import { hoyArgentina } from '../acceso';
import { creditos, dolar, fondos, letras, plazoFijo, referencias } from '../mercado';
import { requerirSesion } from '../sesion';

export function rutasMercado(): Router {
  const router = Router();

  router.get('/mercado', requerirSesion, async (_req, res) => {
    const hoy = hoyArgentina();
    // Cada sección responde por su cuenta: si una fuente cae, las demás se siguen viendo.
    const [cotizaciones, tasas, personales, prendarios, hipotecarios, plazos, lecaps, fci] = await Promise.all([
      dolar(),
      referencias(),
      creditos('Personales', hoy),
      creditos('Prendarios', hoy),
      creditos('Hipotecarios', hoy),
      plazoFijo(),
      letras(hoy),
      fondos(hoy),
    ]);
    res.json({ dolar: cotizaciones, referencias: tasas, creditos: { personales, prendarios, hipotecarios }, plazoFijo: plazos, letras: lecaps, fondos: fci });
  });

  return router;
}
