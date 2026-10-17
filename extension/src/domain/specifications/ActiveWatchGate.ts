import type { IGateSpecification, WatchContextSnapshot } from './IGateSpecification';

export interface GateEvaluationResult {
  readonly passed: boolean;
  readonly failedReasons: ReadonlyArray<string>;
}

export class ActiveWatchGate {
  private readonly specs: ReadonlyArray<IGateSpecification>;
  private readonly listeners = new Set<(passed: boolean, failedReasons: string[]) => void>();
  private lastPassedState: boolean | null = null;

  constructor(specs: ReadonlyArray<IGateSpecification>) {
    this.specs = specs;
  }

  public evaluate(ctx: WatchContextSnapshot): GateEvaluationResult {
    const failedReasons: string[] = [];
    for (const spec of this.specs) {
      if (!spec.isSatisfiedBy(ctx)) {
        failedReasons.push(spec.failureReason(ctx) ?? spec.id);
      }
    }

    const passed = failedReasons.length === 0;

    if (this.lastPassedState === null || passed !== this.lastPassedState) {
      this.lastPassedState = passed;
      this.notifyListeners(passed, failedReasons);
    }

    return { passed, failedReasons };
  }

  public onGateChange(listener: (passed: boolean, failedReasons: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public reset(): void {
    this.lastPassedState = null;
  }

  private notifyListeners(passed: boolean, failedReasons: string[]): void {
    for (const listener of this.listeners) {
      try {
        listener(passed, failedReasons);
      } catch (err) {
        console.error('ActiveWatchGate listener error:', err);
      }
    }
  }
}
