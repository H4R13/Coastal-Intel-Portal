-- Portal database (PostgreSQL + PostGIS). Applied by the loaders; safe to run repeatedly.
create extension if not exists postgis;

-- One row per layer: where the data came from and how to describe it. Filled by that layer's loader.
create table if not exists layer_info (
  layer     text primary key,
  info      jsonb not null,
  loaded_at timestamptz not null default now()
);

-- Mangrove extent. scenario is 'observed' for mapped years, otherwise the team's scenario id.
-- Shapes are cut into small pieces (ST_Subdivide) so a map tile only reads the pieces it touches.
create table if not exists mangrove_extent (
  id       bigserial primary key,
  scenario text not null,
  year     int  not null,
  geom     geometry(Polygon, 3857) not null
);
create index if not exists mangrove_extent_geom on mangrove_extent using gist (geom);
create index if not exists mangrove_extent_key  on mangrove_extent (scenario, year);

-- Eroded land, one row per polygon piece. Each polygon belongs to the period in which the land was lost:
-- four mapped periods (kind 'observed'), then yearly steps to 2050 from the team's CA-Markov run (kind 'projected').
create table if not exists erosion_area (
  id       bigserial primary key,
  kind     text not null,
  start_yr int  not null,
  end_yr   int  not null,
  geom     geometry(Polygon, 3857) not null
);
create index if not exists erosion_area_geom on erosion_area using gist (geom);

-- Ocean pH / warming / oxygen / fisheries package (AMHK). Its catalog drives the portal, so everything is kept as
-- documents under the keys the API serves: 'catalog', 'raster/<id>[/<year>]' (decoded grid), 'data/<id>' (chart or
-- table rows), 'overlay/<id>' and 'vector/<id>' (GeoJSON), 'chart_style', 'findings'.
create table if not exists ocean_doc (
  key  text primary key,
  body jsonb not null
);

-- Saltwater intrusion / salinity package (AMIB). Its rasters (~7 GB) stay on disk; the database holds what describes
-- them: 'catalog' (one entry per layer, with map bounds and time steps), 'files/<id>' (which image file each step
-- uses; server side only), 'series/<product>' (chart data), 'vector/<id>' (GeoJSON).
create table if not exists amib_doc (
  key  text primary key,
  body jsonb not null
);

-- Plastic debris material (DMJM): 'surveys' (the beach survey CSV, a demo dataset) and 'projection' (its scenario
-- simulation to 2050). See server/load-dmjm.mjs.
create table if not exists dmjm_doc (
  key  text primary key,
  body jsonb not null
);

-- Mangrove area per year, exactly as delivered in the team's CSV files.
create table if not exists mangrove_area (
  scenario text not null,
  year     int  not null,
  area_km2 double precision not null,
  primary key (scenario, year)
);
