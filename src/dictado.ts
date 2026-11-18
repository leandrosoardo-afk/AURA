// Dictado por voz con el reconocimiento del propio navegador (Web Speech API).
// Chrome y Edge mandan el audio a su servicio de reconocimiento; Safari lo hace en el dispositivo
// o con Apple. AURA no recibe ni guarda el audio: solo el texto que la persona termina enviando.

import { useCallback, useEffect, useRef, useState } from 'react';

interface ResultadoVoz {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}

interface EventoVoz {
  readonly resultIndex: number;
  readonly results: ArrayLike<ResultadoVoz>;
}

interface Reconocedor {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: EventoVoz) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type ConstructorReconocedor = new () => Reconocedor;

function constructorDelNavegador(): ConstructorReconocedor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: ConstructorReconocedor; webkitSpeechRecognition?: ConstructorReconocedor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORES: Record<string, string> = {
  'not-allowed': 'No diste permiso para usar el micrófono. Habilitalo en el candado de la barra de direcciones y probá de nuevo.',
  'service-not-allowed': 'El navegador no deja usar el reconocimiento de voz en esta página.',
  'no-speech': 'No te escuché. Tocá el micrófono y hablá cerca de la compu o del celular.',
  'audio-capture': 'No encontramos un micrófono. Revisá que esté conectado.',
  network: 'Para entender la voz hace falta conexión a internet. Revisá tu conexión.',
  'language-not-supported': 'Este navegador no reconoce español para dictar.',
};

/**
 * Escucha una frase y la va escribiendo. Cuando la persona deja de hablar, llama a alTerminar con el texto final.
 */
export function useDictado({ alEscuchar, alTerminar }: { alEscuchar: (texto: string) => void; alTerminar: (texto: string) => void }) {
  const [disponible] = useState(() => constructorDelNavegador() !== null);
  const [escuchando, setEscuchando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconocedor = useRef<Reconocedor | null>(null);
  const texto = useRef('');
  // Las funciones de afuera cambian en cada render: se guardan para usar siempre la última.
  const avisos = useRef({ alEscuchar, alTerminar });
  avisos.current = { alEscuchar, alTerminar };

  const detener = useCallback(() => reconocedor.current?.stop(), []);

  const empezar = useCallback(() => {
    const Constructor = constructorDelNavegador();
    if (!Constructor) {
      setError('Este navegador no permite dictar. Probá con Chrome, Edge o Safari, o escribí tu pregunta.');
      return;
    }
    reconocedor.current?.abort();
    const r = new Constructor();
    r.lang = 'es-AR';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    texto.current = '';
    r.onresult = (e) => {
      let final = '';
      let parcial = '';
      for (let i = 0; i < e.results.length; i++) {
        const frase = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += frase;
        else parcial += frase;
      }
      texto.current = (final + parcial).trim();
      avisos.current.alEscuchar(texto.current);
    };
    r.onerror = (e) => {
      // "aborted" es cuando la persona lo cancela: no es un error que haya que mostrar.
      if (e.error !== 'aborted') setError(ERRORES[e.error] ?? 'No pudimos entender el audio. Probá de nuevo o escribí tu pregunta.');
      texto.current = '';
    };
    r.onend = () => {
      setEscuchando(false);
      reconocedor.current = null;
      const dicho = texto.current.trim();
      if (dicho) avisos.current.alTerminar(dicho);
    };
    reconocedor.current = r;
    setError(null);
    setEscuchando(true);
    try {
      r.start();
    } catch {
      setEscuchando(false);
      setError('No pudimos abrir el micrófono. Probá de nuevo.');
    }
  }, []);

  // Al cerrar el chat se corta el micrófono.
  useEffect(() => () => reconocedor.current?.abort(), []);

  return { disponible, escuchando, error, empezar, detener, limpiarError: () => setError(null) };
}
