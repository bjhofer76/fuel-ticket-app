alter table public.delivery_tickets
  add column if not exists taxable_subtotal numeric(12, 2),
  add column if not exists sales_tax_total numeric(12, 2),
  add column if not exists invoice_subtotal numeric(12, 2),
  add column if not exists prompt_pay_discount numeric(12, 2),
  add column if not exists discounted_total numeric(12, 2),
  add column if not exists net_amount_due numeric(12, 2);
