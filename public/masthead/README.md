# Masthead city scenes

Prepared time-of-day artwork for the masthead background. The app picks the
pack matching the viewer's resolved weather location (granted geolocation
city, else Los Angeles) and cross-fades between the four scenes on the
unified masthead clock.

## Adding a city

1. Generate four images (1536x1024 landscape) with the composition rules:
   quiet empty sky on the left 40%, layered mountains and a small skyline
   center-right, one or two palms or local landmark trees near the right
   edge, horizon about 60-75% down the frame. Keep the style flat, soft,
   atmospheric.
2. Drop them here named `<City>_<Scene>.png`:
   `Chicago_Day.png`, `Chicago_Sunset.png`, `Chicago_Night.png`,
   `Chicago_Morning.png` (Morning/Dawn/Sunrise all mean the pre-sunrise
   scene; Dusk/Evening mean Sunset). Multi-word cities keep underscores:
   `Las_Vegas_Night.png`.
3. Run `npm run masthead:prepare` - it crops the horizon band, converts to
   WebP here, and moves the raw PNGs to `reference/masthead-scenes-source/`.
4. Restart `npm run dev` (the file list is scanned at startup). Deploys pick
   the files up automatically.

Location matching lives in `src/lib/mastheadCityScenes.js`: a viewer within
150 km of a known city's coordinates gets that city's pack when it exists
(add coordinates there for new cities), the label of the resolved location
matches by name as well, and everything else falls back to LA, then to the
built-in SVG scenery. A pack may be partial; missing scenes show the SVG art.
