export interface Account {
  id: string;
  label: string;
}

export interface BrowserObservation {
  page_read_at: string;
  server_observed_at: null;
  source: 'user_initiated_browser_selection';
  freshness: 'unknown';
  remaining_percent: number;
  relative_reset_seconds: number | null;
  credits_balance: string | null;
}

export interface Snapshot {
  account_id: string;
  observation: BrowserObservation;
  imported_at: string;
}
