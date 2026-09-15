-- Zone drinks-per-sale multiplier
--
-- In some zones (e.g. Indoor) a single order line is priced as TWO physical
-- drinks (2-drink special). Stock deduction must account for the real number
-- of bottles leaving the chiller, not the number of order lines.
--
-- units_per_sale on menu_item_zone_prices = how many physical stock units one
-- sold line of that item in that zone consumes. Default 1 (no change).
-- Set to 2 for the indoor beers that are priced as a 2-drink deal.

alter table public.menu_item_zone_prices
  add column if not exists units_per_sale integer not null default 1;

alter table public.menu_item_zone_prices
  drop constraint if exists menu_item_zone_prices_units_per_sale_check;

alter table public.menu_item_zone_prices
  add constraint menu_item_zone_prices_units_per_sale_check
  check (units_per_sale >= 1);

comment on column public.menu_item_zone_prices.units_per_sale is
  'Physical stock units consumed per sold line of this item in this zone (default 1; e.g. 2 for a two-drink zone price)';
