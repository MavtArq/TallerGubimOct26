/** Contenedores espaciales: un clic los despliega en el árbol (en un elemento, solo lo selecciona). */
export const SPATIAL_CONTAINER_TYPES = new Set([
  'IfcProject',
  'IfcSite',
  'IfcBuilding',
  'IfcBuildingStorey',
  'IfcSpace',
  'IfcFacility',
  'IfcFacilityPart',
  'IfcBridge',
  'IfcRoad',
  'IfcRailway',
]);

/** Nodos que se despliegan por defecto en el árbol espacial (hasta ver las plantas). */
export const AUTO_EXPAND_TYPES = new Set(['IfcProject', 'IfcSite', 'IfcBuilding', 'IfcFacility']);
