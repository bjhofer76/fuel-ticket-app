alter table public.products
  add column if not exists federal_fuel_tax numeric(12, 4) not null default 0,
  add column if not exists state_fuel_tax numeric(12, 4) not null default 0;

alter table public.delivery_ticket_items
  add column if not exists federal_fuel_tax numeric(12, 4) not null default 0,
  add column if not exists state_fuel_tax numeric(12, 4) not null default 0;

update public.delivery_ticket_items as ticket_item
set
  federal_fuel_tax = coalesce(product.federal_fuel_tax, 0),
  state_fuel_tax = coalesce(product.state_fuel_tax, 0)
from public.products as product
where ticket_item.product_code = product.product_code;
