// FILMRADAR · Kino-Widget für Scriptable (iPhone)
// Zeigt Vorschläge passend zu deinen Lieblingsfilmen, mit Plakaten, in Deutschland verfügbar.
//
// LAUNE: Widget lange drücken > "Widget bearbeiten" > bei "Parameter" ein Wort eintragen:
//   Sci-Fi, Thriller, Action, Mystery, Horror, Drama, Komödie, Krimi, Doku, Animation, Abenteuer
//   Leer = alles. Mit Zahl strenger, z. B. "Thriller 7,5".
// GRÖSSEN: klein = 1 Film als großes Plakat, mittel = 3 Plakate, groß = 6 Plakate.

const LIEBLINGSFILME = [
  ["Companion", 2025], ["Terminator 2", 1991], ["Upgrade", 2018], ["District 9", 2009],
  ["Inception", 2010], ["The Creator", 2023], ["Mortal Engines", 2018], ["Arrival", 2016],
  ["Tetris", 2023], ["The Social Network", 2010]
]
// GESEHEN: Filme, die nicht mehr vorgeschlagen werden sollen (Titel wie im Widget).
const GESEHEN = [
]

const VERSION = "v5"
const FILMRADAR_URL = "https://zsn979yypr-a11y.github.io/Filmradar-/"
const MIN_IMDB_STANDARD = 7.0
const CACHE_STUNDEN = 8
const GEHEIMTIPPS = true

const LAUNEN = {
  "sci-fi": 878, "scifi": 878, "science": 878, "thriller": 53, "action": 28, "mystery": 9648,
  "horror": 27, "drama": 18, "komödie": 35, "komoedie": 35, "comedy": 35, "krimi": 80,
  "doku": 99, "animation": 16, "abenteuer": 12, "fantasy": 14
}

// ---------- Kino-Farben ----------
const SAMT_OBEN = new Color("#3B0A16")   // Kinovorhang
const SAMT_UNTEN = new Color("#0B0D12")  // dunkler Saal
const GOLD = new Color("#F2C14E")        // Popcorn / Leuchtschrift
const WEISS = new Color("#F4F1EA")
const GRAU = new Color("#B9B3AA")

// ---------- Schlüssel ----------
async function schluessel(name, titel, hinweis) {
  if (Keychain.contains(name)) return Keychain.get(name)
  if (config.runsInWidget) return null
  const a = new Alert()
  a.title = titel
  a.message = hinweis
  a.addTextField("Hier einfügen")
  a.addAction("Speichern")
  a.addCancelAction("Abbrechen")
  if (await a.presentAlert() === -1) return null
  const wert = a.textFieldValue(0).trim()
  if (!wert) return null
  Keychain.set(name, wert)
  return wert
}

// ---------- Dateien ----------
const fm = FileManager.local()
const pfad = (n) => fm.joinPath(fm.documentsDirectory(), n)
function lesen(n) { try { return fm.fileExists(pfad(n)) ? JSON.parse(fm.readString(pfad(n))) : null } catch (e) { return null } }
function schreiben(n, d) { try { fm.writeString(pfad(n), JSON.stringify(d)) } catch (e) {} }

// ---------- Datenquellen ----------
async function tmdb(weg, params, key) {
  const teile = Object.entries(params || {}).map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
  const istToken = key.length > 60
  if (!istToken) teile.push(`api_key=${key}`)
  const req = new Request(`https://api.themoviedb.org/3${weg}?${teile.join("&")}`)
  req.timeoutInterval = 15
  if (istToken) req.headers = { Authorization: `Bearer ${key}`, accept: "application/json" }
  const j = await req.loadJSON()
  if (j && j.success === false) {
    const f = new Error(j.status_message || "TMDB-Fehler")
    f.tmdbSchluessel = j.status_code === 7 || j.status_code === 3 || /api key|authentication/i.test(j.status_message || "")
    throw f
  }
  return j
}

// Merkt sich, woran es lag, falls keine Vorschläge kommen
const diag = { favs: 0, kandidaten: 0, inDE: 0, zuNiedrig: 0, fehler: null, schluesselFalsch: false }

