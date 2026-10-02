alter table public.delivery_tickets
  add column if not exists prompt_pay_discount numeric,
  add column if not exists discounted_total numeric;
