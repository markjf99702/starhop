# Starhop

What's up tonight from where you are, what's worth pointing a telescope at, and how to find it by hopping from stars you know.

It is one HTML page plus a few data files, with no build step and no server code. Host the folder anywhere static (GitHub Pages works), or run `python3 -m http.server` in it and open http://localhost:8000. Opening `index.html` straight from disk won't work, because browsers block reading the data files that way.

## What it does

- **Sky map.** Tonight's sky for your location and time: stars down to about magnitude 6, constellation lines and names, the Milky Way, the planets and the Moon (with its phase), plus clusters, nebulae and galaxies.
  - Drag to look around and pinch or scroll to zoom.
  - **Up** shows the whole dome overhead, laid out like a planisphere you hold above your head; **N / E / S / W** face a direction.
  - It shows only what the sky allows: twilight, the Moon and how dark your sky is all change which stars appear.
- **Night timeline.** Sunset to sunrise, shaded through civil, nautical and astronomical twilight, with a band for when the Moon is up. Drag along it to see the sky at any hour, or step to other nights.
- **Tonight.** Sunset, when the sky is fully dark, sunrise, the Moon's phase and hours, and a verdict: a dark night for faint galaxies, or a moonlit one for planets, doubles and clusters.
- **What to look at.** The Moon and planets, then the best-placed deep-sky objects and double stars, ranked for your telescope and your sky. Each shows when it's highest and where to look.
- **Object cards:**
  - **Where to look:** altitude in fists at arm's length, compass direction, and rise, set and highest times.
  - **Finder chart:** a naked-eye view around the target, a 5° finderscope circle, and a star-hop, e.g. "about a third of the way from η Her to Rutilicus" for M13.
  - **Your telescope:** magnification and field for each eyepiece, which one to use, and a sketch of the eyepiece view.
  - **Planets:** Jupiter's four moons in their positions for that time, Saturn's rings at their current tilt, and the phases of Venus and Mercury.
- **Coming up.** Moon phases, meteor shower peaks (with how much the Moon interferes), planet oppositions and elongations, the Moon passing bright planets, and eclipses seen from your location.
- **Night vision.** Everything turns dim red so your eyes stay dark-adapted at the eyepiece.
- **Remembered in the browser:** your location, telescope, eyepieces, sky and the objects you mark as seen.

## How it works

- **Positions.** The Sun, Moon and planets come from [Astronomy Engine](https://github.com/cosinekitty/astronomy) (MIT), loaded from jsDelivr. The same library supplies rise and set times, twilight, moon phases, Jupiter's moons, Saturn's ring tilt, elongations, oppositions and eclipses.
  - Stars and deep-sky objects are J2000 catalog positions, turned to altitude and azimuth with its rotation matrices.
- **Map projection.** Stereographic, the projection planispheres use. It keeps constellation shapes true, and the horizon is always a circle, which makes the ground easy to draw.
- **Time zones.** Every time is shown in the observing location's own time zone, whatever the device is set to.
- **Difficulty ratings are a rule of thumb:**
  - **Galaxies and nebulae:** the object's surface brightness is compared with the sky's, helped by aperture and penalized by moonlight. For big objects the rating uses the bright core, which is what you see first.
  - **Double stars:** rated by the power needed to split them (roughly 240 ÷ separation in arcseconds) against your telescope's resolving limit.
- **Star-hops.** Starhop looks for two bright stars with the target on or near the line between them, preferring short, bright, well-aligned pairs. When there is no such pair, it falls back to the nearest bright star.

## Data

`data/` holds compact files built by `tools/build_data.py` from:
- [d3-celestial](https://github.com/ofrohn/d3-celestial) 0.7.35 (BSD-3-Clause), which provides:
  - the Hipparcos-based star catalog and star names;
  - IAU constellation lines;
  - the Milky Way outline, resampled here into a grid of soft glows;
  - SEDS Messier data and other deep-sky objects.
- [city-timezones](https://github.com/kevinroberts/city-timezones) 1.3.4 (MIT): 7,300 cities with their time zones.

The double-star notes and object descriptions were written for Starhop. The steps to rebuild are at the top of the build script, and [data/SOURCES.md](data/SOURCES.md) has the licenses.

## License

MIT — see [LICENSE](LICENSE). The data in `data/` keeps its sources' licenses, listed in [data/SOURCES.md](data/SOURCES.md).