// OMDb sparsam: Werte 30 Tage merken, bei Tageslimit nicht weiterfragen
const omdbSpeicher = lesen("filmradar-omdb.json") || {}
let omdbGesperrt = false
async function omdb(imdbId, key) {
  const h = omdbSpeicher[imdbId]
  if (h && Date.now() - h.t < 30 * 864e5) return h
  if (omdbGesperrt) return h || null
  try {
    const req = new Request(`https://www.omdbapi.com/?i=${imdbId}&apikey=${key}`)
    req.timeoutInterval = 15
    const j = await req.loadJSON()
    if (j.Response === "False") {
      if (/limit|key/i.test(j.Error || "")) omdbGesperrt = true
      return h || null
    }
    const rtE = (j.Ratings || []).find(x => (x.Source || "").includes("Rotten"))
    const v = { t: Date.now(), imdb: parseFloat(j.imdbRating) || null, rt: rtE ? parseInt(rtE.Value) : null }
    omdbSpeicher[imdbId] = v
    return v
  } catch (e) { return h || null }
}

function anbieterKurz(de) {
  if (!de) return null
  const erster = (liste) => (liste && liste.length) ? liste[0].provider_name.replace("Amazon Prime Video", "Prime Video") : null
  if (erster(de.flatrate)) return erster(de.flatrate)
  const gratis = [...(de.free || []), ...(de.ads || [])]
  if (gratis.length) return "Gratis · " + erster(gratis)
  if (de.rent && de.rent.length) return "Leihen"
  if (de.buy && de.buy.length) return "Kaufen"
  return null
}

async function favoritenIds(key) {
  const gemerkt = lesen("filmradar-favs.json") || {}
  const ergebnis = []
  for (const [titel, jahr] of LIEBLINGSFILME) {
    const k = `${titel}|${jahr}`
    if (!gemerkt[k]) {
      try {
        const r = await tmdb("/search/movie", { query: titel, year: jahr, language: "de-DE" }, key)
        const m = (r.results || [])[0]
        if (m) gemerkt[k] = { id: m.id, titel: m.title }
      } catch (e) {
        diag.fehler = e.message || String(e)
        if (e.tmdbSchluessel) diag.schluesselFalsch = true
      }
    }
    if (gemerkt[k]) ergebnis.push(gemerkt[k])
  }
  schreiben("filmradar-favs.json", gemerkt)
  return ergebnis
}

