-- Location is now a landlord-entered address (opened in Google Maps by students)
-- instead of map coordinates. Distance to campus is entered by the landlord.
ALTER TABLE "Listing" DROP COLUMN "latitude",
DROP COLUMN "longitude",
ADD COLUMN "address" TEXT;
