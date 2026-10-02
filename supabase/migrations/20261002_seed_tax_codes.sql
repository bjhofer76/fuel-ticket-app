insert into public.tax_codes (sales_tax_code, description, tax_rate, is_taxable)
values
  ('EXEMPT', 'Sales Tax Exempt', 0.0000, false),
  ('SD_STATE', 'South Dakota State Sales Tax', 0.0420, true),
  ('FARM_EXEMPT', 'Farm Exempt', 0.0000, false)
on conflict (sales_tax_code) do update
set description = excluded.description,
    tax_rate = excluded.tax_rate,
    is_taxable = excluded.is_taxable;