async function vorschlaegeLaden(tmdbKey, omdbKey, genre, minImdb) {
  const favs = await favoritenIds(tmdbKey)
  diag.favs = favs.length
  if (!favs.length) return []
  const favIds = new Set(favs.map(f => f.id))
  const gesehen = new Set(GESEHEN.map(t => t.toLowerCase().trim()))
  const listen = await Promise.all(favs.map(f =>
    tmdb(`/movie/${f.id}/recommendations`, { language: "de-DE" }, tmdbKey)
      .then(r => ({ f, r: r.results || [] })).catch(() => ({ f, r: [] }))))
  const punkte = new Map()
  for (const { f, r } of listen) {
    r.forEach((m, i) => {
      if (favIds.has(m.id)) return
      const e = punkte.get(m.id) || { m, s: 0, weil: [] }
      e.s += 1 + (20 - i) / 20
      if (!e.weil.includes(f.titel)) e.weil.push(f.titel)
      punkte.set(m.id, e)
    })
  }
  const kandidaten = [...punkte.values()]
    .filter(e => (e.m.vote_count || 0) >= 200 && (e.m.vote_average || 0) >= 6.3 && e.m.poster_path)
    .filter(e => !gesehen.has((e.m.title || "").toLowerCase()) && !gesehen.has((e.m.original_title || "").toLowerCase()))
    .filter(e => !genre || (e.m.genre_ids || []).includes(genre))
    .map(e => {
      let s = e.s + (e.m.vote_average - 7) * 0.4
      if (GEHEIMTIPPS && e.m.vote_count > 10000) s -= 1.2
      if (GEHEIMTIPPS && e.m.vote_count > 25000) s -= 1.2
      return { ...e, s }
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, 30)
  diag.kandidaten = kandidaten.length

  const fertig = []
  for (let i = 0; i < kandidaten.length && fertig.length < 14; i += 10) {
    const gruppe = kandidaten.slice(i, i + 10)
    const geprueft = await Promise.all(gruppe.map(async e => {
      try {
        const [prov, ext] = await Promise.all([
          tmdb(`/movie/${e.m.id}/watch/providers`, {}, tmdbKey),
          tmdb(`/movie/${e.m.id}/external_ids`, {}, tmdbKey)
        ])
        const wo = anbieterKurz(prov.results && prov.results.DE)
        if (!wo) return null
        diag.inDE++
        const o = ext.imdb_id ? await omdb(ext.imdb_id, omdbKey) : null
        // IMDb, wenn vorhanden; sonst TMDB-Wertung als Ersatz (z. B. bei OMDb-Tageslimit)
        const wert = o && o.imdb != null ? o.imdb : e.m.vote_average
        const quelle = o && o.imdb != null ? "IMDb" : "TMDB"
        if (wert < minImdb) { diag.zuNiedrig++; return null }
        return { id: e.m.id, titel: e.m.title, wert, quelle, rt: o ? o.rt : null, wo, poster: e.m.poster_path, weil: e.weil.slice(0, 2) }
      } catch (err) { diag.fehler = err.message || String(err); return null }
    }))
    fertig.push(...geprueft.filter(Boolean))
  }
  schreiben("filmradar-omdb.json", omdbSpeicher)
  return fertig
}

// ---------- Plakate (werden auf dem iPhone gespeichert) ----------
const plakatFehler = []
async function plakat(film, breite) {
  if (!film || !film.poster) { plakatFehler.push(`${film ? film.titel : "?"}: kein Plakat-Pfad`); return null }
  const datei = pfad(`filmradar-plakat-${film.id}.jpg`)
  // Gespeichertes Plakat nehmen (iCloud-Dateien erst herunterladen)
  try {
    if (fm.fileExists(datei)) {
      if (fm.isFileStoredIniCloud && fm.isFileStoredIniCloud(datei) && !fm.isFileDownloaded(datei)) await fm.downloadFileFromiCloud(datei)
      const alt = fm.readImage(datei)
      if (alt && alt.size && alt.size.width > 10) return alt
      fm.remove(datei)
    }
  } catch (e) {}
  // Mehrere Größen probieren – kleinere Dateien klappen auch bei schwachem Netz
  const pfadTeil = film.poster.startsWith("/") ? film.poster : "/" + film.poster
  for (const b of [...new Set([breite, 185, 154, 92])]) {
    try {
      const req = new Request(`https://image.tmdb.org/t/p/w${b}${pfadTeil}`)
      req.timeoutInterval = 8
      const img = await req.loadImage()
      if (img && img.size && img.size.width > 10) {
        try { fm.writeImage(datei, img) } catch (e) {}
        return img
      }
    } catch (e) { plakatFehler.push(`${film.titel} (w${b}): ${e.message || e}`) }
  }
  return null
}

// Platzhalter, falls ein Plakat nicht lädt
function platzhalter(b, h) {
  const ctx = new DrawContext()
  ctx.size = new Size(b * 3, h * 3)
  ctx.opaque = false
  const p = new Path()
  p.addRoundedRect(new Rect(0, 0, b * 3, h * 3), 18, 18)
  ctx.addPath(p); ctx.setFillColor(new Color("#2A0E18")); ctx.fillPath()
  const s = symbol("popcorn.fill", "film.fill")
  if (s) {
    const g = b * 1.4
    ctx.drawImageInRect(s.image, new Rect((b * 3 - g) / 2, (h * 3 - g) / 2, g, g))
  }
  return ctx.getImage()
}

// Plakate nacheinander laden (parallel bricht das Widget manchmal ab)
async function plakateLaden(liste, breite) {
  const out = []
  for (const f of liste) out.push(await plakat(f, breite))
  return out
}

// Kleines Widget: Plakat als Hintergrund, unten abgedunkelt, damit die Schrift lesbar bleibt
function plakatHintergrund(img) {
  const g = 360
  const ctx = new DrawContext()
  ctx.size = new Size(g, g)
  ctx.opaque = true
  ctx.setFillColor(SAMT_UNTEN)
  ctx.fillRect(new Rect(0, 0, g, g))
  const h = g * 1.5
  ctx.drawImageInRect(img, new Rect(0, -h * 0.12, g, h))
  for (let i = 0; i < 24; i++) {
    const y = g * 0.35 + i * (g * 0.65 / 24)
    ctx.setFillColor(new Color("#0B0D12", Math.min(0.92, i / 24 + 0.05)))
    ctx.fillRect(new Rect(0, y, g, g * 0.65 / 24 + 1))
  }
  return ctx.getImage()
}

// ---------- Widget bauen ----------
function symbol(name, ersatz) {
  try { const s = SFSymbol.named(name); if (s && s.image) return s } catch (e) {}
  return ersatz ? SFSymbol.named(ersatz) : null
}

function kopfzeile(w, launeText, klein) {
  const k = w.addStack()
  k.centerAlignContent()
  const s = symbol("popcorn.fill", "film.fill")
  if (s) {
    s.applyHeavyWeight()
    const i = k.addImage(s.image)
    i.imageSize = new Size(klein ? 13 : 16, klein ? 13 : 16)
    i.tintColor = GOLD
    k.addSpacer(5)
  }
  const t = k.addText("FILMRADAR")
  t.font = Font.heavySystemFont(klein ? 12 : 14)
  t.textColor = GOLD
  const v = k.addText(" " + VERSION)
  v.font = Font.systemFont(8); v.textColor = GRAU
  k.addSpacer()
  if (launeText) {
    const l = k.addText(launeText.toUpperCase())
    l.font = Font.boldSystemFont(10)
    l.textColor = GRAU
  }
}

function wertText(f) {
  return `★ ${String(f.wert.toFixed(1)).replace(".", ",")}${f.quelle === "TMDB" ? " TMDB" : ""}`
}

async function widgetBauen(filme, launeText, meldung, familie) {
  const w = new ListWidget()
  const verlauf = new LinearGradient()
  verlauf.colors = [SAMT_OBEN, SAMT_UNTEN]
  verlauf.locations = [0, 0.75]
  w.backgroundGradient = verlauf
  w.url = FILMRADAR_URL
  w.refreshAfterDate = new Date(Date.now() + 3 * 3600 * 1000)

  // Sperrbildschirm
  if (familie.startsWith("accessory")) {
    const t = w.addText(filme[0] ? `🍿 ${filme[0].titel} · ${wertText(filme[0])}` : "🍿 Filmradar")
    t.font = Font.semiboldSystemFont(12)
    return w
  }

  if (meldung || !filme.length) {
    w.setPadding(14, 14, 14, 14)
    kopfzeile(w, launeText, familie === "small")
    w.addSpacer(8)
    const m = w.addText(meldung || "Gerade keine passenden Vorschläge. Probier eine andere Laune oder eine niedrigere Wertung.")
    m.font = Font.systemFont(12); m.textColor = GRAU
    w.addSpacer()
    return w
  }

  // Jeden Tag andere Filme zuerst
  const anzahl = { small: 1, medium: 3, large: 6, extraLarge: 6 }[familie] || 3
  const tag = Math.floor(Date.now() / 864e5)
  const start = filme.length > anzahl ? (tag * anzahl) % filme.length : 0
  const auswahl = [...filme.slice(start), ...filme.slice(0, start)].slice(0, anzahl)

  // ---- Klein: ein Film, Plakat als Hintergrund ----
  if (familie === "small") {
    const f = auswahl[0]
    const img = await plakat(f, 342)
    if (img) w.backgroundImage = plakatHintergrund(img)
    w.setPadding(12, 12, 12, 12)
      kopfzeile(w, "", true)
    w.addSpacer()
    const t = w.addText(f.titel)
    t.font = Font.heavySystemFont(15); t.textColor = WEISS; t.lineLimit = 2; t.minimumScaleFactor = 0.8
    const u = w.addText(`${wertText(f)} · ${f.wo}`)
    u.font = Font.semiboldSystemFont(11); u.textColor = GOLD; u.lineLimit = 1; u.minimumScaleFactor = 0.8
    return w
  }

  // ---- Mittel und groß: Plakat-Reihen wie im Kinoprogramm ----
  w.setPadding(12, 12, 10, 12)
  kopfzeile(w, launeText, false)
  w.addSpacer(familie === "medium" ? 6 : 8)

  const reihen = familie === "medium" ? 1 : 2
  const pB = familie === "medium" ? 54 : 68        // Plakatbreite in Punkten
  const pH = Math.round(pB * 1.5)
  const bilder = await plakateLaden(auswahl, 185)

  for (let r = 0; r < reihen; r++) {
    const reihe = w.addStack()
    reihe.layoutHorizontally()
    reihe.topAlignContent()
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c
      const f = auswahl[idx]
      if (!f) break
      const karte = reihe.addStack()
      karte.layoutVertically()
      karte.size = new Size(96, 0)
      const i = karte.addImage(bilder[idx] || platzhalter(pB, pH))
      i.imageSize = new Size(pB, pH)
      i.cornerRadius = 6
      karte.addSpacer(3)
      const t = karte.addText(f.titel)
      t.font = Font.boldSystemFont(10); t.textColor = WEISS; t.lineLimit = 1
      const u = karte.addText(familie === "medium" ? wertText(f) : `${wertText(f)} · ${f.wo}`)
      u.font = Font.semiboldSystemFont(9); u.textColor = GOLD; u.lineLimit = 1
      if (c < 2) reihe.addSpacer()
    }
    if (r < reihen - 1) w.addSpacer(8)
  }
  w.addSpacer()
  if (familie !== "medium") {
    const fuss = w.addText(`Weil du ${auswahl[0].weil.join(" und ")} mochtest`)
    fuss.font = Font.italicSystemFont(10); fuss.textColor = GRAU; fuss.lineLimit = 1
  }
  return w
}

