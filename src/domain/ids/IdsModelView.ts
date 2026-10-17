import type { IdsRelation } from './IdsDocument';

export type IfcScalar = string | number | boolean;

export interface IdsPropertyData {
  name: string;
  /** Valores no nulos (varios en propiedades enumeradas o de lista). */
  values: IfcScalar[];
  /** Tipo IFC del valor en mayúsculas, p. ej. "IFCLABEL", "IFCLENGTHMEASURE". */
  dataType: string | null;
}

export interface IdsPropertySetData {
  name: string;
  properties: IdsPropertyData[];
}

export interface IdsClassificationData {
  /** Nombre del IfcClassification raíz. */
  system: string | null;
  /** Códigos (Identification / ItemReference) de la referencia y sus ancestros. */
  identifications: string[];
}

/**
 * Vista de solo lectura de un modelo IFC con lo que necesita el validador IDS.
 * Los nombres de clase se manejan en mayúsculas ("IFCWALL"), como en IDS.
 */
export interface IdsModelView {
  readonly schema: string;
  /** Todas las IfcObjectDefinition (objetos y tipos). */
  allObjectIds(): number[];
  /** Instancias de una clase exacta (sin subtipos), como exige IDS. */
  idsOfEntity(entityName: string): number[];
  entityName(id: number): string;
  /** PredefinedType efectivo: ObjectType si es USERDEFINED y, si no hay, el del tipo. */
  predefinedType(id: number): string | null;
  attributeNames(id: number): string[];
  /** `present` = atributo con valor no vacío; `values` = sus valores escalares. */
  attribute(id: number, name: string): { present: boolean; values: IfcScalar[] };
  /** Psets y QuantitySets de la instancia combinados con los de su tipo (la instancia prevalece). */
  propertySets(id: number): IdsPropertySetData[];
  /** Nombres y categorías de materiales, capas, perfiles y constituyentes (instancia + tipo). */
  materials(id: number): string[];
  classifications(id: number): IdsClassificationData[];
  /** Contenedores directos según la relación indicada. */
  parents(id: number, relation: IdsRelation): number[];
  label(id: number): string;
  globalId(id: number): string | null;
  /** Libera las cachés creadas durante una validación. */
  clearCache(): void;
}
