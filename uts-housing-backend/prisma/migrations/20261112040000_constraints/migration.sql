-- Integrity constraints from PROJECT_REQUIREMENTS.md section 9.3
ALTER TABLE "Listing" ADD CONSTRAINT "listing_rent_nonneg" CHECK ("rent" >= 0);
ALTER TABLE "Listing" ADD CONSTRAINT "listing_deposit_nonneg" CHECK ("deposit" >= 0);
ALTER TABLE "Listing" ADD CONSTRAINT "listing_distance_nonneg" CHECK ("distanceKm" >= 0);
ALTER TABLE "Review" ADD CONSTRAINT "review_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "LifestyleProfile" ADD CONSTRAINT "lifestyle_budget_order"
  CHECK ("budgetMin" IS NULL OR "budgetMax" IS NULL OR "budgetMin" <= "budgetMax");
-- Case-insensitive unique e-mail (application also lower-cases)
CREATE UNIQUE INDEX "user_email_lower_key" ON "User" (LOWER("email"));
