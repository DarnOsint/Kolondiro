-- Add rave_price column to menu_items (nullable, only set for items with rave pricing)
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS rave_price numeric;

-- Add rave_mode setting (key-value in settings table)
INSERT INTO settings (id, value, updated_at)
VALUES ('rave_mode', 'false', now())
ON CONFLICT (id) DO NOTHING;

-- ─── Set rave prices ─────────────────────────────────────────────────────

-- WINES
UPDATE menu_items SET rave_price = 55000 WHERE name ILIKE 'Blue Nun';
UPDATE menu_items SET rave_price = 55000 WHERE name ILIKE '%Nederburg%';
UPDATE menu_items SET rave_price = 55000 WHERE name ILIKE '%Zonnebloem%';

-- WHISKY
UPDATE menu_items SET rave_price = 750000 WHERE name ILIKE 'Glenfiddich 21 Years' OR name ILIKE '%Glenfiddich%21%';
UPDATE menu_items SET rave_price = 180000 WHERE name ILIKE 'Glenfiddich 18 Years' OR name ILIKE '%Glenfiddich%18%';
UPDATE menu_items SET rave_price = 115000 WHERE name ILIKE 'Glenfiddich 15 Years' OR name ILIKE '%Glenfiddich%15%';
UPDATE menu_items SET rave_price = 750000 WHERE name ILIKE 'Glenfiddich 12 Years' OR name ILIKE '%Glenfiddich%12%';
UPDATE menu_items SET rave_price = 120000 WHERE name ILIKE '%Glenmorangie%18%';
UPDATE menu_items SET rave_price = 180000 WHERE name ILIKE '%Singleton%18%';
UPDATE menu_items SET rave_price = 190000 WHERE name ILIKE '%Singleton%15%';
UPDATE menu_items SET rave_price = 750000 WHERE name ILIKE '%Singleton%12%';
UPDATE menu_items SET rave_price = 110000 WHERE name ILIKE '%Jameson Black%';
UPDATE menu_items SET rave_price = 200000 WHERE name ILIKE '%Jameson Original%';
UPDATE menu_items SET rave_price = 200000 WHERE name ILIKE '%Red Label%';
UPDATE menu_items SET rave_price = 220000 WHERE name ILIKE '%Black Label%';
UPDATE menu_items SET rave_price = 250000 WHERE name ILIKE '%Johnnie Walker 18%' OR name ILIKE '%JW 18%';
UPDATE menu_items SET rave_price = 220000 WHERE name ILIKE '%Jack Daniel%';
UPDATE menu_items SET rave_price = 900000 WHERE name ILIKE '%William Lawson%';
UPDATE menu_items SET rave_price = 120000 WHERE name ILIKE '%American Honey%';

-- OTHER SPIRITS
UPDATE menu_items SET rave_price = 55000 WHERE name ILIKE '%Bacardi White%';
UPDATE menu_items SET rave_price = 55000 WHERE name ILIKE '%Bacardi Gold%';
UPDATE menu_items SET rave_price = 60000 WHERE name ILIKE '%J%C3%A4germeister%' OR name ILIKE '%Jagermeister%';
UPDATE menu_items SET rave_price = 50000 WHERE name ILIKE '%Baileys%' OR name ILIKE '%Bailey%';
UPDATE menu_items SET rave_price = 50000 WHERE name ILIKE '%Amarula%';
UPDATE menu_items SET rave_price = 60000 WHERE name ILIKE '%Campari%';

-- GIN
UPDATE menu_items SET rave_price = 45000 WHERE name ILIKE '%Gordon%Dry%' AND name NOT ILIKE '%Pink%' AND name NOT ILIKE '%Orange%';
UPDATE menu_items SET rave_price = 40000 WHERE name ILIKE '%Gordon%Pink%';
UPDATE menu_items SET rave_price = 40000 WHERE name ILIKE '%Gordon%Orange%';

-- SHISHA & SMOKES
UPDATE menu_items SET rave_price = 15000 WHERE name ILIKE '%Shisha%' OR name ILIKE '%Hookah%';
UPDATE menu_items SET rave_price = 2500 WHERE name ILIKE '%Benson Switch%';
UPDATE menu_items SET rave_price = 2500 WHERE name ILIKE '%Benson Tropical%';

-- SOFT DRINKS & ENERGY DRINKS
UPDATE menu_items SET rave_price = 2000 WHERE name ILIKE 'Coke%' OR name ILIKE '%Fanta%' OR name ILIKE '%Sprite%';
UPDATE menu_items SET rave_price = 5000 WHERE name ILIKE '%Black Stallion%';
UPDATE menu_items SET rave_price = 5000 WHERE name ILIKE '%Black Bullet%';
UPDATE menu_items SET rave_price = 5000 WHERE name ILIKE '%Red Bull%';

