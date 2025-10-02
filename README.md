# SpotOn Synoptic Data

This repository publishes live synoptic and forecast data products for the **SpotOn** project.  
It acts as an open data warehouse for downstream visualisations, analysis, and training.

---

## Atlantic Focus Satellite Image
- Generated from **EUMETSAT MSG (Meteosat-11 Rapid Scan Service)** data.  
- Updated every 30 minutes by a GitHub Actions workflow.  
- Includes true-colour rendering with country outlines overlaid.  
- **Output file:** `synoptic/atlantic_focus.png`

---

## Met Office Shipping Forecast (JSON)
- Parsed from the official UK **Met Office Shipping Forecast**.  
- Updated every 15 minutes to capture new gale warnings as soon as they appear.  
- Provides:  
  - General synopsis  
  - Sea-area forecasts  
  - Gale warnings  
  - Wind, sea state, weather, visibility  
- **Output files:**  
  - `synoptic/shipping_forecast_latest.json` (always current)  
  - `synoptic/shipping_forecast_YYYYMMDDTHHMMZ.json` (time-stamped snapshots, ~1 day history kept)  

---

## SpotOn Parquet Warehouse (Open Data)
- Machine-readable, structured datasets built daily from SpotOn outputs.  
- Stored in Apache Parquet format for efficient analysis.  
- Updated 3× daily after the main forecast pipeline completes.  
- Current datasets include:  
  - `shipping_forecast.parquet` – structured shipping forecast  
  - `sf_global_daily.parquet` – daily global forecast roll-up  
  - `sf_signals_for_surf.parquet` – surf-specific gale/wind signals  
  - `training_area_daily.parquet` – training area summaries  
  - `daily_area_overview.parquet`, `daily_spot_conditions.parquet` – localised summaries  
- **Output location:**  
  - `warehouse/parquet/latest/` (always current)  
  - `warehouse/parquet/YYYY-MM-DD/` (daily snapshots, retained for audit/reproducibility)  

⚡ The warehouse has already begun collecting data and will continue to expand in scope as the project develops.  

---

## How to Use the Data

### Python (pandas + pyarrow)
```python
import pandas as pd

# Load the latest shipping forecast
df = pd.read_parquet(
    "https://raw.githubusercontent.com/Bryan701701/spoton-synoptic/main/warehouse/parquet/latest/shipping_forecast.parquet"
)





library(arrow)

# Load the global daily dataset
df <- read_parquet("https://raw.githubusercontent.com/Bryan701701/spoton-synoptic/main/warehouse/parquet/latest/sf_global_daily.parquet")

head(df)

⚠️ Notes
	•	Satellite source data © EUMETSAT. This repository republishes a derived PNG only.
	•	Shipping Forecast © UK Met Office, Crown Copyright. This repository republishes parsed, machine-readable versions.
	•	SpotOn warehouse datasets are provided as-is, with no warranty, for research, experimentation, and visualisation purposes.







print(df.head())
