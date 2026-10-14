/**
 * Request ids for every consumer that sends correlated requests through the host.
 *
 * Results come back on shared topics and each consumer recognises its own by
 * id, so two consumers must never issue the same number. Each consumer owns one
 * band here; a new consumer adds a band instead of picking a number elsewhere.
 */
export const REQUEST_ID_BANDS = {
  graph: 30_000,
  workingTree: 40_000,
  os: 50_000,
  git: 60_000,
  update: 70_000,
  health: 80_000,
} as const;

/** Ids per band. Bands are this far apart, so they cannot overlap. */
export const REQUEST_ID_BAND_SIZE = 10_000;

export type RequestIdBand = keyof typeof REQUEST_ID_BANDS;

/** Whether `requestId` was issued from `band`. */
export function isInBand(requestId: number, band: RequestIdBand): boolean {
  const start = REQUEST_ID_BANDS[band];
  return requestId >= start && requestId < start + REQUEST_ID_BAND_SIZE;
}

/**
 * Issues ids from one band, wrapping within it so a long session never runs
 * into the next band. A wrapped id can only collide with a request still
 * pending after ten thousand newer ones, which no consumer keeps.
 */
export class RequestIds {
  private offset = 0;

  constructor(private readonly band: RequestIdBand) {}

  next(): number {
    const id = REQUEST_ID_BANDS[this.band] + this.offset;
    this.offset = (this.offset + 1) % REQUEST_ID_BAND_SIZE;
    return id;
  }
}
