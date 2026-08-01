/** A stable reference into the bounded inputs supplied to one distillation. */
export interface EvidenceReference {
  readonly source: 'candidate' | 'afferent';
  readonly index: number;
}