// ---------- Ablauf ----------
const roh = (args.widgetParameter || "").trim()
const zahl = parseFloat((roh.match(/\d+([.,]\d+)?/) || [""])[0].replace(",", "."))
const minImdb = isNaN(zahl) ? MIN_IMDB_STANDARD : zahl
const wort = roh.replace(/\d+([.,]\d+)?/, "").trim().toLowerCase()
const genre = LAUNEN[wort] || null
const launeText = genre ? roh.replace(/\d+([.,]\d+)?/, "").trim() : ""

const tmdbKey = await schluessel("filmradar_tmdb", "TMDB-Schlüssel", "Den API Key von themoviedb.org hier einfügen.")
const omdbKey = await schluessel("filmradar_omdb", "OMDb-Schlüssel", "Den Schlüssel aus der OMDb-Mail hier einfügen.")

let filme = []
let meldung = null
const cacheName = `filmradar-kino-${genre || "alle"}-${minImdb}.json`

if (!tmdbKey || !omdbKey) {
  meldung = "Bitte das Skript einmal in der Scriptable-App öffnen und die zwei Schlüssel eintragen."
} else {
  const cache = lesen(cacheName)
  const frisch = cache && (Date.now() - cache.zeit) < CACHE_STUNDEN * 3600 * 1000 && cache.filme.every(f => f.poster)
  if (frisch) {
    filme = cache.filme
  } else {
    try {
      filme = await vorschlaegeLaden(tmdbKey, omdbKey, genre, minImdb)
      if (filme.length) schreiben(cacheName, { zeit: Date.now(), filme })
      else if (cache) filme = cache.filme
      if (!filme.length) meldung = grundText(minImdb)
    } catch (e) {
      if (cache) filme = cache.filme
      else meldung = "Laden hat nicht geklappt. Öffne das Skript einmal in der Scriptable-App."
    }
  }
}

