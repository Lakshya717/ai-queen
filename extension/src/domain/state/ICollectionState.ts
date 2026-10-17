export type CollectionStateName =
  | 'inactive'
  | 'checking_cache'
  | 'active_watching'
  | 'capturing'
  | 'uploading'
  | 'completed';

export interface ICollectionState {
  readonly name: CollectionStateName;
  onEnter(): void;
  onExit(): void;
}
