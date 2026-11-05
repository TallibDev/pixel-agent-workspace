import { useSyncExternalStore } from 'react';

import { transport } from '../transport/index.js';
import { type ObservationState, ObservationStore } from './observationStore.js';

/** One store per page, fed by the shared transport from first import. */
export const observationStore = new ObservationStore();
transport.onMessage((msg) => {
  observationStore.handle(msg);
});

export function useObservation(): ObservationState {
  return useSyncExternalStore(observationStore.subscribe, observationStore.getState);
}