function grundText(min) {
  if (diag.schluesselFalsch) return "Der TMDB-Schlüssel wird nicht angenommen. Skript in Scriptable starten und den Schlüssel neu eintragen."
  if (!diag.favs) return "TMDB antwortet nicht" + (diag.fehler ? ` (${diag.fehler})` : "") + ". Später nochmal versuchen."
  if (!diag.kandidaten) return "Für diese Laune gibt es gerade keine Vorschläge. Parameter im Widget leeren."
  if (!diag.inDE) return "Keiner der Vorschläge ist gerade in Deutschland streambar."
  return `Kein Vorschlag erreicht ${String(min).replace(".", ",")}. Im Widget-Parameter eine kleinere Zahl eintragen, z. B. 6,5.`
}

// Falscher Schlüssel: in der App direkt neu abfragen
if (!config.runsInWidget && diag.schluesselFalsch) {
  Keychain.remove("filmradar_tmdb")
  const a = new Alert()
  a.title = "TMDB-Schlüssel falsch"
  a.message = "Der gespeicherte TMDB-Schlüssel funktioniert nicht. Starte das Skript gleich nochmal mit ▶︎ – dann kannst du ihn neu einfügen."
  a.addAction("OK")
  await a.present()
}

if (config.runsInWidget) {
  Script.setWidget(await widgetBauen(filme, launeText, meldung, config.widgetFamily || "large"))
} else {
  // Vorschau in der App: Auswahl der Größe
  const a = new Alert()
  a.title = "Vorschau"
  a.addAction("Klein"); a.addAction("Mittel"); a.addAction("Groß")
  const g = await a.presentSheet()
  const v = await widgetBauen(filme, launeText, meldung, ["small", "medium", "large"][g] || "large")
  if (g === 0) await v.presentSmall()
  else if (g === 1) await v.presentMedium()
  else await v.presentLarge()
  // Kurzer Check, ob die Plakate geladen wurden
  if (plakatFehler.length && filme.length) {
    const d = new Alert()
    d.title = "Plakate: Problem"
    d.message = plakatFehler.slice(0, 4).join("\n")
    d.addAction("OK")
    await d.present()
  }
}
Script.complete()
