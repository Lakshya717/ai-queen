import type { CollectionStateName, ICollectionState } from './ICollectionState';

export class InactiveState implements ICollectionState {
  public readonly name = 'inactive' as const;
  public onEnter(): void {}
  public onExit(): void {}
}

export class CheckingCacheState implements ICollectionState {
  public readonly name = 'checking_cache' as const;
  public onEnter(): void {}
  public onExit(): void {}
}

export class ActiveWatchingState implements ICollectionState {
  public readonly name = 'active_watching' as const;
  public onEnter(): void {}
  public onExit(): void {}
}

export class CapturingState implements ICollectionState {
  public readonly name = 'capturing' as const;
  public onEnter(): void {}
  public onExit(): void {}
}

export class UploadingState implements ICollectionState {
  public readonly name = 'uploading' as const;
  public onEnter(): void {}
  public onExit(): void {}
}

export class CompletedState implements ICollectionState {
  public readonly name = 'completed' as const;
  public onEnter(): void {}
  public onExit(): void {}
}
