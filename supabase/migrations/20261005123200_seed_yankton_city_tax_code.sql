insert into public.tax_codes (sales_tax_code, description, tax_rate, is_taxable)
values ('YANKTON_CITY', 'Yankton City Combined Sales Tax', 0.0620, true)
on conflict (sales_tax_code) do update
set description = excluded.description,
    tax_rate = excluded.tax_rate,
    is_taxable = excluded.is_taxable;
