import { useState, useEffect, useCallback, useRef } from "react";

// ── Spotify Config ──
// Users need to create a Spotify App at https://developer.spotify.com/dashboard
// and set the redirect URI to the artifact's URL
const SCOPES = "playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private";
const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

// PKCE helpers
function generateRandomString(length) {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest("SHA-256", data);
}

function base64urlencode(input) {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// ── Pyramid Sort ──
function pyramidSort(tracks) {
  if (!tracks.length) return [];
  const sorted = [...tracks].sort((a, b) => (a.energy ?? 0) - (b.energy ?? 0));
  const result = new Array(sorted.length);
  let left = 0, right = sorted.length - 1;
  // Place lowest energy items at edges, highest in middle
  for (let i = 0; i < sorted.length; i++) {
    if (i % 2 === 0) {
      result[left++] = sorted[i];
    } else {
      result[right--] = sorted[i];
    }
  }
  return result;
}

// ── Energy Bar Component ──
function EnergyBar({ energy, index, total, isHighest }) {
  const height = Math.max(8, energy * 100);
  const hue = energy * 40; // 0=red, 40=orange-yellow
  const saturation = 70 + energy * 30;
  const lightness = 40 + energy * 15;
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
      flex: 1, minWidth: 4, maxWidth: 24,
    }}>
      <div style={{
        width: "100%", borderRadius: 3,
        height: `${height}%`,
        background: `linear-gradient(to top, hsl(${hue}, ${saturation}%, ${lightness}%), hsl(${hue + 15}, ${saturation}%, ${lightness + 15}%))`,
        boxShadow: isHighest ? "0 0 12px rgba(255,140,0,0.6)" : "none",
        transition: "height 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
        transitionDelay: `${index * 40}ms`,
      }} />
    </div>
  );
}

