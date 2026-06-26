import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { stopColor } from './utils'

export default function PlannerMap({ stops, routeGeometry, pinDropMode, onMapClick, onRemoveStop, fitKey }) {
  const divRef        = useRef(null)
  const mapRef        = useRef(null)
  const markersRef    = useRef([])
  const lineRef       = useRef(null)
  const clickRef      = useRef(null)
  const prevFitKeyRef = useRef(null)

  useEffect(() => {
    if (!divRef.current || mapRef.current) return
    const map = L.map(divRef.current).setView([52.97, -0.02], 9)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (clickRef.current) {
      map.off('click', clickRef.current)
      clickRef.current = null
      map.getContainer().style.cursor = ''
    }

    if (!pinDropMode || !onMapClick) return

    map.getContainer().style.cursor = 'crosshair'
    let popupOpen = false

    const handler = (e) => {
      if (popupOpen) return
      popupOpen = true
      const { lat, lng } = e.latlng

      const wrap = document.createElement('div')
      wrap.style.cssText = 'padding:8px;min-width:210px'

      const input = document.createElement('input')
      input.type = 'text'
      input.placeholder = 'Finding location…'
      input.style.cssText = [
        'width:100%', 'padding:4px 8px', 'font-size:13px',
        'border:1px solid #cbd5e1', 'border-radius:4px',
        'margin-bottom:8px', 'box-sizing:border-box', 'font-family:inherit',
      ].join(';')

      const btnRow = document.createElement('div')
      btnRow.style.cssText = 'display:flex;gap:6px;justify-content:flex-end'

      const cancelBtn = document.createElement('button')
      cancelBtn.textContent = 'Cancel'
      cancelBtn.style.cssText = 'padding:3px 10px;font-size:12px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;font-family:inherit'

      const addBtn = document.createElement('button')
      addBtn.textContent = 'Add Stop'
      addBtn.style.cssText = 'padding:3px 10px;font-size:12px;background:var(--operator-accent);color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:inherit'

      btnRow.appendChild(cancelBtn)
      btnRow.appendChild(addBtn)
      wrap.appendChild(input)
      wrap.appendChild(btnRow)

      const popup = L.popup({ closeButton: false, maxWidth: 260 })
        .setLatLng([lat, lng])
        .setContent(wrap)
        .openOn(map)

      popup.on('remove', () => { popupOpen = false })
      setTimeout(() => input.focus(), 50)

      fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`,
        { headers: { 'Accept-Language': 'en' } },
      )
        .then(r => r.json())
        .then(data => {
          input.placeholder = 'Stop name…'
          if (input.value) return
          const addr = data.address || {}
          const road  = addr.road || addr.pedestrian || addr.footway || addr.path
          const place = addr.village || addr.suburb || addr.town || addr.city || addr.hamlet
          const suggestion = road && place ? `${road}, ${place}` : (road || place || '')
          if (suggestion) { input.value = suggestion; input.select() }
        })
        .catch(() => { input.placeholder = 'Stop name…' })

      const confirm = () => {
        const name = input.value.trim()
        if (!name) return
        onMapClick({ name, lat, lon: lng })
        map.closePopup()
      }

      addBtn.addEventListener('click', confirm)
      cancelBtn.addEventListener('click', () => map.closePopup())
      input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') confirm()
        if (ev.key === 'Escape') map.closePopup()
      })
    }

    map.on('click', handler)
    clickRef.current = handler
  }, [pinDropMode, onMapClick])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    if (lineRef.current) { lineRef.current.remove(); lineRef.current = null }

    if (routeGeometry) {
      lineRef.current = L.geoJSON(routeGeometry, {
        style: { color: 'var(--operator-accent)', weight: 4, opacity: 0.85 },
      }).addTo(map)
    }

    const validStops = stops.filter(s => s.lat != null && s.lon != null)
    validStops.forEach((s, i) => {
      const color = stopColor(i, validStops.length)
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:24px;height:24px;border-radius:50%;
          background:${color};border:2px solid #fff;
          box-shadow:0 1px 4px rgba(0,0,0,0.4);
          display:flex;align-items:center;justify-content:center;
          font-size:11px;font-weight:700;color:#fff;
        ">${i + 1}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      })
      const marker = L.marker([s.lat, s.lon], { icon })
      marker.bindTooltip(s.name, { direction: 'right', offset: [14, 0] })

      if (onRemoveStop) {
        marker.on('click', () => {
          const wrap = document.createElement('div')
          wrap.style.cssText = 'padding:8px;text-align:center;min-width:160px'

          const nameEl = document.createElement('div')
          nameEl.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:8px;color:#1a2535;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
          nameEl.textContent = s.name

          const btn = document.createElement('button')
          btn.textContent = 'Remove stop'
          btn.style.cssText = 'padding:4px 14px;font-size:12px;background:#e53e3e;color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:inherit'
          btn.addEventListener('click', () => { onRemoveStop(s._id); map.closePopup() })

          wrap.appendChild(nameEl)
          wrap.appendChild(btn)
          L.popup({ closeButton: true, maxWidth: 240 })
            .setLatLng([s.lat, s.lon]).setContent(wrap).openOn(map)
        })
      }

      marker.addTo(map)
      markersRef.current.push(marker)
    })

    if (fitKey !== null && fitKey !== prevFitKeyRef.current) {
      prevFitKeyRef.current = fitKey
      if (validStops.length >= 2) {
        map.fitBounds(L.latLngBounds(validStops.map(s => [s.lat, s.lon])), { padding: [32, 32] })
      } else if (validStops.length === 1) {
        map.setView([validStops[0].lat, validStops[0].lon], 13)
      }
    }
  }, [stops, routeGeometry, fitKey, onRemoveStop])

  return <div ref={divRef} style={{ width: '100%', height: '100%' }} />
}
