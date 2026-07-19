/** A structured error intended for durable diagnostics rather than terminal output. */
export interface ErrorReport {
  /** The component that observed the failure. */
  readonly source: string;
  /** Human-readable description of the failed operation. */
  readonly message: string;
  /** The original error, when one was available. */
  readonly error?: unknown;
  /** Small, structured details that help identify the failed operation. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ErrorStream {
  readonly publish: (report: ErrorReport) => void;
  readonly subscribe: (receiver: (report: ErrorReport) => void) => void;
}