// ── Track Row ──
function TrackRow({ track, index, onDragStart, onDragOver, onDrop }) {
  const energy = track.energy ?? 0;
  const hue = energy * 40;
  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(index); }}
      onDrop={() => onDrop(index)}
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
        background: "rgba(255,255,255,0.03)", borderRadius: 8,
        cursor: "grab", transition: "background 0.2s",
        borderLeft: `3px solid hsl(${hue}, 80%, 50%)`,
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
      onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
    >
      <span style={{ color: "#666", fontVariantNumeric: "tabular-nums", width: 28, fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
        {String(index + 1).padStart(2, "0")}
      </span>
      {track.albumArt && (
        <img src={track.albumArt} alt="" style={{ width: 40, height: 40, borderRadius: 4, objectFit: "cover" }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "#eee", fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "'Outfit', sans-serif" }}>
          {track.name}
        </div>
        <div style={{ color: "#888", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "'Outfit', sans-serif" }}>
          {track.artist}
        </div>
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <div style={{
          width: 60, height: 6, background: "rgba(255,255,255,0.1)", borderRadius: 3, overflow: "hidden",
        }}>
          <div style={{
            width: `${energy * 100}%`, height: "100%", borderRadius: 3,
            background: `linear-gradient(90deg, hsl(${hue}, 80%, 45%), hsl(${hue + 15}, 90%, 55%))`,
          }} />
        </div>
        <span style={{
          color: `hsl(${hue}, 80%, 60%)`, fontSize: 13, fontWeight: 600, width: 36, textAlign: "right",
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {energy.toFixed(2)}
        </span>
      </div>
      <div style={{ color: "#555", fontSize: 12, width: 40, textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
        {track.bpm ? `${track.bpm}` : "—"}
      </div>
      <div style={{ color: "#555", fontSize: 12, width: 44, textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
        {track.duration_ms
          ? `${Math.floor(track.duration_ms / 60000)}:${String(Math.floor((track.duration_ms % 60000) / 1000)).padStart(2, "0")}`
          : "—"}
      </div>
    </div>
  );
}

// ── Main App ──
export default function App() {
  const [clientId, setClientId] = useState("");
  const [token, setToken] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [sortedTracks, setSortedTracks] = useState([]);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [isSorted, setIsSorted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [view, setView] = useState("setup"); // setup | playlists | tracks
  const dragItem = useRef(null);
  const dragOverItem = useRef(null);

  // Check for token in URL on mount
  useEffect(() => {
    const hash = window.location.hash || window.location.search;
    const params = new URLSearchParams(hash.replace("#", "?"));
    const code = params.get("code");
    const storedVerifier = sessionStorage.getItem("pkce_verifier");
    const storedClientId = sessionStorage.getItem("spotify_client_id");

    if (code && storedVerifier && storedClientId) {
      setClientId(storedClientId);
      exchangeToken(code, storedVerifier, storedClientId);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  async function exchangeToken(code, verifier, cId) {
    try {
      setLoading("Authenticating...");
      const redirectUri = window.location.origin + window.location.pathname;
      const resp = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: cId,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        }),
      });
      const data = await resp.json();
      if (data.access_token) {
        setToken(data.access_token);
        setView("playlists");
      } else {
        setError("Auth failed: " + (data.error_description || data.error));
      }
    } catch (e) {
      setError("Token exchange failed: " + e.message);
    } finally {
      setLoading("");
    }
  }

  async function login() {
    if (!clientId.trim()) {
      setError("Bitte Client ID eingeben");
      return;
    }
    setError("");
    const verifier = generateRandomString(128);
    const challenge = base64urlencode(await sha256(verifier));
    sessionStorage.setItem("pkce_verifier", verifier);
    sessionStorage.setItem("spotify_client_id", clientId.trim());

    const redirectUri = window.location.origin + window.location.pathname;
    const params = new URLSearchParams({
      client_id: clientId.trim(),
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPES,
      code_challenge_method: "S256",
      code_challenge: challenge,
    });
    window.location.href = `${AUTH_URL}?${params}`;
  }

  async function spotifyFetch(url) {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`Spotify API ${resp.status}: ${resp.statusText}`);
    return resp.json();
  }

  // Load playlists
  useEffect(() => {
    if (!token) return;
    (async () => {
      setLoading("Playlists laden...");
      try {
        let all = [];
        let url = "https://api.spotify.com/v1/me/playlists?limit=50";
        while (url) {
          const data = await spotifyFetch(url);
          all = all.concat(data.items || []);
          url = data.next;
        }
        setPlaylists(all);
        setView("playlists");
      } catch (e) {
        setError("Playlists laden fehlgeschlagen: " + e.message);
      } finally {
        setLoading("");
      }
    })();
  }, [token]);

  // Load tracks + audio features
  async function loadPlaylist(playlist) {
    setSelectedPlaylist(playlist);
    setLoading("Tracks & Audio Features laden...");
    setError("");
    setIsSorted(false);
    setSaveSuccess(false);
    try {
      // Fetch all tracks
      let allItems = [];
      let url = `https://api.spotify.com/v1/playlists/${playlist.id}/tracks?limit=100`;
      while (url) {
        const data = await spotifyFetch(url);
        allItems = allItems.concat(data.items || []);
        url = data.next;
      }

      const validTracks = allItems.filter(i => i.track && i.track.id && !i.track.is_local);

      // Fetch audio features in batches of 100
      const trackIds = validTracks.map(i => i.track.id);
      let features = {};
      for (let i = 0; i < trackIds.length; i += 100) {
        const batch = trackIds.slice(i, i + 100);
        const data = await spotifyFetch(
          `https://api.spotify.com/v1/audio-features?ids=${batch.join(",")}`
        );
        if (data.audio_features) {
          data.audio_features.forEach(f => {
            if (f) features[f.id] = f;
          });
        }
      }

      const enriched = validTracks.map(item => {
        const t = item.track;
        const f = features[t.id] || {};
        return {
          id: t.id,
          uri: t.uri,
          name: t.name,
          artist: (t.artists || []).map(a => a.name).join(", "),
          albumArt: t.album?.images?.[2]?.url || t.album?.images?.[0]?.url,
          energy: f.energy ?? null,
          bpm: f.tempo ? Math.round(f.tempo) : null,
          danceability: f.danceability ?? null,
          valence: f.valence ?? null,
          duration_ms: t.duration_ms,
        };
      });

      setTracks(enriched);
      setSortedTracks(enriched);
      setView("tracks");
    } catch (e) {
      setError("Tracks laden fehlgeschlagen: " + e.message);
    } finally {
      setLoading("");
    }
  }

  function applySorting() {
    const sorted = pyramidSort(sortedTracks);
    setSortedTracks(sorted);
    setIsSorted(true);
  }

  function resetOrder() {
    setSortedTracks([...tracks]);
    setIsSorted(false);
  }

  // Drag & drop reorder
  function handleDragStart(index) { dragItem.current = index; }
  function handleDragOver(index) { dragOverItem.current = index; }
  function handleDrop() {
    const copy = [...sortedTracks];
    const dragged = copy.splice(dragItem.current, 1)[0];
    copy.splice(dragOverItem.current, 0, dragged);
    setSortedTracks(copy);
    dragItem.current = null;
    dragOverItem.current = null;
  }

  // Save sorted playlist back to Spotify
  async function saveToSpotify() {
    if (!selectedPlaylist || !sortedTracks.length) return;
    setSaving(true);
    setError("");
    try {
      // Create new playlist
      const me = await spotifyFetch("https://api.spotify.com/v1/me");
      const newPlaylist = await fetch(`https://api.spotify.com/v1/users/${me.id}/playlists`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `🚴 ${selectedPlaylist.name} (Pyramid Sorted)`,
          description: `Energy-Pyramide sortiert für Indoor Cycling. Generated by Cycling Playlist Sorter.`,
          public: false,
        }),
      }).then(r => r.json());

      // Add tracks in batches of 100
      const uris = sortedTracks.map(t => t.uri);
      for (let i = 0; i < uris.length; i += 100) {
        await fetch(`https://api.spotify.com/v1/playlists/${newPlaylist.id}/tracks`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
        });
      }
      setSaveSuccess(true);
    } catch (e) {
      setError("Speichern fehlgeschlagen: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Stats ──
  const avgEnergy = sortedTracks.length
    ? (sortedTracks.reduce((s, t) => s + (t.energy || 0), 0) / sortedTracks.length).toFixed(2)
    : "—";
  const avgBpm = sortedTracks.length
    ? Math.round(sortedTracks.filter(t => t.bpm).reduce((s, t) => s + t.bpm, 0) / sortedTracks.filter(t => t.bpm).length) || "—"
    : "—";
  const totalMin = sortedTracks.length
    ? Math.round(sortedTracks.reduce((s, t) => s + (t.duration_ms || 0), 0) / 60000)
    : 0;
  const maxEnergy = sortedTracks.length
    ? Math.max(...sortedTracks.map(t => t.energy || 0))
    : 0;

  // ── Render ──
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(145deg, #0a0a0f 0%, #111118 40%, #0d0d14 100%)",
      color: "#ddd",
      fontFamily: "'Outfit', sans-serif",
      position: "relative",
      overflow: "hidden",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* Ambient glow */}
      <div style={{
        position: "fixed", top: "-30%", right: "-20%", width: "60vw", height: "60vw",
        background: "radial-gradient(circle, rgba(255,100,0,0.06) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "fixed", bottom: "-20%", left: "-10%", width: "50vw", height: "50vw",
        background: "radial-gradient(circle, rgba(255,60,0,0.04) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 20px", position: "relative" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ fontSize: 14, letterSpacing: 6, color: "#ff6a00", fontWeight: 600, marginBottom: 8, textTransform: "uppercase" }}>
            Indoor Cycling
          </div>
          <h1 style={{
            fontSize: 36, fontWeight: 800, margin: 0, lineHeight: 1.1,
            background: "linear-gradient(135deg, #fff 0%, #ff8c42 50%, #ff4e00 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            fontFamily: "'Outfit', sans-serif",
          }}>
            Playlist Energy Sorter
          </h1>
          <div style={{ fontSize: 14, color: "#666", marginTop: 8 }}>
            Pyramiden-Sortierung: Warm-up → Peak → Cool-down
          </div>
        </div>

        {/* Setup View */}
        {view === "setup" && !token && (
          <div style={{
            background: "rgba(255,255,255,0.03)", borderRadius: 16, padding: 32,
            border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 0, color: "#eee" }}>Spotify verbinden</h2>
            <p style={{ color: "#888", fontSize: 14, lineHeight: 1.6, margin: "8px 0 20px" }}>
              Du brauchst eine Spotify App (kostenlos). Gehe zu{" "}
              <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener"
                style={{ color: "#ff6a00", textDecoration: "none" }}>
                developer.spotify.com/dashboard
              </a>{" "}
              → Create App → kopiere die Client ID hierhin. Setze als Redirect URI die URL dieser Seite.
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Spotify Client ID"
                style={{
                  flex: 1, padding: "12px 16px", borderRadius: 10,
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                  color: "#eee", fontSize: 14, outline: "none",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
                onFocus={(e) => e.target.style.borderColor = "rgba(255,106,0,0.4)"}
                onBlur={(e) => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
              />
              <button
                onClick={login}
                style={{
                  padding: "12px 28px", borderRadius: 10, border: "none",
                  background: "linear-gradient(135deg, #ff6a00, #ff4e00)",
                  color: "#fff", fontWeight: 600, fontSize: 14, cursor: "pointer",
                  fontFamily: "'Outfit', sans-serif",
                  transition: "transform 0.15s, box-shadow 0.15s",
                  boxShadow: "0 4px 20px rgba(255,106,0,0.3)",
                }}
                onMouseEnter={(e) => { e.target.style.transform = "translateY(-1px)"; e.target.style.boxShadow = "0 6px 24px rgba(255,106,0,0.4)"; }}
                onMouseLeave={(e) => { e.target.style.transform = ""; e.target.style.boxShadow = "0 4px 20px rgba(255,106,0,0.3)"; }}
              >
                Login
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.2)",
            borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#ff6b6b",
          }}>
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{
            textAlign: "center", padding: 40, color: "#ff6a00", fontSize: 15,
          }}>
            <div style={{
              width: 32, height: 32, border: "3px solid rgba(255,106,0,0.2)",
              borderTopColor: "#ff6a00", borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              margin: "0 auto 16px",
            }} />
            {loading}
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {/* Playlist Selection */}
        {view === "playlists" && !loading && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: "#eee", marginBottom: 16 }}>
              Playlist wählen ({playlists.length})
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {playlists.map((p) => (
                <button
                  key={p.id}
                  onClick={() => loadPlaylist(p)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
                    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 10, cursor: "pointer", textAlign: "left", color: "#ddd",
                    transition: "background 0.2s, border-color 0.2s",
                    fontFamily: "'Outfit', sans-serif",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,106,0,0.08)"; e.currentTarget.style.borderColor = "rgba(255,106,0,0.2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}
                >
                  {p.images?.[0]?.url ? (
                    <img src={p.images[0].url} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: 6, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 18 }}>♫</div>
                  )}
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{p.name}</div>
                    <div style={{ color: "#666", fontSize: 12 }}>{p.tracks?.total || 0} Tracks</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Track View */}
        {view === "tracks" && !loading && sortedTracks.length > 0 && (
          <div>
            {/* Back button + playlist name */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <button
                onClick={() => { setView("playlists"); setTracks([]); setSortedTracks([]); setSelectedPlaylist(null); }}
                style={{
                  background: "rgba(255,255,255,0.06)", border: "none", color: "#aaa",
                  padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13,
                  fontFamily: "'Outfit', sans-serif",
                }}
              >
                ← Zurück
              </button>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: "#eee", margin: 0 }}>
                {selectedPlaylist?.name}
              </h2>
            </div>

            {/* Stats */}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24,
            }}>
              {[
                { label: "Tracks", value: sortedTracks.length },
                { label: "⌀ Energy", value: avgEnergy },
                { label: "⌀ BPM", value: avgBpm },
                { label: "Dauer", value: `${totalMin} min` },
              ].map((s) => (
                <div key={s.label} style={{
                  background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 14px",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}>
                  <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#ff8c42", fontFamily: "'JetBrains Mono', monospace" }}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Energy Visualization */}
            <div style={{
              background: "rgba(255,255,255,0.02)", borderRadius: 12, padding: "20px 16px",
              border: "1px solid rgba(255,255,255,0.05)", marginBottom: 20,
            }}>
              <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                Energy Kurve {isSorted ? "⚡ Pyramid" : "· Original"}
              </div>
              <div style={{
                display: "flex", alignItems: "flex-end", gap: 2, height: 80,
              }}>
                {sortedTracks.map((t, i) => (
                  <EnergyBar
                    key={`${t.id}-${i}`}
                    energy={t.energy || 0}
                    index={i}
                    total={sortedTracks.length}
                    isHighest={(t.energy || 0) === maxEnergy}
                  />
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
              <button
                onClick={isSorted ? resetOrder : applySorting}
                style={{
                  padding: "10px 24px", borderRadius: 10, border: "none",
                  background: isSorted ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg, #ff6a00, #ff4e00)",
                  color: isSorted ? "#ccc" : "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer",
                  fontFamily: "'Outfit', sans-serif",
                  boxShadow: isSorted ? "none" : "0 4px 20px rgba(255,106,0,0.3)",
                }}
              >
                {isSorted ? "↩ Reset" : "⚡ Pyramide sortieren"}
              </button>
              {isSorted && (
                <button
                  onClick={saveToSpotify}
                  disabled={saving || saveSuccess}
                  style={{
                    padding: "10px 24px", borderRadius: 10, border: "none",
                    background: saveSuccess
                      ? "linear-gradient(135deg, #00c853, #00a844)"
                      : "linear-gradient(135deg, #ff6a00, #ff4e00)",
                    color: "#fff", fontWeight: 600, fontSize: 13, cursor: saving ? "wait" : "pointer",
                    fontFamily: "'Outfit', sans-serif",
                    boxShadow: "0 4px 20px rgba(255,106,0,0.3)",
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saveSuccess ? "✓ Gespeichert!" : saving ? "Speichern..." : "💾 Als neue Playlist speichern"}
                </button>
              )}
            </div>

            {/* Track List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {/* Header */}
              <div style={{
                display: "flex", alignItems: "center", gap: 12, padding: "6px 16px",
                fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 1,
              }}>
                <span style={{ width: 28 }}>#</span>
                <span style={{ width: 40 }}></span>
                <span style={{ flex: 1 }}>Track</span>
                <span style={{ width: 100, textAlign: "right" }}>Energy</span>
                <span style={{ width: 40, textAlign: "right" }}>BPM</span>
                <span style={{ width: 44, textAlign: "right" }}>Zeit</span>
              </div>
              {sortedTracks.map((t, i) => (
                <TrackRow
                  key={`${t.id}-${i}`}
                  track={t}
                  index={i}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
