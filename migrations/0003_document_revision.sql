-- A monotonic revision per document, used to tell one save from another.
--
-- Thumbnail capture races: two quick saves start two captures which can finish
-- in either order, and the loser must not mark its stale image as current.
-- `updatedAt` is too coarse to key that on — Date.now() has millisecond
-- resolution and consecutive saves routinely land in the same millisecond, so
-- a superseded capture would compare equal and mark itself current anyway.
alter table "document" add column "revision" integer not null default 1;
