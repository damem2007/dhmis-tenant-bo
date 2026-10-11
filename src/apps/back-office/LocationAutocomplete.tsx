import { useEffect, useState } from 'react';
import { api } from '../../shared/api';

export type LocationSuggestion = {
  place_id: string;
  display_name: string;
  latitude: number;
  longitude: number;
  type: string;
  address?: Record<string, string>;
};

export function LocationAutocomplete({
  region,
  inputName,
  initialValue = '',
  initialLatitude = null,
  initialLongitude = null,
  initialPlaceId = '',
  required = false,
}: {
  region: string;
  inputName: string;
  initialValue?: string;
  initialLatitude?: number | null;
  initialLongitude?: number | null;
  initialPlaceId?: string;
  required?: boolean;
}) {
  const [query, setQuery] = useState(initialValue);
  const [results, setResults] = useState<LocationSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selection, setSelection] = useState<LocationSuggestion | null>(
    initialLatitude != null && initialLongitude != null
      ? {
          place_id: initialPlaceId,
          display_name: initialValue,
          latitude: initialLatitude,
          longitude: initialLongitude,
          type: '',
        }
      : null,
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3 || selection?.display_name === query) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await api<LocationSuggestion[]>(
          `/operations/geocode/search?q=${encodeURIComponent(trimmed)}&region=${encodeURIComponent(region)}&detail=false`,
        );
        if (!cancelled) {
          setResults(response);
          setOpen(true);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, region]);

  function updateQuery(value: string) {
    setQuery(value);
    if (selection) setSelection(null);
  }

  function isStreetGroup(result: LocationSuggestion) {
    const address = result.address ?? {};
    const hasStreet = Boolean(address.road || address.street);
    const hasHouseNumber = Boolean(address.house_number || address.housenumber);
    const isPostalMatch = result.type === 'postalcode' || result.type === 'postcode';
    return hasStreet && !hasHouseNumber && !isPostalMatch;
  }

  async function choose(result: LocationSuggestion) {
    if (isStreetGroup(result)) {
      const street = result.address?.road || result.address?.street || result.display_name;
      setSelection(null);
      setSearching(true);
      setOpen(true);
      try {
        const detailResults = await api<LocationSuggestion[]>(
          `/operations/geocode/search?q=${encodeURIComponent(street)}&region=${encodeURIComponent(region)}&detail=true`,
        );
        if (detailResults.length > 0) {
          setResults(detailResults);
          return;
        }
      } catch {
        // Fall through and keep the street result selectable when expansion is unavailable.
      } finally {
        setSearching(false);
      }
    }
    setQuery(result.display_name);
    setSelection(result);
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="location-autocomplete">
      <input
        className="field"
        name={inputName}
        value={query}
        onChange={(event) => updateQuery(event.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder="Search by street, city or postal code…"
        required={required}
        autoComplete="street-address"
      />
      <input type="hidden" name="latitude" value={selection?.latitude ?? ''} readOnly />
      <input type="hidden" name="longitude" value={selection?.longitude ?? ''} readOnly />
      <input type="hidden" name="osm_place_id" value={selection?.place_id ?? ''} readOnly />
      {searching && <span className="location-autocomplete-status">Searching for address…</span>}
      {open && results.length > 0 && (
        <ul className="location-autocomplete-results" role="listbox" aria-label="Address suggestions">
          {results.map((result) => (
            <li key={`${result.place_id}-${result.latitude}`}>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(result)}>
                <strong>{result.display_name}</strong>
                <small>
                  {isStreetGroup(result)
                    ? 'Street match · choose to see addresses'
                    : `Address match · ${result.latitude.toFixed(5)}, ${result.longitude.toFixed(5)}`}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
