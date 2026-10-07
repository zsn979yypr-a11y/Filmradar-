// BTC Widget für Scriptable (iPhone) · wird vom Starter-Skript automatisch geladen
// Preis (Coinbase), 3 Ringe: Stimmung (Fear & Greed), Power Law, Halving-Zyklus.
// Antippen öffnet das Bitcoin-Dashboard. Keine Anlageberatung.
const VERSION = "v2"
const DASHBOARD_URL = "https://claude.ai/artifact/3jQ1DfuBSzUFEx6Rrz5vkd"

const C = {
  bg: new Color("#000000"), card: new Color("#1C1C1E"), track: new Color("#2C2C2E"),
  fg: new Color("#FFFFFF"), muted: new Color("#98989F"),
  orange: new Color("#FF9F0A"), green: new Color("#30D158"), mint: new Color("#7FD9A8"),
  yellow: new Color("#FFD60A"), red: new Color("#FF453A"), coral: new Color("#FF6961"), blue: new Color("#0A84FF"),
}

// ---------- Daten ----------
async function json(url) { const r = new Request(url); r.timeoutInterval = 12; return await r.loadJSON() }
const fm = FileManager.local()
const cacheFile = fm.joinPath(fm.documentsDirectory(), "btc-widget-cache.json")
let cache = {}
try { if (fm.fileExists(cacheFile)) cache = JSON.parse(fm.readString(cacheFile)) } catch (e) {}

let price = null, ref24 = null, fng = null, eur = null
try { price = parseFloat((await json("https://api.coinbase.com/v2/prices/BTC-USD/spot")).data.amount) } catch (e) {}
try {
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
  ref24 = parseFloat((await json("https://api.coinbase.com/v2/prices/BTC-USD/spot?date=" + y)).data.amount)
} catch (e) {}
try { eur = parseFloat((await json("https://api.coinbase.com/v2/prices/BTC-EUR/spot")).data.amount) } catch (e) {}
try { const f = (await json("https://api.alternative.me/fng/?limit=1")).data[0]; fng = parseInt(f.value) } catch (e) {}

const live = price != null
if (live) cache = { price, ref24, eur, fng: fng ?? cache.fng, t: Date.now() }
else if (cache.price) { price = cache.price; ref24 = cache.ref24; eur = cache.eur }
if (fng == null) fng = cache.fng ?? null
try { fm.writeString(cacheFile, JSON.stringify(cache)) } catch (e) {}

// ---------- Modelle ----------
const DAY = 864e5
const GENESIS = Date.UTC(2009, 0, 3)
const PL = (t) => 1.0117e-17 * Math.pow((t - GENESIS) / DAY, 5.82)
const now = Date.now(), T = PL(now), flo = T * 0.42
const plPos = price ? Math.max(0, Math.min(100, Math.log(price / flo) / Math.log(T / flo) * 100)) : null
const H0 = Date.UTC(2024, 3, 20), H1 = Date.UTC(2028, 3, 15)
const LEN = Math.round((H1 - H0) / DAY), tag = Math.floor((now - H0) / DAY)
const phase = tag < 365 ? "Anstieg" : tag < 550 ? "Hoch-Fenster" : tag < 775 ? "Bärenmarkt" : tag < 930 ? "Boden-Fenster" : "Aufbau"

const fngText = (v) => v < 25 ? "Extr. Angst" : v < 45 ? "Angst" : v < 55 ? "Neutral" : v < 75 ? "Gier" : "Extr. Gier"
const fngColor = (v) => v < 25 ? C.red : v < 45 ? C.coral : v < 55 ? C.yellow : C.green
const plText = (v) => v < 20 ? "am Floor" : v < 45 ? "günstig" : v < 70 ? "Median" : v < 95 ? "erhöht" : "über Trend"
const plColor = (v) => v < 20 ? C.green : v < 45 ? C.mint : v < 70 ? C.yellow : v < 95 ? C.orange : C.red

// ---------- Ring zeichnen ----------
function ring(value, max, color, center, size) {
  const s = size * 3, lw = s * 0.11, r = s / 2 - lw / 2 - 1
  const ctx = new DrawContext()
  ctx.size = new Size(s, s); ctx.opaque = false; ctx.respectScreenScale = false
  const arc = (from, to, col) => {
    const p = new Path(), n = Math.max(2, Math.ceil((to - from) * 90))
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + 2 * Math.PI * (from + (to - from) * i / n)
      const pt = new Point(s / 2 + r * Math.cos(a), s / 2 + r * Math.sin(a))
      i ? p.addLine(pt) : p.move(pt)
    }
    ctx.addPath(p); ctx.setStrokeColor(col); ctx.setLineWidth(lw); ctx.strokePath()
  }
  arc(0, 1, C.track)
  const f = Math.max(0.001, Math.min(1, value / max))
  if (value != null) {
    arc(0, f, color)
    // runde Enden
    for (const q of [0, f]) {
      const a = -Math.PI / 2 + 2 * Math.PI * q
      ctx.setFillColor(color)
      ctx.fillEllipse(new Rect(s / 2 + r * Math.cos(a) - lw / 2, s / 2 + r * Math.sin(a) - lw / 2, lw, lw))
    }
  }
  ctx.setTextAlignedCenter(); ctx.setTextColor(C.fg)
  const fs = s * (String(center).length > 3 ? 0.24 : 0.3)
  ctx.setFont(Font.boldRoundedSystemFont(fs))
  ctx.drawTextInRect(String(center), new Rect(0, s / 2 - fs * 0.62, s, fs * 1.3))
  return ctx.getImage()
}

