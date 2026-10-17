import type { CollectionStateName, ICollectionState } from './ICollectionState';
import {
  InactiveState,
  CheckingCacheState,
  ActiveWatchingState,
  CapturingState,
  UploadingState,
  CompletedState,
} from './CollectionStates';

export type StateTransitionListener = (
  previousState: CollectionStateName,
  newState: CollectionStateName
) => void;

export class InputCollectionStateMachine {
  private currentState: ICollectionState;
  private readonly states: Map<CollectionStateName, ICollectionState>;
  private readonly listeners = new Set<StateTransitionListener>();

  constructor(initialState: CollectionStateName = 'inactive') {
    this.states = new Map<CollectionStateName, ICollectionState>([
      ['inactive', new InactiveState()],
      ['checking_cache', new CheckingCacheState()],
      ['active_watching', new ActiveWatchingState()],
      ['capturing', new CapturingState()],
      ['uploading', new UploadingState()],
      ['completed', new CompletedState()],
    ]);

    this.currentState = this.states.get(initialState)!;
    this.currentState.onEnter();
  }

  public get stateName(): CollectionStateName {
    return this.currentState.name;
  }

  public transitionTo(nextState: CollectionStateName): void {
    if (this.currentState.name === nextState) return;

    const targetState = this.states.get(nextState);
    if (!targetState) {
      throw new Error(`Unknown state transition target: ${nextState}`);
    }

    const previousName = this.currentState.name;
    this.currentState.onExit();
    this.currentState = targetState;
    this.currentState.onEnter();

    this.listeners.forEach((listener) => {
      try {
        listener(previousName, nextState);
      } catch (err) {
        console.error('State transition listener error:', err);
      }
    });
  }

  public onStateChange(listener: StateTransitionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
