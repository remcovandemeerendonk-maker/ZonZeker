# Promovideo

Een verticale video van 38 seconden (1080×1920, 30 fps) voor Instagram, TikTok en WhatsApp. De echte app
wordt op een telefoon in beeld bediend, met bewegende teksten en zelfgemaakte muziek en geluidseffecten.
De weer- en routedata in de video zijn een voorbeeld.

| Bestand | Wat het doet |
| --- | --- |
| `timeline.json` | Tijdlijn die beeld en geluid delen: teksten, tikken, typen, overgangen |
| `stage.html` | De "filmset": tekent elk beeld als functie van de tijd, met de app in een iframe |
| `render.js` | Neemt de video frame voor frame op met Playwright en stuurt de beelden naar ffmpeg |
| `music.py` | Synthetiseert muziek (tropical house, 120 BPM) en effecten met numpy, zonder samples |

## Opnieuw maken

Vereist: Node met Playwright (Chromium), Python 3 met numpy, en ffmpeg met libx264.

```bash
node promo/render.js
```

```bash
python3 promo/music.py
```

```bash
ffmpeg -y -i promo/out/video.mp4 -i promo/out/audio.wav -c:v copy -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:a aac -b:a 192k -shortest -movflags +faststart promo/out/ZonZeker-promo.mp4
```

Losse stilstaande beelden om iets te controleren:

```bash
SNAP=5,14.3,22 node promo/render.js
```