-- STARTERS
UPDATE menu_items SET rave_price = 20000 WHERE name ILIKE '%Chicken Wings%';
UPDATE menu_items SET rave_price = 7000 WHERE name ILIKE '%Peppered Gizzard%';
UPDATE menu_items SET rave_price = 18000 WHERE name ILIKE '%Prawn Tempura%';
UPDATE menu_items SET rave_price = 6000 WHERE name ILIKE '%Asun Bits%';
UPDATE menu_items SET rave_price = 9000 WHERE name ILIKE '%Peppered Chicken%' AND name NOT ILIKE '%Gizzard%';
UPDATE menu_items SET rave_price = 10000 WHERE name ILIKE '%Peppered Turkey%';
UPDATE menu_items SET rave_price = 7000 WHERE name ILIKE '%Peppered Goat%';
UPDATE menu_items SET rave_price = 7000 WHERE name ILIKE '%Peppered Beef%';
UPDATE menu_items SET rave_price = 18000 WHERE name ILIKE '%Peppered Snail%';

-- PEPPER SOUP
UPDATE menu_items SET rave_price = 7000 WHERE name ILIKE '%Goat Meat%Pepper Soup%';
UPDATE menu_items SET rave_price = 12000 WHERE name ILIKE '%Catfish%Pepper Soup%';
UPDATE menu_items SET rave_price = 9000 WHERE name ILIKE '%Chicken%Pepper Soup%';
UPDATE menu_items SET rave_price = 10000 WHERE name ILIKE '%Turkey%Pepper Soup%';
UPDATE menu_items SET rave_price = 7000 WHERE name ILIKE '%Assorted%Pepper Soup%';
UPDATE menu_items SET rave_price = 20000 WHERE (name ILIKE '%Fresh Fish%Pepper Soup%' OR name ILIKE '%Tilapia%Pepper Soup%' OR name ILIKE '%Croaker%Pepper Soup%') AND name ILIKE '%Large%';
UPDATE menu_items SET rave_price = 8000 WHERE name ILIKE '%Cow Tail%Pepper Soup%' OR name ILIKE '%Cowtail%Pepper Soup%';

-- GRILLED
UPDATE menu_items SET rave_price = 30000 WHERE name ILIKE '%Grilled Croaker%Large%';
UPDATE menu_items SET rave_price = 20000 WHERE name ILIKE '%Grilled Tilapia%Large%';
UPDATE menu_items SET rave_price = 15000 WHERE name ILIKE '%Grilled Catfish%';
UPDATE menu_items SET rave_price = 10000 WHERE name ILIKE '%Chicken Suya%';
UPDATE menu_items SET rave_price = 20000 WHERE name ILIKE '%Grilled Chicken%Half%';
UPDATE menu_items SET rave_price = 45000 WHERE name ILIKE '%Grilled Turkey%Whole%' OR name ILIKE '%Turkey%Whole%Grill%';
UPDATE menu_items SET rave_price = 12000 WHERE name ILIKE '%Chicken%&%Chips%' OR name ILIKE '%Chicken and Chips%';
UPDATE menu_items SET rave_price = 13000 WHERE name ILIKE '%Turkey%&%Chips%' OR name ILIKE '%Turkey and Chips%';

-- PLATTERS & SALADS
UPDATE menu_items SET rave_price = 35000 WHERE name ILIKE '%Platters%' OR name ILIKE '%Platter%';
UPDATE menu_items SET rave_price = 50000 WHERE name ILIKE '%Mini Grill Box%';
UPDATE menu_items SET rave_price = 8000 WHERE name ILIKE '%Chicken Caesar%';
UPDATE menu_items SET rave_price = 7000 WHERE name ILIKE '%Chicken Avocado%';
UPDATE menu_items SET rave_price = 6000 WHERE name ILIKE '%Kolondiro%Salad%' OR name ILIKE '%Kolondiro%Salad%';
UPDATE menu_items SET rave_price = 5000 WHERE name ILIKE '%Coleslaw%';

-- SOUPS
UPDATE menu_items SET rave_price = 6000 WHERE name ILIKE '%Oha Soup%' OR name ILIKE '%Oha%';
UPDATE menu_items SET rave_price = 2000 WHERE name ILIKE '%Egusi Soup%' AND name NOT ILIKE '%Efo%' AND name NOT ILIKE '%Seafood%';
UPDATE menu_items SET rave_price = 4000 WHERE name ILIKE '%Ogbono Soup%' AND name NOT ILIKE '%Seafood%';
UPDATE menu_items SET rave_price = 7000 WHERE name ILIKE '%Afang Soup%';
UPDATE menu_items SET rave_price = 2500 WHERE name ILIKE '%Efo Riro%' AND name NOT ILIKE '%Seafood%';
UPDATE menu_items SET rave_price = 7000 WHERE name ILIKE '%Bitter Leaf%' OR name ILIKE '%Ofe Onugbu%';
UPDATE menu_items SET rave_price = 6000 WHERE name ILIKE '%Nsala%' OR name ILIKE '%White Soup%';
UPDATE menu_items SET rave_price = 6000 WHERE name ILIKE '%Edi Kai Kon%' AND name NOT ILIKE '%Seafood%';
UPDATE menu_items SET rave_price = 15000 WHERE name ILIKE '%Seafood Okra%';
UPDATE menu_items SET rave_price = 3000 WHERE name ILIKE '%Efo%Egusi%' OR name ILIKE '%Efo Egusi%';
UPDATE menu_items SET rave_price = 15000 WHERE name ILIKE '%Seafood Efo%';
UPDATE menu_items SET rave_price = 1500 WHERE name ILIKE '%Ewedu%' OR name ILIKE '%Okra%' OR name ILIKE '%Gbegiri%';
UPDATE menu_items SET rave_price = 1500 WHERE name ILIKE '%Ofada Sauce%';
UPDATE menu_items SET rave_price = 4000 WHERE name ILIKE '%Seafood Ogbono%';
UPDATE menu_items SET rave_price = 17000 WHERE name ILIKE '%Seafood Edi%';
UPDATE menu_items SET rave_price = 15000 WHERE name ILIKE '%Fisherman Soup%';

