CREATE TYPE "StudentGender" AS ENUM ('MALE', 'FEMALE', 'UNDISCLOSED');
CREATE TYPE "ListingGenderPreference" AS ENUM ('ALL', 'MALE', 'FEMALE');

ALTER TABLE "RoommateProfile"
  ADD COLUMN "gender" "StudentGender" NOT NULL DEFAULT 'UNDISCLOSED';

ALTER TABLE "Listing"
  ADD COLUMN "genderPreference" "ListingGenderPreference" NOT NULL DEFAULT 'ALL';

-- Existing profiles never opted in to sharing this new personal field.
UPDATE "RoommateProfile"
SET "visibility" = jsonb_set("visibility"::jsonb, '{gender}', 'false'::jsonb, true);
