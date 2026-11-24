import type { UpdateState } from '@shared/update-types';
import { create } from 'zustand';

interface UpdateStoreState {
  update: UpdateState | undefined;
}

export const useUpdateStore = create<UpdateStoreState>(() => ({ update: undefined }));

let subscribed = false;

/** Mirrors the main-process update state. Safe to call more than once. */
export function startUpdateSync(): void {
  if (subscribed) return;
  subscribed = true;
  window.api.update.onChanged((update) => useUpdateStore.setState({ update }));
  void window.api.update
    .state()
    .then((update) => useUpdateStore.setState((current) => current.update ? current : { update }))
    .catch(console.error);
}
