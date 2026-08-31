# Masthead city scenes

Prepared time-of-day artwork for the masthead background. The app picks the
pack matching the viewer's resolved weather location (granted geolocation
city, else Los Angeles) and cross-fades between seven scenes: six on the
unified masthead sun clock (Dawn, Morning, Day, Golden Hour, Sunset, Night)
plus Rain, which overrides the daytime scenes whenever the weather reports
rain, overcast, or fog (partly cloudy keeps the time scene; night keeps its
city-lights artwork in any weather).

## Adding a city

1. Generate seven wide panoramas (2000x400 works perfectly): skyline
   center-right, mountains or local geography across the frame, framing
   trees at the edges, calm sky in the upper half. Flat, soft, atmospheric.
2. Make a folder here named for the city and drop the files in as
   `<City>_<Scene>.png`:
   `Chicago/Chicago_Dawn.png`, `Chicago_Morning.png`, `Chicago_Day.png`,
   `Chicago_Golden Hour.png`, `Chicago_Sunset.png`, `Chicago_Night.png`,
   `Chicago_Rain.png`. Scene synonyms work (Sunrise=Dawn, Dusk/Evening=
   Sunset, Overcast/Cloudy=Rain); a missing scene falls back to the built-in
   SVG art for that state only.
3. Run `npm run masthead:prepare` - banner-shaped images convert straight to
   WebP here; legacy 3:2 frames get the horizon-band crop first; raw PNGs
   move to `reference/masthead-scenes-source/`.
4. Restart `npm run dev` (the file list is scanned at startup). Deploys pick
   the files up automatically.

Location matching lives in `src/lib/mastheadCityScenes.js`: a viewer within
150 km of a known city's coordinates gets that city's pack when it exists
(add coordinates there for new cities), the resolved location's label
matches by name as well, and everything else falls back to LA, then to the
built-in SVG scenery.
