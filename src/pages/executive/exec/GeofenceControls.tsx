import { useState, useEffect } from 'react'
import { MapPin, Package, Smartphone, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { Stats } from './types'

interface Props {
  stats: Stats
  geofenceEnabled: boolean
  setGeofenceEnabled: (v: boolean) => void
  radiusMain: number
  setRadiusMain: (v: number) => void
  radiusApartment: number
  setRadiusApartment: (v: number) => void
  latMain: string
  setLatMain: (v: string) => void
  lngMain: string
  setLngMain: (v: string) => void
  latApartment: string
  setLatApartment: (v: string) => void
  lngApartment: string
  setLngApartment: (v: string) => void
  peakHour: string | null
  onNavigateLowStock: () => void
}

export default function GeofenceControls({
  stats,
  geofenceEnabled,
  setGeofenceEnabled,
  radiusMain,
  setRadiusMain,
  radiusApartment,
  setRadiusApartment,
  latMain,
  setLatMain,
  lngMain,
  setLngMain,
  latApartment,
  setLatApartment,
  lngApartment,
  setLngApartment,
  peakHour,
  onNavigateLowStock,
}: Props) {
  const [geoToggling, setGeoToggling] = useState(false)
  const [radiusSaving, setRadiusSaving] = useState(false)
  const [showRadiusEdit, setShowRadiusEdit] = useState(false)

  const toggleGeofence = async () => {
    setGeoToggling(true)
    const newValue = (!geofenceEnabled).toString()
    const { error } = await supabase
      .from('settings')
      .update({ value: newValue, updated_at: new Date().toISOString() })
      .eq('id', 'geofence_enabled')
    if (!error) setGeofenceEnabled(!geofenceEnabled)
    setGeoToggling(false)
  }

  const saveRadius = async () => {
    setRadiusSaving(true)
    await Promise.all([
      supabase.from('settings').upsert({
        id: 'geofence_radius_main',
        value: String(radiusMain),
        updated_at: new Date().toISOString(),
      }),
      supabase.from('settings').upsert({
        id: 'geofence_radius_apartment',
        value: String(radiusApartment),
        updated_at: new Date().toISOString(),
      }),
      supabase.from('settings').upsert({
        id: 'geofence_lat_main',
        value: String(latMain),
        updated_at: new Date().toISOString(),
      }),
      supabase.from('settings').upsert({
        id: 'geofence_lng_main',
        value: String(lngMain),
        updated_at: new Date().toISOString(),
      }),
      supabase.from('settings').upsert({
        id: 'geofence_lat_apartment',
        value: String(latApartment),
        updated_at: new Date().toISOString(),
      }),
      supabase.from('settings').upsert({
        id: 'geofence_lng_apartment',
        value: String(lngApartment),
        updated_at: new Date().toISOString(),
      }),
    ])
    setRadiusSaving(false)
    setShowRadiusEdit(false)
  }

  const inp =
    'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500'

  return (
    <>
      {/* Control row */}
      <div className="mb-6 flex flex-wrap items-center gap-2 relative">
        <button
          onClick={toggleGeofence}
          disabled={geoToggling}
          className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl border transition-colors ${geofenceEnabled ? 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20' : 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'}`}
        >
          <MapPin size={13} />
          {geoToggling ? 'Updating...' : geofenceEnabled ? 'Geofence ON' : 'Geofence OFF'}
          <span
            className={`w-2 h-2 rounded-full ${geofenceEnabled ? 'bg-green-400' : 'bg-red-400'}`}
          />
        </button>

        <button
          onClick={() => setShowRadiusEdit((v) => !v)}
          className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl border bg-gray-800 border-gray-700 text-gray-400 hover:text-white transition-colors"
        >
          <MapPin size={13} /> Radius
        </button>

        {stats.lowStock > 0 && (
          <button
            onClick={onNavigateLowStock}
            className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-xl flex items-center gap-1.5 hover:bg-red-500/20 transition-colors"
          >
            <Package size={13} /> {stats.lowStock} Low Stock
          </button>
        )}

        {peakHour && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2">
            <p className="text-amber-400 text-xs">Peak Hour</p>
            <p className="text-white font-bold text-sm">{peakHour}</p>
          </div>
        )}

        {/* Radius popover */}
        {showRadiusEdit && (
          <div className="absolute top-12 left-0 z-50 bg-gray-900 border border-gray-700 rounded-2xl p-4 shadow-xl w-72">
            <p className="text-white font-semibold text-sm mb-3">Geofence Radius Settings</p>
            <div className="space-y-3">
              <p className="text-gray-600 text-xs mb-1">Main Venue</p>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Radius (metres)</label>
                <input
                  type="number"
                  value={radiusMain}
                  onChange={(e) => setRadiusMain(parseInt(e.target.value) || 0)}
                  className={inp}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Latitude</label>
                  <input
                    type="text"
                    value={latMain}
                    placeholder="e.g. 7.350834"
                    onChange={(e) => setLatMain(e.target.value)}
                    className={inp}
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Longitude</label>
                  <input
                    type="text"
                    value={lngMain}
                    placeholder="e.g. 3.840780"
                    onChange={(e) => setLngMain(e.target.value)}
                    className={inp}
                  />
                </div>
              </div>
              <p className="text-gray-600 text-xs mt-2 mb-1">Apartments</p>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Radius (metres)</label>
                <input
                  type="number"
                  value={radiusApartment}
                  onChange={(e) => setRadiusApartment(parseInt(e.target.value) || 0)}
                  className={inp}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Latitude</label>
                  <input
                    type="text"
                    value={latApartment}
                    placeholder="e.g. 7.349545"
                    onChange={(e) => setLatApartment(e.target.value)}
                    className={inp}
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Longitude</label>
                  <input
                    type="text"
                    value={lngApartment}
                    placeholder="e.g. 3.839690"
                    onChange={(e) => setLngApartment(e.target.value)}
                    className={inp}
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={saveRadius}
                  disabled={radiusSaving}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold py-2 rounded-xl transition-colors"
                >
                  {radiusSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setShowRadiusEdit(false)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-xs py-2 rounded-xl transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bank settings accordion */}
      <BankAccountsManager inp={inp} />
    </>
  )
}

interface BankAccount {
  id: string
  bank_name: string
  account_number: string
  account_name: string
  is_active: boolean
}

function BankAccountsManager({ inp }: { inp: string }) {
  const [banks, setBanks] = useState<BankAccount[]>([])
  const [expanded, setExpanded] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newBank, setNewBank] = useState({ bank_name: '', account_number: '', account_name: '' })

  useEffect(() => {
    supabase
      .from('bank_accounts')
      .select('id, bank_name, account_number, account_name, is_active')
      .eq('is_active', true)
      .order('created_at')
      .then(({ data }) => {
        if (data) setBanks(data as BankAccount[])
      })
  }, [])

  const addBank = async () => {
    if (!newBank.bank_name || !newBank.account_number || !newBank.account_name) return
    setSaving(true)
    const { data } = await supabase
      .from('bank_accounts')
      .insert({
        bank_name: newBank.bank_name,
        account_number: newBank.account_number,
        account_name: newBank.account_name,
        is_active: true,
      })
      .select('id, bank_name, account_number, account_name, is_active')
      .single()
    if (data) setBanks((prev) => [...prev, data as BankAccount])
    setNewBank({ bank_name: '', account_number: '', account_name: '' })
    setShowAdd(false)
    setSaving(false)
  }

  const removeBank = async (id: string) => {
    await supabase.from('bank_accounts').update({ is_active: false }).eq('id', id)
    setBanks((prev) => prev.filter((b) => b.id !== id))
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl mb-4 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <Smartphone size={15} className="text-amber-400" />
          <span className="text-white font-semibold text-sm">Bank Transfer Accounts</span>
          <span className="text-gray-500 text-xs">
            · {banks.length} account{banks.length !== 1 ? 's' : ''}
          </span>
        </div>
        <span
          className={`text-gray-500 text-xs transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          ▼
        </span>
      </button>
      {expanded && (
        <div className="px-4 py-3 space-y-2 border-t border-gray-800">
          <div className="flex items-center justify-between mb-1">
            <p className="text-gray-500 text-xs">
              Waitrons choose which bank to display during transfer payment.
            </p>
            <button
              onClick={() => setShowAdd((v) => !v)}
              className="flex items-center gap-1 text-amber-400 hover:text-amber-300 text-xs font-medium shrink-0 ml-2"
            >
              <Plus size={13} /> Add
            </button>
          </div>
          {banks.length === 0 && !showAdd && (
            <p className="text-gray-600 text-xs italic">No bank accounts added yet.</p>
          )}
          {banks.map((bank) => (
            <div
              key={bank.id}
              className="bg-gray-800 rounded-xl p-3 flex items-start justify-between gap-2"
            >
              <div>
                <p className="text-white text-sm font-semibold">{bank.bank_name}</p>
                <p className="text-amber-400 font-mono text-sm">{bank.account_number}</p>
                <p className="text-gray-400 text-xs">{bank.account_name}</p>
              </div>
              <button
                onClick={() => removeBank(bank.id)}
                className="text-gray-500 hover:text-red-400 transition-colors mt-1"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {showAdd && (
            <div className="bg-gray-800 rounded-xl p-3 space-y-2 border border-amber-500/30">
              <p className="text-amber-400 text-xs font-medium">New Bank Account</p>
              <input
                value={newBank.bank_name}
                onChange={(e) => setNewBank((p) => ({ ...p, bank_name: e.target.value }))}
                placeholder="Bank name (e.g. Moniepoint)"
                className={inp}
              />
              <input
                value={newBank.account_number}
                onChange={(e) => setNewBank((p) => ({ ...p, account_number: e.target.value }))}
                placeholder="Account number"
                className={inp}
              />
              <input
                value={newBank.account_name}
                onChange={(e) => setNewBank((p) => ({ ...p, account_name: e.target.value }))}
                placeholder="Account name"
                className={inp}
              />
              <div className="flex gap-2">
                <button
                  onClick={addBank}
                  disabled={saving}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black text-sm font-bold py-2 rounded-xl"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setShowAdd(false)}
                  className="flex-1 bg-gray-700 text-white text-sm py-2 rounded-xl"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