-- SWALLOWS
UPDATE menu_items SET rave_price = 2000 WHERE name ILIKE '%Eba%';
UPDATE menu_items SET rave_price = 4000 WHERE name ILIKE '%Pounded Yam%';
UPDATE menu_items SET rave_price = 2000 WHERE name ILIKE '%Amala%';
UPDATE menu_items SET rave_price = 2000 WHERE name ILIKE '%Semovita%' OR name ILIKE '%Semo%';
UPDATE menu_items SET rave_price = 2500 WHERE name ILIKE '%Poundo%';
UPDATE menu_items SET rave_price = 2000 WHERE name ILIKE '%Wheat%' AND name NOT ILIKE '%Chicken%' AND name NOT ILIKE '%Turkey%';
UPDATE menu_items SET rave_price = 3000 WHERE name ILIKE '%Oat%' OR name ILIKE '%Oats%';

-- PASTA
UPDATE menu_items SET rave_price = 10000 WHERE name ILIKE '%Asun Pasta%';
UPDATE menu_items SET rave_price = 25000 WHERE name ILIKE '%Seafood Pasta%';
UPDATE menu_items SET rave_price = 10000 WHERE name ILIKE '%Chicken Pasta%';
UPDATE menu_items SET rave_price = 25000 WHERE name ILIKE '%Spicy Prawn Pasta%';
UPDATE menu_items SET rave_price = 6000 WHERE name ILIKE '%Jollof Pasta%';

-- RICE
UPDATE menu_items SET rave_price = 5000 WHERE name ILIKE '%Smoky Party Jollof%' OR (name ILIKE '%Party Jollof%' AND name ILIKE '%Smoky%');
UPDATE menu_items SET rave_price = 10000 WHERE name ILIKE '%Coconut Rice%';
UPDATE menu_items SET rave_price = 8000 WHERE name ILIKE '%Stir-Fry Basmati%' OR name ILIKE '%Stir Fry Basmati%';
UPDATE menu_items SET rave_price = 10000 WHERE name ILIKE '%Chinese Fried Rice%';
UPDATE menu_items SET rave_price = 10000 WHERE name ILIKE '%Native Rice%';
UPDATE menu_items SET rave_price = 12000 WHERE (name ILIKE '%Asun Jollof%' OR name ILIKE '%Spicy Asun%') AND name ILIKE '%Rice%';
UPDATE menu_items SET rave_price = 6000 WHERE name ILIKE '%Nigerian Fried Rice%';

-- PROTEINS
UPDATE menu_items SET rave_price = 9000 WHERE name ILIKE '%Turkey%' AND (name ILIKE '%Protein%' OR (LENGTH(name) < 20 AND name NOT ILIKE '%Grill%' AND name NOT ILIKE '%Pepper%' AND name NOT ILIKE '%Noodle%' AND name NOT ILIKE '%Stir%' AND name NOT ILIKE '%&%' AND name NOT ILIKE '%and%' AND name NOT ILIKE '%Caesar%' AND name NOT ILIKE '%Avocado%'));
UPDATE menu_items SET rave_price = 5000 WHERE name ILIKE '%Titus Fish%';
UPDATE menu_items SET rave_price = 10000 WHERE (name ILIKE '%Croaker%Half%' OR name ILIKE '%Tilapia%Half%') AND name NOT ILIKE '%Grill%';

-- NOODLES
UPDATE menu_items SET rave_price = 5000 WHERE name ILIKE '%Stir-Fry Noodles%Egg%' OR name ILIKE '%Stir Fry Noodles%Egg%';
UPDATE menu_items SET rave_price = 14000 WHERE name ILIKE '%Turkey%Noodle%' OR name ILIKE '%Noodle%Turkey%';
UPDATE menu_items SET rave_price = 10000 WHERE name ILIKE '%Beef%Noodle%' OR name ILIKE '%Noodle%Beef%';
UPDATE menu_items SET rave_price = 10000 WHERE name ILIKE '%Egg%Sausage%Noodle%' OR name ILIKE '%Noodle%Egg%Sausage%';

-- AFRICAN SPECIALS
UPDATE menu_items SET rave_price = 12000 WHERE name ILIKE '%Isiewu%';
UPDATE menu_items SET rave_price = 12000 WHERE name ILIKE '%Nkwobi%';
