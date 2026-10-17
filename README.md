<div align="center">

# VisorGuBIMGal

**Visor BIM de código abierto para Galicia**  
Frontend-only · Multi-IFC · GIS integrado · Exportación DXF

[![GitHub Pages](https://img.shields.io/badge/demo-GitHub%20Pages-blue?logo=github)](https://mavtarq.github.io/TallerGubimOct26/)
[![Licencia: MPL-2.0](https://img.shields.io/badge/Licencia-MPL--2.0-orange.svg)](LICENSE)
[![Estado](https://img.shields.io/badge/estado-en%20desarrollo-yellow)](https://github.com/MavtArq/TallerGubimOct26)

</div>

---

## ¿Qué es VisorGuBIMGal?

**VisorGuBIMGal** es un visor BIM open-source, 100% ejecutado en el navegador, sin necesidad de backend ni instalación. Permite abrir, explorar y documentar modelos IFC (Industry Foundation Classes) con contexto geográfico, y exportar secciones y plantas a formato DXF para su uso en herramientas CAD convencionales.

Está pensado para:
- **Administraciones públicas** gallegas (ayuntamientos, Xunta) que necesiten revisar entregables BIM sin licencias privativas.
- **Profesionales AEC** que quieran una herramienta ágil de revisión federada.
- **Ciudadanos** interesados en visualizar proyectos de obra pública en su contexto geográfico.

---

## Características principales

| Funcionalidad | Descripción |
|---|---|
| **Multi-IFC federado** | Carga simultánea de varios ficheros IFC (ARQ + EST + MEP) en una misma escena |
| **Renderizado WebGPU** | Visualización 3D de alto rendimiento con fallback a WebGL |
| **Navegación espacial** | Árbol de estructura espacial IFC (IfcSite → IfcBuilding → IfcStorey → Elementos) |
| **Propiedades** | Consulta de Property Sets, materiales y cantidades por elemento |
| **Secciones y plantas** | Generación interactiva de cortes horizontales y verticales con capas CAD |
| **Exportación DXF** | Export de secciones/plantas a DXF R12 con capas organizadas (by-class, by-storey...) |
| **Integración GIS** | Superposición del modelo BIM sobre mapa base (OSM, PNOA, Catastro, IDE Galicia) |
| **Geolocalización** | Lectura automática de `IfcMapConversion` + georreferenciación manual |
| **Modos de render** | Shaded, Wireframe, X-Ray, Hidden Line |
| **Frontend-only** | Los ficheros IFC nunca salen del navegador del usuario |
| **i18n** | Interfaz en Gallego, Castellano e Inglés |

---

## Demo en vivo

> 🚧 **En construcción** — Disponible tras la Fase 1 del roadmap.

```
https://mavtarq.github.io/TallerGubimOct26/
```

---

## Stack tecnológico

| Capa | Tecnología | Justificación |
|---|---|---|
| **Motor BIM** | [IFCLite](https://ifclite.dev) (`@ifc-lite/*`) | Rust/WASM, WebGPU nativo, export DXF integrado, MPL-2.0 |
| **Motor GIS** | [MapLibre GL JS](https://maplibre.org) | Ligero, Custom Layers, BSD-3-Clause |
| **Coordenadas** | [Proj4js](https://proj4js.org) | Transformación EPSG (soporte ETRS89/UTM para Galicia) |
| **Export DXF** | `@ifc-lite/drawing-2d` + [`dxf-writer`](https://www.npmjs.com/package/dxf-writer) | Nativo desde IFCLite; dxf-writer como fallback |
| **UI** | [LitElement](https://lit.dev) + Vanilla CSS | Web Components estándar, sin overhead de frameworks |
| **Bundler** | [Vite](https://vite.dev) + TypeScript | Code splitting, target `esnext` para WebGPU |
| **Tests** | Vitest + Playwright | Unitarios de servicios + E2E de flujos críticos |
| **Hosting** | GitHub Pages | Despliegue estático gratuito vía GitHub Actions |

---

## Arquitectura

El proyecto sigue una arquitectura de **4 capas** (SDD / Clean Architecture):

```
Presentación  →  Aplicación  →  Dominio  →  Infraestructura
  (UI Lit)       (CommandBus     (Services,    (IFCLite, MapLibre,
                  + Store)        Interfaces)    Proj4, Workers)
```

Consulta el documento de especificaciones completo: [`specs.md`](specs.md)

### Estado actual (visor preliminar)

La primera versión funcional usa **web-ifc + three.js (WebGL)**, las dependencias ya declaradas en `package.json`, en lugar de IFCLite. El motor IFC queda detrás del puerto `IIfcEngine` ([`src/domain/interfaces/IIfcEngine.ts`](src/domain/interfaces/IIfcEngine.ts)), así que migrar a IFCLite consiste en escribir un nuevo adaptador junto a [`WebIfcEngine.ts`](src/infrastructure/ifc/WebIfcEngine.ts).

Ya disponible:

- Carga de uno o varios IFC (botón o arrastrar y soltar) federados en la misma escena, con origen común para evitar el jitter en coordenadas UTM.
- Árbol de modelos (visibilidad, encuadre, cierre) y árbol de estructura espacial.
- Selección por clic en el 3D o en el árbol; panel de atributos, Psets, cantidades y materiales.
- Modos Sólido / Alámbrico / Rayos X y plano de sección horizontal.
- Modelo de ejemplo en `public/samples/ejemplo-basico.ifc` (botón «Ejemplo»).
- **Revisión con IDS** (pestaña «IDS»): carga de ficheros `.ids` de buildingSMART (IDS 1.0) y validación de todos los modelos cargados.
  - Facetas: `entity` (con `predefinedType`), `attribute`, `property` (con `dataType`, Psets y QuantitySets de instancia y tipo), `material`, `classification` y `partOf`.
  - Valores simples y `xs:restriction` (enumeración, patrón, rangos, longitudes); cardinalidad obligatoria, opcional o prohibida en especificaciones y requisitos; filtro por `ifcVersion`.
  - Resultado por especificación con los elementos que no cumplen y el motivo; clic para seleccionarlos y doble clic para encuadrarlos.
  - Coloreado verde/rojo en el 3D (de todas las especificaciones o de la desplegada) y exportación del informe a CSV.
  - Se revalida automáticamente al añadir o quitar modelos. IDS de ejemplo: `public/samples/ejemplo-basico.ids`.

Pendiente respecto a la spec: parsing en Web Worker (ahora bloquea la UI durante la carga de modelos grandes), Lit, i18n, GIS, dibujos 2D y DXF.

---

## Navegadores compatibles

| Navegador | Versión mínima | WebGPU | WebGL (fallback) |
|---|---|---|---|
| Chrome / Edge | 113+ | ✅ | ✅ |
| Firefox | 130+ | ✅ | ✅ |
| Safari | 18+ | ✅ | ✅ |
| Safari iOS | 18+ | ✅ | ✅ |

---

## Instalación y desarrollo

### Prerrequisitos

- [Node.js](https://nodejs.org) ≥ 22
- npm ≥ 10

### Pasos

```bash
# 1. Clonar el repositorio
git clone https://github.com/MavtArq/TallerGubimOct26.git
cd TallerGubimOct26

# 2. Instalar dependencias
npm install

# 3. Arrancar el servidor de desarrollo
npm run dev
```

El visor estará disponible en `http://localhost:5173`.

### Comandos disponibles

```bash
npm run dev          # Servidor de desarrollo con HMR
npm run build        # Build de producción en ./dist
npm run preview      # Preview del build de producción
npm run lint         # ESLint + Prettier check
npm run test:unit    # Tests unitarios con Vitest
npm run test:e2e     # Tests E2E con Playwright
npm run test         # Todos los tests
```

---

## Despliegue en GitHub Pages

El despliegue es automático en cada push a `main` mediante GitHub Actions (`.github/workflows/deploy.yml`).

Para configurarlo en tu fork:

1. Ve a **Settings → Pages** de tu repositorio.
2. En **Build and deployment**, selecciona **GitHub Actions** como source.
3. Ajusta el campo `base` en `vite.config.ts` con el nombre de tu repositorio.

---

## Roadmap

| Fase | Duración | Estado | Descripción |
|---|---|---|---|
| **Fase 1** — MVP Core | 8 semanas | 🔄 En desarrollo | Visor 3D multi-IFC, árbol espacial, propiedades |
| **Fase 2** — Dibujos 2D + DXF | 4 semanas | ⏳ Pendiente | Plantas, secciones, export DXF |
| **Fase 3** — Integración GIS | 4 semanas | ⏳ Pendiente | MapLibre, geolocalización, capas WMS/WFS |
| **Fase 4** — Pulido | 4 semanas | ⏳ Pendiente | Temas, BCF, mediciones, persistencia de sesión |

---

## Contribuir

Las contribuciones son bienvenidas. Por favor, consulta [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir un Pull Request.

1. Haz un fork del repositorio.
2. Crea una rama descriptiva: `git checkout -b feat/nombre-feature`.
3. Commits en español o inglés, siguiendo [Conventional Commits](https://www.conventionalcommits.org/).
4. Abre un Pull Request describiendo los cambios.

---

## Licencia

Este proyecto se distribuye bajo la licencia **[Mozilla Public License 2.0 (MPL-2.0)](LICENSE)**.

Las modificaciones al código fuente cubierto por MPL deben compartirse bajo la misma licencia, pero pueden combinarse con código de otras licencias en un proyecto más grande.

---

## Créditos

- **IFCLite** — [LTplus-AG](https://github.com/LTplus-AG/ifc-lite) — Motor BIM (MPL-2.0)
- **MapLibre GL JS** — [MapLibre](https://maplibre.org) — Motor GIS (BSD-3-Clause)
- **Proj4js** — [proj4js.org](https://proj4js.org) — Transformación de coordenadas (MIT)
- **LitElement** — [Google](https://lit.dev) — Web Components (BSD-3-Clause)

---

<div align="center">
<sub>Desarrollado con ❤️ para Galicia · <a href="https://mavtarq.github.io/TallerGubimOct26/">Demo</a> · <a href="specs.md">Especificaciones</a></sub>
</div>
