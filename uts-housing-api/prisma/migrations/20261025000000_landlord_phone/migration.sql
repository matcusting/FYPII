-- A contact number belongs to the account's private profile, not its public listing.
ALTER TABLE "Profile" ADD COLUMN "phone" TEXT;
