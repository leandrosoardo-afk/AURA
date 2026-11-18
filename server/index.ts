import { crearApp } from './app';
import { config } from './config';

// Express 5 también llama a esta función cuando no puede abrir el puerto.
crearApp().listen(config.port, config.host, (error?: Error) => {
  if (error) {
    console.error(`La API no pudo arrancar en el puerto ${config.port}: ${error.message}`);
    process.exit(1);
  }
  console.log(`API de AURA en http://localhost:${config.port}`);
});
