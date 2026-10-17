/**
 * Modelo de un documento IDS (Information Delivery Specification, buildingSMART) 1.0.
 * https://github.com/buildingSMART/IDS
 */

/** Restricción de valor: un valor simple o una xs:restriction. */
export type IdsValue =
  | { kind: 'simple'; value: string }
  | {
      kind: 'restriction';
      base: string | null;
      enumeration: string[];
      patterns: string[];
      minInclusive?: number;
      maxInclusive?: number;
      minExclusive?: number;
      maxExclusive?: number;
      length?: number;
      minLength?: number;
      maxLength?: number;
    };

export type FacetCardinality = 'required' | 'optional' | 'prohibited';

export type IdsRelation =
  | 'IFCRELAGGREGATES'
  | 'IFCRELCONTAINEDINSPATIALSTRUCTURE'
  | 'IFCRELNESTS'
  | 'IFCRELVOIDSELEMENT'
  | 'IFCRELFILLSELEMENT';

export const IDS_RELATIONS: IdsRelation[] = [
  'IFCRELAGGREGATES',
  'IFCRELCONTAINEDINSPATIALSTRUCTURE',
  'IFCRELNESTS',
  'IFCRELVOIDSELEMENT',
  'IFCRELFILLSELEMENT',
];

export interface EntityFacet {
  facet: 'entity';
  name: IdsValue;
  predefinedType: IdsValue | null;
}

export interface AttributeFacet {
  facet: 'attribute';
  name: IdsValue;
  value: IdsValue | null;
  cardinality: FacetCardinality;
}

export interface PropertyFacet {
  facet: 'property';
  propertySet: IdsValue;
  baseName: IdsValue;
  value: IdsValue | null;
  dataType: string | null;
  cardinality: FacetCardinality;
}

export interface MaterialFacet {
  facet: 'material';
  value: IdsValue | null;
  cardinality: FacetCardinality;
}

export interface ClassificationFacet {
  facet: 'classification';
  system: IdsValue | null;
  value: IdsValue | null;
  cardinality: FacetCardinality;
}

export interface PartOfFacet {
  facet: 'partOf';
  relation: IdsRelation | null;
  entity: EntityFacet;
  cardinality: FacetCardinality;
}

export type IdsFacet = EntityFacet | AttributeFacet | PropertyFacet | MaterialFacet | ClassificationFacet | PartOfFacet;

export interface IdsSpecification {
  name: string;
  identifier: string | null;
  description: string | null;
  instructions: string | null;
  /** Esquemas a los que aplica (IFC2X3, IFC4, IFC4X3_ADD2). Vacío = todos. */
  ifcVersions: string[];
  /** Cardinalidad de la especificación, derivada de minOccurs/maxOccurs de la aplicabilidad. */
  cardinality: FacetCardinality;
  applicability: IdsFacet[];
  requirements: IdsFacet[];
  requirementsDescription: string | null;
}

export interface IdsDocument {
  title: string;
  version: string | null;
  author: string | null;
  date: string | null;
  description: string | null;
  purpose: string | null;
  milestone: string | null;
  specifications: IdsSpecification[];
}
