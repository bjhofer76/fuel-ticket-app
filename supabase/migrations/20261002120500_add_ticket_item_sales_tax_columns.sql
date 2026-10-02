alter table public.delivery_ticket_items
  add column if not exists sales_tax_code text,
  add column if not exists taxable_amount numeric(12, 2),
  add column if not exists sales_tax_amount numeric(12, 2);
