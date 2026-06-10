-- A1 — Speed up findOrCreateContact in the webhook, contacts page,
--     and phone lookup in meta-send.ts.
CREATE INDEX IF NOT EXISTS idx_contacts_user_phone
  ON contacts (user_id, phone);

-- A5 — Speed up isDuplicateInbound() in flows/engine.ts which runs
--     for every inbound message when a flow is active.
CREATE INDEX IF NOT EXISTS idx_flow_runs_user_contact
  ON flow_runs (user_id, contact_id);

-- A6 — Speed up findEntryFlow() in flows/engine.ts which fetches all
--     active flows for the user on every inbound message.
CREATE INDEX IF NOT EXISTS idx_flows_user_status
  ON flows (user_id, status);
