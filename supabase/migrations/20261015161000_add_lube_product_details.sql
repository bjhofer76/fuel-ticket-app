begin;

alter table public.products
  add column if not exists description text,
  add column if not exists package_size text,
  add column if not exists sales_tax_code text,
  add column if not exists quickbooks_tax_code text;

commit;
