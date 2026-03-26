-- MERGE staging events into canonical table
-- Parameters: @run_id (STRING)
MERGE donations.events AS target
USING (
  SELECT * FROM donations_raw.stg_events
  WHERE run_id = @run_id
) AS source
ON target.source = source.source AND target.external_id = source.external_id
WHEN MATCHED THEN UPDATE SET
  event_ts = source.event_ts,
  created_at = source.created_at,
  ingested_at = source.ingested_at,
  amount_cents = source.amount_cents,
  fee_cents = source.fee_cents,
  net_amount_cents = source.net_amount_cents,
  currency = source.currency,
  donor_name = source.donor_name,
  donor_email = source.donor_email,
  donor_phone = source.donor_phone,
  donor_address = source.donor_address,
  status = source.status,
  payment_method = source.payment_method,
  description = source.description,
  source_metadata = source.source_metadata,
  _updated_at = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT (
  source, external_id, event_ts, created_at, ingested_at,
  amount_cents, fee_cents, net_amount_cents, currency,
  donor_name, donor_email, donor_phone, donor_address,
  status, payment_method, description, source_metadata
) VALUES (
  source.source, source.external_id, source.event_ts, source.created_at, source.ingested_at,
  source.amount_cents, source.fee_cents, source.net_amount_cents, source.currency,
  source.donor_name, source.donor_email, source.donor_phone, source.donor_address,
  source.status, source.payment_method, source.description, source.source_metadata
);
