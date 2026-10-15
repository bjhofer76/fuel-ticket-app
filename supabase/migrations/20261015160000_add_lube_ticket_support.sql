alter table public.products
  add column if not exists product_type text,
  add column if not exists quickbooks_tax_code text;

update public.products
set product_type = 'FUEL'
where product_type is null;

alter table public.products
  alter column product_type set default 'FUEL',
  alter column product_type set not null;

alter table public.products
  add constraint products_product_type_check
  check (product_type in ('FUEL', 'LUBE'));

alter table public.delivery_tickets
  add column if not exists ticket_type text;

update public.delivery_tickets
set ticket_type = 'FUEL'
where ticket_type is null;

alter table public.delivery_tickets
  alter column ticket_type set default 'FUEL',
  alter column ticket_type set not null;

alter table public.delivery_tickets
  add constraint delivery_tickets_ticket_type_check
  check (ticket_type in ('FUEL', 'LUBE'));
