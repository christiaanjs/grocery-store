ALTER TABLE ingredient_macros ADD COLUMN fiber_g REAL;
ALTER TABLE ingredient_macros ADD COLUMN saturated_fat_g REAL;
ALTER TABLE ingredient_macros ADD COLUMN sodium_mg REAL;

ALTER TABLE food_log_entries ADD COLUMN fiber_g REAL;
ALTER TABLE food_log_entries ADD COLUMN saturated_fat_g REAL;
ALTER TABLE food_log_entries ADD COLUMN sodium_mg REAL;
