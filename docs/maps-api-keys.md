# Map keys (Mapbox): what they do and how to get them

## What Aarohan needs maps for
| Job | Where | Without a key |
|---|---|---|
| Map pictures (tiles) in both apps | the phone's browser | falls back to free CARTO tiles (fine for testing, limited terms for a business) |
| Street names for a point (reverse geocoding) | your server | falls back to the free public OpenStreetMap Nominatim server (limit: 1 request per second for everyone, and it blocks heavy users) |
| Place search ("where to?") | your server | same Nominatim fallback |
| **Road route and distance (this sets the FARE)** | your server | falls back to the public OSRM demo server (not for production, no guarantee, can be slow or stop) |
So for a real launch you need a Mapbox key. The free plan has a monthly allowance (check the current numbers on mapbox.com/pricing; they change).

## Get the keys (about 10 minutes, you do this)
1. Go to https://account.mapbox.com and sign up (free). Verify your email.
2. **Public token** (shown in the apps, so lock it):
   Account → Tokens → **Create a token** → name `Aarohan apps`.
   Leave the default public scopes. Under **URL restrictions** add `https://YOUR-RAILWAY-ADDRESS/*` and `http://localhost:3000/*`. Create it. It starts with `pk.`.
3. **Secret token** (server only, never in the apps):
   Create another token → name `Aarohan server` → tick the **secret** scopes it offers (any are fine for geocoding and directions) → no URL restriction. It starts with `sk.` and is shown ONCE, so copy it right away.
4. In Railway Variables set:
   - `MAP_PROVIDER` = `mapbox`
   - `MAPBOX_ACCESS_TOKEN` = the `pk.` token
   - `MAPBOX_SERVER_TOKEN` = the `sk.` token
   Redeploy. (Never put the `sk.` token in Git, in the apps, or in a chat.)
5. Set a **usage alert** in Mapbox (Account → Billing) so a surprise never costs you.
6. Test: open the rider app, the map should look like Mapbox streets, and "where to?" should find places; the fare quote should show a route.

## Notes
- If you ever lock the public token wrongly, the map goes grey. Fix it by adding your address to its URL list.
- Mapbox needs a credit card only if you go over the free allowance or upgrade.
- Keep `MAPTILER_API_KEY` empty unless you switch provider: MapTiler's free plan is non-commercial.
