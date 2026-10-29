import { prisma } from '../src/core/db.js'
import { geocodeAddress, geocoderEndpoint } from '../src/core/geocode.js'

// Re-run safely after an address service outage. Never print private addresses.
async function main() {
  if (!geocoderEndpoint()) {
    process.stdout.write('No address lookup service is configured; existing distances were not backfilled.\n')
    return
  }
  const listings = await prisma.listing.findMany({
    where: { address: { not: null }, latitude: null, longitude: null, status: { not: 'ARCHIVED' } },
    select: { id: true, address: true },
  })
  let updated = 0
  for (const listing of listings) {
    if (!listing.address) continue
    const coordinates = await geocodeAddress(listing.address)
    if (!coordinates) continue
    const result = await prisma.listing.updateMany({
      where: { id: listing.id, address: listing.address, latitude: null, longitude: null },
      data: coordinates,
    })
    updated += result.count
  }
  process.stdout.write(`Distance backfill: ${updated} of ${listings.length} listings located. Unmatched addresses can be corrected and saved by their owners.\n`)
}

main().catch(() => {
  process.stderr.write('Distance backfill failed. Check the database and address service, then run npm run locations:backfill again.\n')
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
