# SpotOn Synoptic Data

This repository publishes live synoptic data products for the **SpotOn** project.

## Atlantic Focus Satellite Image
- Generated from EUMETSAT MSG (Meteosat-11 Rapid Scan Service) data.  
- Updated every 30 minutes by a GitHub Actions workflow.  
- Includes true-colour rendering with country outlines overlaid.  
- **Output file:** `synoptic/atlantic_focus.png`

## Met Office Shipping Forecast (JSON)
- Parsed from the official UK Met Office shipping forecast.  
- Updated four times daily (shortly after 00, 06, 12, 18 UTC issue times).  
- Provides:
  - General synopsis  
  - Sea-area forecasts  
  - Gale warnings  
  - Wind, sea state, weather, visibility  
- **Output file:** `synoptic/shipping_forecast_latest.json`

---

⚠️ **Notes**  
- Satellite source data © EUMETSAT. This repository republishes a derived PNG only.  
- Shipping Forecast © UK Met Office, Crown Copyright. This repository republishes a parsed machine-readable version for use in SpotOn visualisations.
