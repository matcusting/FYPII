-- Make the selectable facilities available on existing and new databases,
-- without requiring the fictional demo seed in production.
INSERT INTO "Amenity" ("id", "slug", "name")
SELECT value."id", value."slug", value."name"
FROM (VALUES
  ('60000000-0000-4000-8000-000000000001', 'wifi', 'Wi-Fi'),
  ('60000000-0000-4000-8000-000000000002', 'air-conditioning', 'Air Conditioning'),
  ('60000000-0000-4000-8000-000000000003', 'furnished', 'Furnished'),
  ('60000000-0000-4000-8000-000000000004', 'laundry', 'Laundry'),
  ('60000000-0000-4000-8000-000000000005', 'parking', 'Parking'),
  ('60000000-0000-4000-8000-000000000006', 'wardrobe', 'Wardrobe'),
  ('60000000-0000-4000-8000-000000000007', 'refrigerator', 'Refrigerator'),
  ('60000000-0000-4000-8000-000000000008', 'water-heater', 'Water Heater'),
  ('60000000-0000-4000-8000-000000000009', 'private-bathroom', 'Private Bathroom'),
  ('60000000-0000-4000-8000-000000000010', 'kitchen-access', 'Kitchen Access'),
  ('60000000-0000-4000-8000-000000000011', 'study-desk', 'Study Desk'),
  ('60000000-0000-4000-8000-000000000012', 'security-cctv', 'Security / CCTV'),
  ('60000000-0000-4000-8000-000000000013', 'balcony', 'Balcony')
) AS value("id", "slug", "name")
WHERE NOT EXISTS (
  SELECT 1 FROM "Amenity" existing
  WHERE existing."slug" = value."slug" OR existing."name" = value."name"
);
