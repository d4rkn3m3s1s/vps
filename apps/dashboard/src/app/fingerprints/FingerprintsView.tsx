'use client';

import { useEffect, useState } from 'react';
import { Fingerprint, RefreshCw, MapPin, Smartphone, Signal, Globe2 } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

type Device = { id: string; name: string; status?: string };
type Country = { countryCode: string; country: string; timezone: string };
type Fp = {
  deviceId: string;
  imei: string;
  androidId: string;
  serialNo: string;
  macAddress: string;
  manufacturer: string;
  model: string;
  brand: string;
  osVersion: string;
  buildNumber: string;
  resolution: string;
  dpi: number;
  carrier: string;
  mcc: string;
  mnc: string;
  phoneNumber?: string | null;
  language: string;
  country: string;
  countryCode: string;
  timezone: string;
  latitude?: number | null;
  longitude?: number | null;
  gpsEnabled: boolean;
};

export function FingerprintsView() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [fp, setFp] = useState<Fp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Regenerate controls.
  const [regenCountry, setRegenCountry] = useState('');
  const [regenGps, setRegenGps] = useState(true);

  // GPS controls.
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 3500);
  }

  // Initial load: device list + country/locale catalog.
  useEffect(() => {
    (async () => {
      try {
        const [dRes, cRes] = await Promise.all([fetch('/api/devices'), fetch('/api/fingerprints/countries')]);
        const [dJson, cJson] = await Promise.all([dRes.json(), cRes.json()]);
        const ds: Device[] = Array.isArray(dJson.data) ? dJson.data : [];
        setDevices(ds);
        if (Array.isArray(cJson.data)) setCountries(cJson.data);
        if (ds[0] && !selected) setSelected(ds[0].id);
      } catch {
        flash('Could not load devices or country catalog.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the fingerprint whenever the selected device changes.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      setFp(null);
      try {
        const res = await fetch(`/api/fingerprints/${selected}`);
        const json = await res.json();
        if (cancelled) return;
        if (res.ok && json.data) {
          const d = json.data as Fp;
          setFp(d);
          setRegenCountry(d.countryCode ?? '');
          setRegenGps(Boolean(d.gpsEnabled));
          setLat(d.latitude != null ? String(d.latitude) : '');
          setLng(d.longitude != null ? String(d.longitude) : '');
        } else {
          flash(json.message ?? 'No fingerprint for this device yet.');
        }
      } catch {
        if (!cancelled) flash('Could not load fingerprint.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function regenerate() {
    if (!selected) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { gpsEnabled: regenGps };
      if (regenCountry.trim()) body.countryCode = regenCountry.trim().toUpperCase();
      const res = await fetch(`/api/fingerprints/${selected}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Regenerate failed');
      const d = json.data as Fp;
      setFp(d);
      setLat(d.latitude != null ? String(d.latitude) : '');
      setLng(d.longitude != null ? String(d.longitude) : '');
      flash('New device identity generated.');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Regenerate failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveGps() {
    if (!selected) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { gpsEnabled: regenGps };
      if (lat.trim()) body.latitude = Number(lat.trim());
      if (lng.trim()) body.longitude = Number(lng.trim());
      if (regenCountry.trim()) body.countryCode = regenCountry.trim().toUpperCase();
      const res = await fetch(`/api/fingerprints/${selected}/gps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Could not save GPS');
      if (json.data) setFp(json.data as Fp);
      flash('GPS location updated.');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save GPS');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title="Device identities"
        subtitle="Manage the fingerprint, SIM locale, and GPS of each cloud phone — the anti-detection layer."
      />

      <div className="section-grid">
        {/* Device picker */}
        <div className="panel">
          <h2>
            <Smartphone size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Cloud phones
          </h2>
          {devices.length === 0 ? (
            <p className="helper">No devices yet. Create a cloud phone first.</p>
          ) : (
            <div className="fp-device-list">
              {devices.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`fp-device-item${selected === d.id ? ' fp-device-active' : ''}`}
                  onClick={() => setSelected(d.id)}
                >
                  <span className="fp-device-name">{d.name}</span>
                  {d.status ? <span className="fp-device-status">{d.status.toLowerCase()}</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Fingerprint detail */}
        <div className="panel">
          <h2>
            <Fingerprint size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Identity
          </h2>
          {!fp ? (
            <p className="helper">{selected ? 'Loading identity…' : 'Select a device.'}</p>
          ) : (
            <>
              <div className="fp-grid">
                <FpField label="Manufacturer" value={fp.manufacturer} />
                <FpField label="Model" value={fp.model} />
                <FpField label="Brand" value={fp.brand} />
                <FpField label="OS version" value={fp.osVersion} />
                <FpField label="Build" value={fp.buildNumber} />
                <FpField label="Resolution" value={`${fp.resolution} · ${fp.dpi}dpi`} />
                <FpField label="IMEI" value={fp.imei} mono />
                <FpField label="Android ID" value={fp.androidId} mono />
                <FpField label="Serial" value={fp.serialNo} mono />
                <FpField label="MAC" value={fp.macAddress} mono />
                <FpField label="Carrier" value={`${fp.carrier} (${fp.mcc}/${fp.mnc})`} />
                <FpField label="Phone number" value={fp.phoneNumber ?? '—'} mono />
                <FpField label="Language" value={fp.language} />
                <FpField label="Timezone" value={fp.timezone} />
              </div>

              {/* Regenerate */}
              <div className="fp-action-block">
                <h3 className="adb-subhead">
                  <Globe2 size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} /> Regenerate identity
                </h3>
                <p className="helper">
                  Generate a fresh, internally-consistent device fingerprint (IMEI, Android ID, MAC, SIM) for the
                  chosen country. Use this to rotate identity between sessions.
                </p>
                <div className="fp-action-row">
                  <select
                    className="field-input"
                    value={regenCountry}
                    onChange={(e) => setRegenCountry(e.target.value)}
                  >
                    <option value="">Random country</option>
                    {countries.map((c) => (
                      <option key={c.countryCode} value={c.countryCode}>
                        {c.country} ({c.countryCode}) · {c.timezone}
                      </option>
                    ))}
                  </select>
                  <label className="fp-check">
                    <input type="checkbox" checked={regenGps} onChange={(e) => setRegenGps(e.target.checked)} /> GPS on
                  </label>
                  <button type="button" className="btn-primary" disabled={busy} onClick={regenerate}>
                    <RefreshCw size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                    {busy ? 'Working…' : 'Regenerate'}
                  </button>
                </div>
              </div>

              {/* GPS */}
              <div className="fp-action-block">
                <h3 className="adb-subhead">
                  <MapPin size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} /> GPS location
                </h3>
                <p className="helper">
                  Current: {fp.gpsEnabled ? `${fp.latitude ?? '—'}, ${fp.longitude ?? '—'}` : 'GPS disabled'}.{' '}
                  Set precise coordinates or leave blank to keep the country-derived location.
                </p>
                <div className="fp-action-row">
                  <input
                    className="field-input mono"
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    placeholder="Latitude (e.g. 40.7128)"
                  />
                  <input
                    className="field-input mono"
                    value={lng}
                    onChange={(e) => setLng(e.target.value)}
                    placeholder="Longitude (e.g. -74.0060)"
                  />
                  <button type="button" className="btn-ghost" disabled={busy} onClick={saveGps}>
                    <Signal size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} /> Save GPS
                  </button>
                </div>
                {fp.latitude != null && fp.longitude != null ? (
                  <a
                    className="helper fp-map-link"
                    href={`https://www.openstreetmap.org/?mlat=${fp.latitude}&mlon=${fp.longitude}#map=11/${fp.latitude}/${fp.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on map ↗
                  </a>
                ) : null}
              </div>

              {msg ? <p className="helper" style={{ marginTop: '0.75rem' }}>{msg}</p> : null}
            </>
          )}
        </div>
      </div>
    </PageMotion>
  );
}

function FpField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="fp-field">
      <span className="fp-field-label">{label}</span>
      <span className={`fp-field-value${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  );
}
