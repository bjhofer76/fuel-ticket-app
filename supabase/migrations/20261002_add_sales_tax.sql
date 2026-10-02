create table if not exists public.tax_codes (
  sales_tax_code text primary key,
  description text,
  tax_rate numeric(9, 6) not null check (tax_rate >= 0 and tax_rate <= 1),
  is_taxable boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.delivery_ticket_items
  add column if not exists taxable_amount numeric(12, 2),
  add column if not exists sales_tax_amount numeric(12, 2);

alter table public.delivery_tickets
  add column if not exists taxable_subtotal numeric(12, 2),
  add column if not exists sales_tax_total numeric(12, 2),
  add column if not exists invoice_subtotal numeric(12, 2),
  add column if not exists net_amount_due numeric(12, 2);
