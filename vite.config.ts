import { defineConfig } from 'vite';

// En GitHub Pages (y en `vite preview`) el visor se sirve bajo /TallerGubimOct26/ (nombre del repositorio); en desarrollo, desde la raíz.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/TallerGubimOct26/' : '/',
  build: {
    target: 'esnext',
    outDir: 'dist',
    // web-ifc embebe el esquema IFC completo (~3 MB, ~370 KB gzip); se aísla en su propio chunk.
    chunkSizeWarningLimit: 3500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          'ifc-core': ['web-ifc'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
}));
