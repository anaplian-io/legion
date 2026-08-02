/** A stable reference into the bounded inputs supplied to one distillation. */
export interface EvidenceReference {
  readonly source: 'candidate' | 'afferent';
  readonly index: number;
}

/** A fully resolved evidence reference emitted by telemetry. */
export interface TelemetryEvidenceReference extends EvidenceReference {
  readonly id: string;
  readonly contentHash: string;
}

/** Bounded provenance retained from an external tool result. */
export interface EvidenceDescriptor {
  readonly id: string;
  readonly contentHash: string;
  readonly sourceUrls?: readonly string[];
  readonly artifactReferences?: readonly string[];
}