// ---------- Widget ----------
let fam = config.widgetFamily || "medium"
if (!config.runsInWidget) {
  const a = new Alert(); a.title = "Vorschau (" + VERSION + ")"
  a.addAction("Klein"); a.addAction("Mittel"); a.addAction("Groß")
  fam = ["small", "medium", "large"][await a.presentSheet()] || "medium"
}
const w = new ListWidget()
w.backgroundColor = C.bg
w.url = DASHBOARD_URL
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000)
const usd = (v) => "$" + Math.round(v).toLocaleString("de-DE")
const pct = (v) => (v >= 0 ? "+" : "") + v.toFixed(1).replace(".", ",") + " %"

function center(stack) { const s = stack.addStack(); s.layoutHorizontally(); s.addSpacer(); return s }
function endCenter(s) { s.addSpacer() }

function kopf(parent, small) {
  const h = center(parent); h.centerAlignContent()
  const b = h.addText("₿ "); b.font = Font.boldRoundedSystemFont(small ? 11 : 12); b.textColor = C.orange
  const t = h.addText(live ? new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "offline")
  t.font = Font.mediumSystemFont(small ? 10 : 11); t.textColor = live ? C.muted : C.red
  endCenter(h)
}

function preis(parent, gr) {
  const p = center(parent)
  const t = p.addText(price ? usd(price) : "—")
  t.font = Font.boldRoundedSystemFont(gr); t.textColor = C.fg; t.lineLimit = 1; t.minimumScaleFactor = 0.5
  endCenter(p)
  if (ref24 && price) {
    const c = center(parent)
    const ch = (price / ref24 - 1) * 100
    const x = c.addText(pct(ch) + " 24h" + (eur && fam !== "small" ? "  ·  " + Math.round(eur).toLocaleString("de-DE") + " €" : ""))
    x.font = Font.semiboldSystemFont(gr > 30 ? 12 : 10); x.textColor = ch >= 0 ? C.green : C.red; x.lineLimit = 1
    endCenter(c)
  }
}

function ringe(parent, size, mitText) {
  const r = parent.addStack(); r.layoutHorizontally(); r.addSpacer()
  const items = [
    [fng, 100, fng != null ? fngColor(fng) : C.muted, fng ?? "–", "Stimmung", fng != null ? fngText(fng) : ""],
    [plPos, 100, plPos != null ? plColor(plPos) : C.muted, plPos != null ? Math.round(plPos) : "–", "Power Law", plPos != null ? plText(plPos) : ""],
    [tag, LEN, C.blue, Math.round(tag / LEN * 100) + "%", "Halving", phase],
  ]
  items.forEach(([v, mx, col, ctr, lbl, sub], i) => {
    const s = r.addStack(); s.layoutVertically(); s.centerAlignContent()
    const ic = s.addStack(); ic.addSpacer(); const im = ic.addImage(ring(v, mx, col, ctr, size)); im.imageSize = new Size(size, size); ic.addSpacer()
    if (mitText) {
      s.addSpacer(3)
      const a = s.addStack(); a.addSpacer(); const l = a.addText(lbl); l.font = Font.semiboldSystemFont(10); l.textColor = C.fg; a.addSpacer()
      const b = s.addStack(); b.addSpacer(); const u = b.addText(sub); u.font = Font.mediumSystemFont(9); u.textColor = col; u.lineLimit = 1; u.minimumScaleFactor = 0.7; b.addSpacer()
    }
    r.addSpacer()
  })
}

if (fam === "small") {
  w.setPadding(10, 8, 10, 8)
  kopf(w, true)
  w.addSpacer(4)
  preis(w, 22)
  w.addSpacer()
  ringe(w, 38, false)
} else if (fam === "medium") {
  w.setPadding(10, 12, 10, 12)
  kopf(w, false)
  w.addSpacer(2)
  preis(w, 28)
  w.addSpacer(6)
  ringe(w, 46, true)
  w.addSpacer()
} else {
  w.setPadding(16, 14, 16, 14)
  kopf(w, false)
  w.addSpacer(8)
  preis(w, 40)
  w.addSpacer(16)
  ringe(w, 74, true)
  w.addSpacer()
  const n = center(w)
  const t = n.addText(`Power Law: Floor ${usd(flo)} · Trend ${usd(T)}`)
  t.font = Font.mediumSystemFont(11); t.textColor = C.muted; t.lineLimit = 1; t.minimumScaleFactor = 0.7
  endCenter(n)
  w.addSpacer(4)
  const d = center(w)
  const z = d.addText("Historische Einordnung · keine Anlageberatung")
  z.font = Font.systemFont(9); z.textColor = new Color("#6E6E73")
  endCenter(d)
}

if (config.runsInWidget) Script.setWidget(w)
else if (fam === "small") await w.presentSmall()
else if (fam === "large") await w.presentLarge()
else await w.presentMedium()
Script.complete()
