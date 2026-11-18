// Prueba el envío de mails: npm run correo:probar -- tu@mail.com
// Muestra si falta configurar algo, si el servidor rechaza el usuario o la contraseña, o si el mail salió.

import '../config';
import { correoConfigurado, correoDeRecupero, enviarCorreo, verificarCorreo } from '../correo';

const destino = process.argv[2];
if (!destino || !destino.includes('@')) {
  console.error('Escribí a qué mail mandar la prueba: npm run correo:probar -- tu@mail.com');
  process.exit(1);
}
if (!correoConfigurado()) {
  console.error('Falta configurar el correo en .env: completá SMTP_HOST, SMTP_USER y SMTP_PASS.');
  process.exit(1);
}
try {
  await verificarCorreo();
  console.log(`El servidor de correo (${process.env.SMTP_HOST}) aceptó el usuario y la contraseña.`);
  await enviarCorreo({
    para: destino,
    asunto: 'Prueba de AURA: el correo funciona',
    texto: 'Si te llegó este mail, AURA ya puede mandar los enlaces para recuperar la contraseña.',
    html: correoDeRecupero('https://ejemplo.invalid/restablecer#token=prueba').replace('Cambiá tu contraseña', 'Prueba: el correo funciona'),
  });
  console.log(`Listo: mandamos un mail de prueba a ${destino}. Revisá también la carpeta de spam.`);
} catch (error) {
  console.error(`No se pudo mandar: ${(error as Error).message}`);
  process.exit(1);
}
