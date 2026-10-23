import { useEffect, useRef, useState, type RefObject } from 'react'
import { currentLocale, useI18n } from '../lib/i18n'

export interface LocationPin {
  latitude: number
  longitude: number
  address?: string
}

interface Coordinates { lat: number; lng: number }
interface MapPoint { lat(): number; lng(): number }
interface MapsListener { remove(): void }
interface MapInstance {
  setCenter(position: Coordinates): void
  addListener(event: 'click', callback: (event: { latLng?: MapPoint }) => void): MapsListener
}
interface MarkerInstance {
  setPosition(position: Coordinates): void
  setMap(map: MapInstance | null): void
}
interface GoogleMaps {
  Map: new (element: HTMLElement, options: { center: Coordinates; zoom: number; clickableIcons: boolean; gestureHandling: string }) => MapInstance
  Marker: new (options: { map: MapInstance; position: Coordinates }) => MarkerInstance
  Geocoder: new () => { geocode(request: { location?: Coordinates; address?: string }, callback: (results: Array<{ formatted_address: string; geometry: { location: MapPoint } }> | null, status: string) => void): void }
}
type MapsWindow = Window & { google?: { maps: GoogleMaps }; __utsHousingGoogleMapsReady?: () => void }

export const googleMapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() || ''

let mapLoader: Promise<GoogleMaps> | null = null
function loadGoogleMaps(): Promise<GoogleMaps> {
  if (mapLoader) return mapLoader
  mapLoader = new Promise((resolve, reject) => {
    const mapsWindow = window as MapsWindow
    if (mapsWindow.google?.maps) { resolve(mapsWindow.google.maps); return }
    if (!googleMapsKey) { reject(new Error('Google Maps is not configured.')); return }
    const script = document.createElement('script')
    mapsWindow.__utsHousingGoogleMapsReady = () => {
      delete mapsWindow.__utsHousingGoogleMapsReady
      if (mapsWindow.google?.maps) resolve(mapsWindow.google.maps)
      else reject(new Error('Google Maps did not load.'))
    }
    script.onerror = () => {
      delete mapsWindow.__utsHousingGoogleMapsReady
      mapLoader = null
      reject(new Error('Google Maps could not load. Check your connection and try again.'))
    }
    const search = new URLSearchParams({ key: googleMapsKey, language: currentLocale() === 'zh-CN' ? 'zh-CN' : currentLocale() === 'ms' ? 'ms' : 'en', region: 'MY', v: 'weekly', callback: '__utsHousingGoogleMapsReady' })
    script.src = `https://maps.googleapis.com/maps/api/js?${search}`
    script.async = true
    script.defer = true
    document.head.appendChild(script)
  })
  return mapLoader
}

export function validCoordinates(latitude: number | null | undefined, longitude: number | null | undefined): latitude is number {
  return typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
}

export function visibleExactPin(listing: { showExactLocation?: boolean; latitude?: number | null; longitude?: number | null; address?: string | null } | null | undefined): LocationPin | null {
  if (!listing?.showExactLocation || !validCoordinates(listing.latitude, listing.longitude)) return null
  return { latitude: listing.latitude, longitude: listing.longitude!, address: listing.address || undefined }
}

export function googleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`
}

export function GoogleLocationMap({ pin, onPick, searchInputRef, className = '' }: {
  pin?: LocationPin | null
  onPick?: (pin: LocationPin) => void
  searchInputRef?: RefObject<HTMLInputElement | null>
  className?: string
}) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLDivElement>(null)
  const mapsRef = useRef<GoogleMaps | null>(null)
  const mapRef = useRef<MapInstance | null>(null)
  const markerRef = useRef<MarkerInstance | null>(null)
  const onPickRef = useRef(onPick)
  const pinRef = useRef(pin)
  const [error, setError] = useState('')
  useEffect(() => { onPickRef.current = onPick }, [onPick])
  useEffect(() => { pinRef.current = pin }, [pin])

  function findAddress() {
    const address = searchInputRef?.current?.value.trim()
    const maps = mapsRef.current
    const map = mapRef.current
    if (!address || !maps || !map) { setError('Enter an address to find it on the map.'); return }
    new maps.Geocoder().geocode({ address }, (results, status) => {
      const found = results?.[0]
      if (status !== 'OK' || !found) { setError('Google Maps could not find that address. Try a more specific place.'); return }
      setError('')
      const next = { lat: found.geometry.location.lat(), lng: found.geometry.location.lng() }
      map.setCenter(next)
      if (!markerRef.current) markerRef.current = new maps.Marker({ map, position: next })
      else markerRef.current.setPosition(next)
      onPickRef.current?.({ latitude: next.lat, longitude: next.lng, address: found.formatted_address })
    })
  }

  useEffect(() => {
    if (!googleMapsKey) return
    let active = true
    const listeners: MapsListener[] = []
    loadGoogleMaps().then(maps => {
      if (!active || !canvasRef.current) return
      const currentPin = pinRef.current
      const center = currentPin ? { lat: currentPin.latitude, lng: currentPin.longitude } : { lat: 2.286, lng: 111.835 }
      const map = new maps.Map(canvasRef.current, { center, zoom: currentPin ? 16 : 13, clickableIcons: false, gestureHandling: onPickRef.current ? 'cooperative' : 'none' })
      mapsRef.current = maps
      mapRef.current = map
      if (currentPin) markerRef.current = new maps.Marker({ map, position: center })
      if (onPickRef.current) {
        listeners.push(map.addListener('click', event => {
          if (!event.latLng) return
          const location = { lat: event.latLng.lat(), lng: event.latLng.lng() }
          if (!markerRef.current) markerRef.current = new maps.Marker({ map, position: location })
          else markerRef.current.setPosition(location)
          onPickRef.current?.({ latitude: location.lat, longitude: location.lng })
          new maps.Geocoder().geocode({ location }, (results, status) => {
            if (active && status === 'OK' && results?.[0]) onPickRef.current?.({ latitude: location.lat, longitude: location.lng, address: results[0].formatted_address })
          })
        }))
      }
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'Google Maps could not load.') })
    return () => {
      active = false
      listeners.forEach(listener => listener.remove())
      markerRef.current?.setMap(null)
      markerRef.current = null
      mapsRef.current = null
      mapRef.current = null
    }
    // The map instance is created once; the next effect moves its marker as the pin changes.
  }, [])

  useEffect(() => {
    if (!mapRef.current) return
    if (!pin) { markerRef.current?.setMap(null); markerRef.current = null; return }
    const position = { lat: pin.latitude, lng: pin.longitude }
    mapRef.current.setCenter(position)
    if (!markerRef.current && mapsRef.current) markerRef.current = new mapsRef.current.Marker({ map: mapRef.current, position })
    else markerRef.current?.setPosition(position)
  }, [pin?.latitude, pin?.longitude, pin])

  if (!googleMapsKey) return null
  return <div className={className}>
    {onPick && searchInputRef && <button type="button" onClick={findAddress} className="mb-2 rounded-lg border border-[#203569] bg-white px-4 py-2 text-xs font-bold text-[#203569] hover:bg-blue-50">{t('Find address on map')}</button>}
    <div ref={canvasRef} role="img" aria-label={onPick ? t('Google Map. Click to choose the exact property location.') : t('Google Map showing the exact property location')} className="h-[260px] w-full rounded-lg bg-[#f1f3f5] sm:h-[320px]" />
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{t(error)}</p>}
  </div>
}
