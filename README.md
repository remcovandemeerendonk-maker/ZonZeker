# ☀️ ZonZeker

**Waar schijnt de zon de komende dagen, binnen jouw rijafstand?**

ZonZeker is een web-app die voor de komende 3 of 4 dagen laat zien waar je **zeker** zon hebt,
op basis van hoe lang je bereid bent te rijden. Je kiest een vertrekplaats en een maximale rijtijd
(bijvoorbeeld 3 uur, genoeg voor Groningen of Luxemburg). Daarna zie je een lijst:

1. **Eerst het weer.** Plekken staan in groepen: *Zeker zon* → *Waarschijnlijk zonnig* →
   *Af en toe zon* → *Weinig zon*.
2. **Dan de rijtijd.** Binnen elke groep staat de dichtstbijzijnde plek bovenaan, met rijtijd en afstand
   vanaf je startlocatie. Je kunt ook sorteren op *meeste zon*.

## Functies

- Tabblad **Beste dag**: per plek de zonnigste dag, met een dagstrook voor alle dagen.
- Een tabblad **per dag** (vandaag, morgen, …). Voor vandaag tellen alleen de uren ná aankomst.
- **Zekerheid**: vier weermodellen (ECMWF, ICON, GFS, Météo-France) worden vergeleken.
  "Zeker zon" betekent dat ze het eens zijn.
- Per plek: zon per model, zon per uur, regenkans, maximumtemperatuur en een knop **Route plannen**
  (Google Maps).
- **Temperatuur** per plek en per dag (hoogste temperatuur overdag), met een filter
  **Alle temp. / ≥ 10° / ≥ 15° / ≥ 20°**. Dagen die te koud zijn worden gedimd of weggelaten.
- Filter op **stad, kust, natuur of bergen**.
- **Thuis**-regel: zo zie je meteen of je wel hoeft te rijden.
- Onthoudt je instellingen, werkt in licht en donker thema, en is als app op je telefoon te zetten.

## Gebruiken

ZonZeker is een statische website zonder server of API-sleutels. Alles draait in de browser.

**Online via GitHub Pages**

1. Kies in GitHub *Settings → Pages → Build and deployment → Source* de optie **GitHub Actions**.
2. Start de workflow via *Actions → Publiceer op GitHub Pages → Run workflow*. Daarna publiceert hij
   vanzelf bij elke push naar de standaardbranch.
3. Open de link op je telefoon en kies *Zet op beginscherm* om hem als app te gebruiken.

(Voor GitHub Pages bij een privé-repository heb je een betaald GitHub-abonnement nodig.)

**Lokaal**

```bash
npm start
```

Open daarna <http://localhost:8080>. Elke andere statische webserver werkt ook.

## Hoe werkt het?

| Onderdeel | Bron |
| --- | --- |
| Zonverwachting per uur | [Open-Meteo](https://open-meteo.com/) (gratis, CC BY 4.0), 4 modellen |
| Rijtijden | [OSRM](https://project-osrm.org/) op OpenStreetMap-data, +10% marge voor verkeer. Lukt dat niet, dan een schatting op basis van de afstand. |
| Plaatsnaam zoeken | Open-Meteo Geocoding, Nominatim (OpenStreetMap) |
| Bestemmingen | `js/places.js`: ruim 220 steden, kustplaatsen, natuurgebieden en bergdorpen |

**Zonscore.** Voor elke plek en dag telt ZonZeker de zonneschijn (in seconden per uur) op over de
daglichturen. Dat wordt gedeeld door het aantal uren dat de zon hoger staat dan 5°.

- **Zeker zon**: gemiddeld ≥ 65% zon, het somberste model ≥ 50%, en hooguit een kwart van de modellen
  verwacht regen (≥ 0,5 mm overdag).
- **Waarschijnlijk zonnig**: gemiddeld ≥ 45% zon, het somberste model ≥ 25%.
- **Af en toe zon**: gemiddeld ≥ 20%.

De grenzen staan in `js/core.js` (`classify`).

**Zuinig met de gratis diensten.** Weerdata blijft een uur in het geheugen, en rijtijden per startlocatie
blijven in je browser bewaard. Bij een andere rijtijd worden alleen nieuwe plekken opgehaald.

## Plekken toevoegen

Voeg een regel toe aan `js/places.js`:

```js
['Naam', 'NL', 52.123, 5.456, 'natuur', 'Regio'],
```

Soort is `stad`, `kust`, `natuur` of `bergen`.

## Ontwikkelen

```
index.html          pagina
css/style.css       vormgeving (licht/donker via kleurtokens)
js/places.js        bestemmingen
js/core.js          rekenkern: afstand, zonnestand, zonscore (zonder DOM, los te testen)
js/weather.js       Open-Meteo ophalen en omzetten
js/routing.js       rijtijden via OSRM, met schatting als vangnet
js/geocode.js       plaatsnamen zoeken
js/icons.js         eigen weericonen (SVG)
js/app.js           interface
```

```bash
npm test
```

```bash
npm run e2e
```

`npm test` draait de unit-tests. `npm run e2e` is een browsertest met nagebootste weer- en routedata,
en vereist [Playwright](https://playwright.dev/).
