-- Gender options: student gender, roommate gender preference, gender-restricted listings

CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');
CREATE TYPE "RoommateGenderPreference" AS ENUM ('SAME', 'ANY');
CREATE TYPE "GenderRestriction" AS ENUM ('ANY', 'MALE_ONLY', 'FEMALE_ONLY');

-- Existing students stay NULL until they choose (they are asked before using roommate matching).
ALTER TABLE "User" ADD COLUMN "gender" "Gender";
ALTER TABLE "LifestyleProfile" ADD COLUMN "roommateGender" "RoommateGenderPreference" NOT NULL DEFAULT 'SAME';
ALTER TABLE "Listing" ADD COLUMN "genderRestriction" "GenderRestriction" NOT NULL DEFAULT 'ANY';

CREATE INDEX "Listing_status_genderRestriction_idx" ON "Listing"("status", "genderRestriction");
