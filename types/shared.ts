export interface User {
  id: string;
  email: string | null;
  household_id: string;
  created_at: number;
}

export interface Household {
  id: string;
  name: string;
  created_at: number;
}

export interface PantryItem {
  id: string;
  household_id: string;
  name: string;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  in_stock: 0 | 1;
  updated_at: number;
}

export interface MealIngredient {
  name: string;
  quantity?: number;
  unit?: string;
}

export interface MealEntry {
  id: string;
  household_id: string;
  date: string;          // ISO date
  name: string;
  ingredients: string | null;  // JSON-encoded MealIngredient[]
  steps: string | null;        // JSON-encoded string[]
  created_at: number;
}

export interface MealEntryData {
  date: string;
  name: string;
  ingredients?: MealIngredient[];
  steps?: string[];
}
