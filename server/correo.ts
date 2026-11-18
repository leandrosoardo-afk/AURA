// Envío de correos. Con SMTP configurado en .env manda el mail de verdad. Sin SMTP, en desarrollo
// lo muestra en la terminal del servidor para poder probar; en producción no lo envía y lo avisa.

import nodemailer from 'nodemailer';
import { config } from './config';

export interface Correo {
  para: string;
  asunto: string;
  texto: string;
  /** Versión con formato. Los programas de correo que no la muestran usan el texto. */
  html?: string;
}

const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** El mail de recupero con un botón, en los colores de AURA. */
export function correoDeRecupero(enlace: string): string {
  const url = escapar(enlace);
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f2f8f5;font-family:Arial,Helvetica,sans-serif;color:#0b2b2c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td style="font-size:22px;font-weight:bold;letter-spacing:3px;color:#0b3d3b">AURA</td></tr>
<tr><td style="padding-top:20px;font-size:18px;font-weight:bold">Cambiá tu contraseña</td></tr>
<tr><td style="padding-top:8px;font-size:15px;line-height:1.5">Pediste elegir una contraseña nueva. Tocá el botón para hacerlo:</td></tr>
<tr><td style="padding:24px 0"><a href="${url}" style="display:inline-block;background:#0c6b5b;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:12px">Elegir una contraseña nueva</a></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#52706c">El enlace sirve una sola vez y vence en 1 hora. Si no lo pediste, ignorá este mail: tu contraseña sigue igual.</td></tr>
<tr><td style="padding-top:16px;font-size:12px;line-height:1.5;color:#52706c;word-break:break-all">Si el botón no funciona, copiá este enlace en el navegador:<br>${url}</td></tr>
</table></td></tr></table></body></html>`;
}

export function correoConfigurado(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transporte() {
  const puerto = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: puerto,
    secure: puerto === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15_000,
  });
}

/** Comprueba que el servidor de correo acepte el usuario y la contraseña, sin mandar nada. */
export async function verificarCorreo(): Promise<void> {
  await transporte().verify();
}

export async function enviarCorreo({ para, asunto, texto, html }: Correo): Promise<void> {
  if (!correoConfigurado()) {
    if (config.produccion) {
      console.error('No hay SMTP configurado: no se pudo enviar un correo.');
    } else {
      console.log(`\n[Correo de prueba: falta configurar SMTP]\nPara: ${para}\nAsunto: ${asunto}\n\n${texto}\n`);
    }
    return;
  }
  await transporte().sendMail({ from: process.env.SMTP_FROM || `AURA <${process.env.SMTP_USER}>`, to: para, subject: asunto, text: texto, html });
}
