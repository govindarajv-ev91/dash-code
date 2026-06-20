-- Reference: existing public.iot_data (Alt Mobility / pipeline ingest)
-- Columns: vehicle_number, run_date, total_distance, data_source, raw_vehicle_id,
--           vehicle_master_id, lookup_matched, lookup_match_type, created_at

alter table if exists public.iot_data enable row level security;

drop policy if exists "Allow anon read iot_data" on public.iot_data;
create policy "Allow anon read iot_data"
  on public.iot_data for select to anon using (true);

create index if not exists iot_data_run_date_idx on public.iot_data (run_date);
create index if not exists iot_data_vehicle_number_idx on public.iot_data (vehicle_number);
