import { MUMBAI_BBOX } from '../config';
import { fetchRoadNetwork } from '../services/overpass';
import { buildGraph, type RoadGraph } from './graph';

/** Lazily downloads and builds the Mumbai major-road graph once per session. */
let pending: Promise<RoadGraph> | null = null;
let ready: RoadGraph | null = null;

export const getLoadedGraph = () => ready;

export function loadRoadGraph(): Promise<RoadGraph> {
  if (ready) return Promise.resolve(ready);
  if (!pending) {
    pending = fetchRoadNetwork(MUMBAI_BBOX)
      .then((ways) => {
        if (ways.length < 50) throw new Error('Road network download was incomplete. Please retry.');
        ready = buildGraph(ways);
        return ready;
      })
      .catch((e) => {
        pending = null;
        throw e;
      });
  }
  return pending;
}
