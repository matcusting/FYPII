ALTER TABLE "Listing" ADD COLUMN "distanceKm" DOUBLE PRECISION;
CREATE INDEX "Listing_status_campusId_distanceKm_idx" ON "Listing"("status", "campusId", "distanceKm");

CREATE FUNCTION listing_campus_distance() RETURNS trigger AS $$
BEGIN
  IF NEW."latitude" IS NULL OR NEW."longitude" IS NULL THEN
    NEW."distanceKm" := NULL;
  ELSE
    SELECT ROUND((2 * 6371 * asin(sqrt(LEAST(1.0,
      power(sin(radians(c."latitude" - NEW."latitude") / 2), 2) +
      cos(radians(NEW."latitude")) * cos(radians(c."latitude")) *
      power(sin(radians(c."longitude" - NEW."longitude") / 2), 2)
    ))))::numeric, 2)::double precision
    INTO NEW."distanceKm" FROM "Campus" c WHERE c."id" = NEW."campusId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER listing_campus_distance_before_write
BEFORE INSERT OR UPDATE OF "latitude", "longitude", "campusId" ON "Listing"
FOR EACH ROW EXECUTE FUNCTION listing_campus_distance();

CREATE FUNCTION refresh_campus_listing_distances() RETURNS trigger AS $$
BEGIN
  UPDATE "Listing" SET "latitude" = "latitude"
  WHERE "campusId" = NEW."id" AND "latitude" IS NOT NULL AND "longitude" IS NOT NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER refresh_campus_listing_distances_after_write
AFTER UPDATE OF "latitude", "longitude" ON "Campus"
FOR EACH ROW EXECUTE FUNCTION refresh_campus_listing_distances();

UPDATE "Listing" SET "latitude" = "latitude"
WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;
