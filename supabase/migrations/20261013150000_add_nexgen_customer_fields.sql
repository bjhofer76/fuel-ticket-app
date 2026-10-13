alter table public.customers
  add column if not exists nexgen_customer_id text,
  add column if not exists classification text,
  add column if not exists terms text,
  add column if not exists salesperson text,
  add column if not exists default_driver text,
  add column if not exists credit_limit numeric(12, 2);
