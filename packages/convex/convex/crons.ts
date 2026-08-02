import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

/**
 * Scheduled jobs. Currently just the `raw_captures` retention prune (ADR-0007):
 * the probe table is append-mostly, so without a TTL it grows forever. A daily
 * prune is frequent enough to bound the table and cheap — `pruneOld` deletes in
 * bounded batches and drains any backlog by rescheduling itself.
 */
const crons = cronJobs();

crons.interval('prune old raw_captures', { hours: 24 }, internal.rawCaptures.pruneOld, {});

export default crons;
